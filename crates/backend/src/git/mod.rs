#[cfg(test)]
mod test_helpers;
pub mod watcher;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

use crate::filesystem::scope::{
    ensure_within_home, expand_home, home_canonical, reject_parent_refs,
};

/// Timeout for git subprocess calls. Prevents indefinite blocking on
/// hung NFS mounts, slow hooks, or unresponsive credential helpers.
const GIT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_DIFF_FILE_TEXT_BYTES: u64 = 2 * 1024 * 1024;

/// Run a git command with a timeout. Spawns the process first so the
/// child handle is available for killing on timeout — prevents orphaned
/// blocking threads in Tokio's thread pool.
async fn run_git_with_timeout(mut cmd: Command) -> Result<std::process::Output, String> {
    let child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git: {}", e))?;

    let child_id = child.id();

    let result = tokio::time::timeout(
        GIT_TIMEOUT,
        tokio::task::spawn_blocking(move || child.wait_with_output()),
    )
    .await;

    match result {
        Ok(Ok(Ok(output))) => Ok(output),
        Ok(Ok(Err(e))) => Err(format!("Failed to run git: {}", e)),
        Ok(Err(e)) => Err(format!("git task failed: {}", e)),
        Err(_) => {
            // Kill the orphaned process so it doesn't linger and
            // unblock the spawn_blocking thread holding wait_with_output.
            #[cfg(unix)]
            {
                unsafe {
                    // SAFETY: child_id comes from the git process spawned
                    // above, and wait_with_output has not completed because
                    // this branch only runs after the timeout wins the race.
                    // There is still a theoretical PID-reuse race if git
                    // exits at the same instant the timeout fires and the OS
                    // immediately reuses that PID; in this desktop-sidecar
                    // context we accept that narrow risk to avoid leaking a
                    // hung subprocess/thread. SIGKILL is intentional because
                    // SIGTERM may be ignored by a blocking syscall on NFS.
                    let _ = libc::kill(child_id as i32, libc::SIGKILL);
                }
            }

            #[cfg(windows)]
            {
                let _ = tokio::task::spawn_blocking(move || {
                    let _ = Command::new("taskkill")
                        .args(["/F", "/PID", &child_id.to_string()])
                        .status();
                });
            }

            Err(format!(
                "git command timed out after {}s",
                GIT_TIMEOUT.as_secs()
            ))
        }
    }
}

/// Validate that `cwd` resolves to a path inside the user's home directory.
pub(crate) fn validate_cwd(cwd: &str) -> Result<std::path::PathBuf, String> {
    let expanded = expand_home(cwd);
    reject_parent_refs(&expanded)?;
    let home = home_canonical()?;
    let canonical =
        std::fs::canonicalize(&expanded).map_err(|e| format!("invalid cwd '{}': {}", cwd, e))?;
    ensure_within_home(&canonical, &home)?;
    Ok(canonical)
}

/// Validate that a file path is repo-relative (no absolute paths, no `..`).
fn validate_file_path(file: &str) -> Result<(), String> {
    if file.is_empty() {
        return Err("access denied: file path must not be empty".to_string());
    }
    let path = Path::new(file);
    if path.is_absolute() {
        return Err(format!(
            "access denied: file path must be repo-relative, got: {}",
            file
        ));
    }
    reject_parent_refs(path)
}

/// Request type for staging a file (whole-file or per-hunk).
///
/// Also reused as the request type for `unstage_file` — same fields,
/// same semantics (the handler logic differs, not the request shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct StageFileRequest {
    pub cwd: String,
    pub path: String,
    /// Unified-diff hunk patch. `None` ⇒ whole-file stage; `Some` ⇒
    /// per-hunk stage applied via `git apply --cached`.
    pub hunk_patch: Option<String>,
}

/// Request type for discarding working-tree changes (whole-file or per-hunk).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DiscardFileRequest {
    pub cwd: String,
    pub path: String,
    pub hunk_patch: Option<String>,
    #[serde(default)]
    pub scope: DiscardScope,
}

/// Controls which half of the working-tree change `discard_file` removes.
///
/// - `Unstaged` (default): only the unstaged working-tree edits are reverted
///   (`git checkout -- <file>` or `git apply -R`).
/// - `Both`: staged changes are also dropped (`git reset HEAD <file>` followed
///   by the unstaged discard), effectively returning the file to HEAD.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum DiscardScope {
    #[default]
    Unstaged,
    Both,
}

/// Spawn `git` with the given args, pipe `patch` to its stdin, and wait for
/// it to exit. Uses `tokio::process::Command` for non-blocking stdin writes;
/// fully-qualified to avoid shadowing `std::process::Command` already in scope.
///
/// Intended for `git apply --cached` and `git apply -R` which consume a
/// unified-diff patch on stdin.
async fn run_git_apply_with_patch(
    cwd: &std::path::Path,
    args: &[&str],
    patch: &str,
) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new("git");
    cmd.current_dir(cwd)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(patch.as_bytes())
            .await
            .map_err(|e| format!("stdin write failed: {e}"))?;
        // Drop stdin so git sees EOF.
    }
    let output = tokio::time::timeout(std::time::Duration::from_secs(30), child.wait_with_output())
        .await
        .map_err(|_| "git apply timed out after 30s".to_string())?
        .map_err(|e| format!("git apply wait failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!("git apply failed with status {}", output.status)
        } else {
            stderr.into_owned()
        });
    }
    Ok(())
}

/// Run `git status --porcelain=v1 -z -- <path>` and return `true` when the
/// first status record starts with `??` (i.e. the path is untracked).
///
/// Uses the sync `Command` alias (= `std::process::Command`) already imported
/// at the top of this file, wrapped through `run_git_with_timeout`.
async fn git_status_porcelain_is_untracked(
    cwd: &std::path::Path,
    path: &str,
) -> Result<bool, String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .args(["status", "--porcelain=v1", "-z", "--", path]);
    let out = run_git_with_timeout(cmd).await?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    Ok(stdout.starts_with("??"))
}

/// Validate that a file path and its optional hunk patch are safe to pass to
/// git staging/discarding operations.
///
/// Checks:
/// 1. `path` is repo-relative (no absolute paths, no `..` traversal) — reuses
///    the existing `validate_file_path` helper.
/// 2. `path` resolves to a location inside `cwd` when joined (belt-and-braces
///    against any edge cases `validate_file_path` does not cover).
/// 3. `hunk_patch`, when present, targets only a single file (no second
///    `diff --git` header).
/// 4. Header consistency — anchored on the `diff --git a/OLD b/NEW` line:
///    - Every `--- a/` path must equal OLD or `/dev/null`.
///    - Every `+++ b/` path must equal NEW or `/dev/null`.
///    - `path` must equal OLD or NEW (rename-aware: normally `path == NEW`,
///      the file being staged; `path == OLD` covers the deletion side).
///    - Fallback when no `diff --git` line is present: every `--- a/` and
///      `+++ b/` header path (excluding `/dev/null`) must equal `path`
///      (strict non-rename).
///    - If the `diff --git` line is present but its paths cannot be parsed
///      (e.g. quoted paths with spaces), the fallback strict rule applies.
///
/// The residual case (an internally-consistent rename `evil.rs` → `path`) is
/// backstopped by `git apply --cached` itself — the OLD file must exist in the
/// index — and is acceptable for this defense-in-depth layer.
fn validate_hunk_patch(
    cwd: &std::path::Path,
    path: &str,
    hunk_patch: Option<&str>,
) -> Result<(), String> {
    // Reuse the existing repo-relative path validator (rejects empty, absolute,
    // and `..` traversal paths).
    validate_file_path(path)?;

    // Belt-and-braces: ensure the joined result stays inside cwd.
    let resolved = cwd.join(path);
    if !resolved.starts_with(cwd) {
        return Err(format!("path escapes workspace: {}", path));
    }

    if let Some(patch) = hunk_patch {
        let diff_git_lines: Vec<&str> = patch
            .lines()
            .filter(|l| l.starts_with("diff --git "))
            .collect();
        if diff_git_lines.len() > 1 {
            return Err("multi-file patches not allowed".to_string());
        }

        // Collect the body `--- a/` / `+++ b/` header paths (stop at first @@).
        let mut minus_paths: Vec<&str> = Vec::new();
        let mut plus_paths: Vec<&str> = Vec::new();
        for line in patch.lines() {
            if line.starts_with("@@") {
                break;
            }
            if let Some(rest) = line.strip_prefix("--- a/") {
                minus_paths.push(rest);
            } else if line.starts_with("--- /dev/null") {
                minus_paths.push("/dev/null");
            } else if let Some(rest) = line.strip_prefix("+++ b/") {
                plus_paths.push(rest);
            } else if line.starts_with("+++ /dev/null") {
                plus_paths.push("/dev/null");
            }
        }

        // Try to parse (OLD, NEW) from the `diff --git a/OLD b/NEW` line.
        // Only handles the common unquoted case. Quoted paths (with spaces or
        // special chars) are deliberately not parsed here — fall through to the
        // strict fallback below to avoid a mis-parse being exploited.
        let diff_git_parsed: Option<(&str, &str)> = diff_git_lines.first().and_then(|line| {
            // line is "diff --git a/OLD b/NEW"
            let rest = line.strip_prefix("diff --git ")?;
            // If the line contains quotes we can't safely split on " b/" because
            // the paths themselves may contain that literal string. Bail out.
            if rest.starts_with('"') {
                return None;
            }
            // Find " b/" after the "a/" prefix. Split on the LAST occurrence
            // of " b/" so paths containing " b/" sub-strings (unusual but
            // possible) are handled conservatively: we'd get a wrong split, but
            // the subsequent consistency check would then reject the patch,
            // which is the safe direction.
            let a_rest = rest.strip_prefix("a/")?;
            // Walk through looking for " b/" — use rfind so the split point is
            // as far right as possible (handles paths with " b" sub-strings
            // better than splitting at the first occurrence).
            let b_marker = " b/";
            let split_pos = a_rest.rfind(b_marker)?;
            let old_path = &a_rest[..split_pos];
            let new_path = &a_rest[split_pos + b_marker.len()..];
            if old_path.is_empty() || new_path.is_empty() {
                return None;
            }
            Some((old_path, new_path))
        });

        if let Some((old_path, new_path)) = diff_git_parsed {
            // Strict consistency: every body `--- a/` path must equal OLD or
            // /dev/null, and every `+++ b/` path must equal NEW or /dev/null.
            for &mp in &minus_paths {
                if mp != "/dev/null" && mp != old_path {
                    return Err(format!(
                        "patch header inconsistency: '--- a/{}' does not match diff --git OLD path '{}'",
                        mp, old_path
                    ));
                }
            }
            for &pp in &plus_paths {
                if pp != "/dev/null" && pp != new_path {
                    return Err(format!(
                        "patch header inconsistency: '+++ b/{}' does not match diff --git NEW path '{}'",
                        pp, new_path
                    ));
                }
            }
            // Rename-aware: path must be the OLD or NEW endpoint.
            if path != old_path && path != new_path {
                return Err(format!(
                    "patch targets a different file (diff --git OLD='{}' NEW='{}', req: {})",
                    old_path, new_path, path
                ));
            }
        } else {
            // Fallback: no parseable `diff --git` line — apply the strict rule
            // that every body header path (excluding /dev/null) must equal path.
            let all_header_paths: Vec<&str> = minus_paths
                .iter()
                .chain(plus_paths.iter())
                .copied()
                .filter(|&p| p != "/dev/null")
                .collect();
            if !all_header_paths.is_empty() {
                for &hp in &all_header_paths {
                    if hp != path {
                        return Err(format!(
                            "patch targets a different file (header paths: {:?}, req: {})",
                            all_header_paths, path
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

/// Stage a file (whole-file or per-hunk) into the git index.
///
/// - Whole-file (`hunk_patch == None`): runs `git add -- <path>`.
/// - Per-hunk (`hunk_patch == Some`): pipes the patch to
///   `git apply --cached --whitespace=nowarn`.
///
/// Validation (`validate_cwd` + `validate_hunk_patch`) runs before any git
/// invocation so a bad caller cannot mutate paths outside the workspace.
pub(crate) async fn stage_file_inner(req: StageFileRequest) -> Result<(), String> {
    let cwd = validate_cwd(&req.cwd)?;
    validate_hunk_patch(&cwd, &req.path, req.hunk_patch.as_deref())?;
    match &req.hunk_patch {
        None => {
            let mut cmd = Command::new("git");
            cmd.current_dir(&cwd).args(["add", "--", &req.path]);
            run_git_with_timeout(cmd).await.map(|_| ())?;
        }
        Some(patch) => {
            run_git_apply_with_patch(&cwd, &["apply", "--cached", "--whitespace=nowarn"], patch)
                .await?;
        }
    }
    Ok(())
}

/// Unstage a file (whole-file or per-hunk) from the git index back to the
/// working tree.
///
/// - Whole-file: `git reset HEAD -- <path>` (moves staged changes back to
///   the working tree without touching the working-tree content).
/// - Per-hunk: `git apply --cached --reverse --whitespace=nowarn` (reverses
///   only the hunk delta in the index).
pub(crate) async fn unstage_file_inner(req: StageFileRequest) -> Result<(), String> {
    let cwd = validate_cwd(&req.cwd)?;
    validate_hunk_patch(&cwd, &req.path, req.hunk_patch.as_deref())?;
    match &req.hunk_patch {
        None => {
            let mut cmd = Command::new("git");
            cmd.current_dir(&cwd)
                .args(["reset", "HEAD", "--", &req.path]);
            run_git_with_timeout(cmd).await.map(|_| ())?;
        }
        Some(patch) => {
            run_git_apply_with_patch(
                &cwd,
                &["apply", "--cached", "--reverse", "--whitespace=nowarn"],
                patch,
            )
            .await?;
        }
    }
    Ok(())
}

/// Discard working-tree changes for a file (whole-file or per-hunk).
///
/// Whole-file branches on tracked vs untracked:
/// - Untracked: `git clean -f -- <path>` (removes the file).
/// - Tracked + `DiscardScope::Unstaged`: `git checkout -- <path>` (restores
///   working-tree content from the index; staged changes are preserved).
/// - Tracked + `DiscardScope::Both`:
///   1. `git reset HEAD -- <path>` (unstage).
///   2. Re-evaluate working-tree state via `git status --porcelain`:
///      - If the path is now untracked (was a staged-new file with no
///        prior HEAD version): `git clean -f -- <path>` to remove it.
///      - Otherwise (was a tracked file modified or deleted in the index):
///        `git checkout -- <path>` to restore working-tree to HEAD.
///
///   This correctly handles the `A ` (staged-new) case where `git checkout`
///   would be a no-op after the reset.
///
/// Per-hunk: `git apply --reverse --whitespace=nowarn` (reverses the hunk
/// in the working tree; scope is ignored because per-hunk discard always
/// targets the diff the hunk came from).
pub(crate) async fn discard_file_inner(req: DiscardFileRequest) -> Result<(), String> {
    let cwd = validate_cwd(&req.cwd)?;
    validate_hunk_patch(&cwd, &req.path, req.hunk_patch.as_deref())?;
    match &req.hunk_patch {
        None => {
            let is_untracked = git_status_porcelain_is_untracked(&cwd, &req.path).await?;
            if is_untracked {
                let mut cmd = Command::new("git");
                cmd.current_dir(&cwd).args(["clean", "-f", "--", &req.path]);
                run_git_with_timeout(cmd).await.map(|_| ())?;
            } else if matches!(req.scope, DiscardScope::Both) {
                // Step 1: unstage any staged changes.
                let mut cmd = Command::new("git");
                cmd.current_dir(&cwd)
                    .args(["reset", "HEAD", "--", &req.path]);
                run_git_with_timeout(cmd).await.map(|_| ())?;
                // Step 2: re-evaluate — after unstaging a NEW file the path
                // becomes untracked; after unstaging a modified tracked file
                // the path remains tracked (working-tree edits vs HEAD).
                let now_untracked = git_status_porcelain_is_untracked(&cwd, &req.path).await?;
                if now_untracked {
                    // Staged-new file: no HEAD version → remove from disk.
                    let mut cmd = Command::new("git");
                    cmd.current_dir(&cwd).args(["clean", "-f", "--", &req.path]);
                    run_git_with_timeout(cmd).await.map(|_| ())?;
                } else {
                    // Tracked file: restore working tree to HEAD.
                    let mut cmd = Command::new("git");
                    cmd.current_dir(&cwd).args(["checkout", "--", &req.path]);
                    run_git_with_timeout(cmd).await.map(|_| ())?;
                }
            } else {
                let mut cmd = Command::new("git");
                cmd.current_dir(&cwd).args(["checkout", "--", &req.path]);
                run_git_with_timeout(cmd).await.map(|_| ())?;
            }
        }
        Some(patch) => {
            run_git_apply_with_patch(&cwd, &["apply", "--reverse", "--whitespace=nowarn"], patch)
                .await?;
        }
    }
    Ok(())
}

/// Git file status matching TypeScript's ChangedFileStatus type
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangedFileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

/// A file with git changes
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: ChangedFileStatus,
    pub staged: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insertions: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u32>,
}

/// Parse `git diff --numstat -z` output into a path → (added, removed) map.
///
/// Format (NUL-separated, LF-stripped inside records):
///   non-rename: "<added>\t<deleted>\t<path>\0"
///   rename:     "<added>\t<deleted>\t\0<src-path>\0<dst-path>\0"
///
/// Binary files report "-\t-\t..." and are omitted from the map.
/// Renames are keyed on the **dst** path (matches ChangedFile.path, which
/// porcelain -z also sets to the dst). The `-z` form is mandatory — the
/// default text form uses brace-compressed renames like
/// `src/{Foo.tsx => Bar.tsx}` that would not match ChangedFile.path and
/// would drop +N/-N badges on every renamed row.
fn parse_numstat(output: &[u8]) -> HashMap<String, (u32, u32)> {
    let mut stats = HashMap::new();
    let records: Vec<&[u8]> = output.split(|&b| b == b'\0').collect();
    let mut i = 0;

    while i < records.len() {
        let record = records[i];

        // Skip empty records (trailing NUL produces one)
        if record.is_empty() {
            i += 1;
            continue;
        }

        // Parse the tab-separated fields
        let parts: Vec<&[u8]> = record.split(|&b| b == b'\t').collect();

        if parts.len() < 3 {
            // Malformed record, skip
            i += 1;
            continue;
        }

        // Parse insertions and deletions
        let insertions_str = String::from_utf8_lossy(parts[0]);
        let deletions_str = String::from_utf8_lossy(parts[1]);
        let is_binary = insertions_str == "-" || deletions_str == "-";
        let is_rename = parts[2].is_empty();

        if is_rename {
            if is_binary {
                i += 3;
                continue;
            }

            let insertions = insertions_str.parse::<u32>().unwrap_or(0);
            let deletions = deletions_str.parse::<u32>().unwrap_or(0);

            // Rename format: next two NUL-separated tokens are src and dst
            i += 1;
            let _src_path = records.get(i).map(|b| String::from_utf8_lossy(b));
            i += 1;
            if let Some(dst_bytes) = records.get(i) {
                let dst_path = String::from_utf8_lossy(dst_bytes).to_string();
                if !dst_path.is_empty() {
                    stats.insert(dst_path, (insertions, deletions));
                }
            }
        } else {
            // Skip binary files (marked as "-\t-\t...")
            if is_binary {
                i += 1;
                continue;
            }

            let insertions = insertions_str.parse::<u32>().unwrap_or(0);
            let deletions = deletions_str.parse::<u32>().unwrap_or(0);
            let path_field = String::from_utf8_lossy(parts[2]);

            // Non-rename: path is in the third field. Reject brace-compressed
            // text form (like "src/{A.tsx => B.tsx}") which only appears in
            // the non-`-z` output. `-z` uses NUL separators for renames —
            // an inline " => " inside the path field means we're being fed
            // text form, which would silently mismatch every ChangedFile.path.
            if path_field.contains(" => ") {
                i += 1;
                continue;
            }
            stats.insert(path_field.to_string(), (insertions, deletions));
        }

        i += 1;
    }

    stats
}

/// Diff line type — variant names match TS `DiffLine.type` via
/// `rename_all = "lowercase"`: `Added` → `"added"`, etc.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum DiffLineType {
    Added,
    Removed,
    Context,
}

/// A single line within a diff hunk
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    #[serde(rename = "type")]
    #[cfg_attr(test, ts(rename = "type"))]
    pub line_type: DiffLineType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub old_line_number: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub new_line_number: Option<u32>,
}

/// A single hunk within a file diff
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub id: String,
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

/// Parsed diff for a single file — field names match TS `FileDiff` via
/// `rename_all = "camelCase"`: `file_path` → `"filePath"`, etc.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub file_path: String,
    /// Intentionally serialized as a required nullable field, not omitted.
    pub old_path: Option<String>,
    /// Intentionally serialized as a required nullable field, not omitted.
    pub new_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
}

/// Response payload for `get_git_diff` — parsed FileDiff plus the raw
/// before/after file contents that Pierre needs to render via Shiki,
/// plus the raw unified-diff text reused by PR2's `extractHunkPatch`.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GetGitDiffResponse {
    pub file_diff: FileDiff,
    /// Old file contents at the diff's base (HEAD or index, depending on
    /// `staged`). Empty string when the file is untracked or newly added.
    pub old_text: String,
    /// New file contents at the diff's tip (index or working tree).
    /// Empty string when the file has been deleted.
    pub new_text: String,
    /// The raw unified-diff text. Reused by PR2's `extractHunkPatch()`.
    pub raw_diff: String,
    /// Absolute path of the git repository toplevel (canonicalized). Empty
    /// when `cwd` is not inside a git repo. The frontend joins this with the
    /// repo-root-relative file path to build an absolute reference an agent
    /// can resolve regardless of its own cwd (PR4 inline-feedback dispatch).
    pub repo_root: String,
}

fn raw_diff_file_header_has(raw_diff: &str, marker: &str) -> bool {
    for line in raw_diff.lines() {
        if line.starts_with("@@") {
            return false;
        }
        if line.starts_with(marker) {
            return true;
        }
    }

    false
}

/// Heuristic: the raw unified-diff file header contains `+++ /dev/null` when
/// git encoded a deletion. Cheaper and more deterministic than racing the
/// filesystem, and scoped before the first hunk so matching file content does
/// not look like metadata.
fn raw_diff_is_deletion(raw_diff: &str) -> bool {
    raw_diff_file_header_has(raw_diff, "+++ /dev/null")
}

/// Same heuristic for "no prior version at HEAD" — `--- /dev/null`.
fn raw_diff_is_new_at_base(raw_diff: &str) -> bool {
    raw_diff_file_header_has(raw_diff, "--- /dev/null")
}

/// Parse git status --porcelain=v1 -z output into ChangedFile structs
///
/// Porcelain v1 with `-z` uses NUL as the record terminator. Rename and
/// copy entries emit TWO NUL-separated paths: `XY dest\0src\0`. We
/// consume the second path as the old name for the entry.
fn parse_git_status(output: &str) -> Vec<ChangedFile> {
    let mut files = Vec::new();
    let entries: Vec<&str> = output.split('\0').collect();
    let mut i = 0;

    while i < entries.len() {
        let entry = entries[i];
        if entry.len() < 3 {
            i += 1;
            continue;
        }

        let xy = &entry[0..2];
        let path = entry[3..].to_string();

        // Detect rename/copy — first char of XY is R or C (may include
        // a score like "R100" in some formats, but porcelain v1 uses
        // two-char XY: "R " or "C ").
        let is_rename_or_copy = xy.starts_with('R') || xy.starts_with('C');

        // Parse XY status codes
        // X = index status, Y = worktree status
        // For MM and AM, emit TWO entries to represent both halves
        match xy {
            "??" => {
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Untracked,
                    staged: false,
                    insertions: None,
                    deletions: None,
                });
            }
            "M " => {
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Modified,
                    staged: true,
                    insertions: None,
                    deletions: None,
                });
            }
            " M" => {
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Modified,
                    staged: false,
                    insertions: None,
                    deletions: None,
                });
            }
            "MM" => {
                // Emit TWO entries: staged Modified + unstaged Modified
                files.push(ChangedFile {
                    path: path.clone(),
                    status: ChangedFileStatus::Modified,
                    staged: true,
                    insertions: None,
                    deletions: None,
                });
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Modified,
                    staged: false,
                    insertions: None,
                    deletions: None,
                });
            }
            "A " => {
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Added,
                    staged: true,
                    insertions: None,
                    deletions: None,
                });
            }
            " A" => {
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Added,
                    staged: false,
                    insertions: None,
                    deletions: None,
                });
            }
            "AM" => {
                // Emit TWO entries: staged Added + unstaged Modified
                files.push(ChangedFile {
                    path: path.clone(),
                    status: ChangedFileStatus::Added,
                    staged: true,
                    insertions: None,
                    deletions: None,
                });
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Modified,
                    staged: false,
                    insertions: None,
                    deletions: None,
                });
            }
            "D " => {
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Deleted,
                    staged: true,
                    insertions: None,
                    deletions: None,
                });
            }
            " D" => {
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Deleted,
                    staged: false,
                    insertions: None,
                    deletions: None,
                });
            }
            s if s.starts_with('R') || s.starts_with('C') => {
                // Renames and copies are index operations, but the destination
                // path can still have unstaged worktree edits.
                let worktree_status = xy.as_bytes().get(1).copied();
                files.push(ChangedFile {
                    path: path.clone(),
                    status: ChangedFileStatus::Renamed,
                    staged: true,
                    insertions: None,
                    deletions: None,
                });
                if let Some(status) = match worktree_status {
                    Some(b'M') => Some(ChangedFileStatus::Modified),
                    Some(b'D') => Some(ChangedFileStatus::Deleted),
                    Some(b'A') => Some(ChangedFileStatus::Added),
                    Some(b'R') | Some(b'C') => Some(ChangedFileStatus::Renamed),
                    _ => None,
                } {
                    files.push(ChangedFile {
                        path,
                        status,
                        staged: false,
                        insertions: None,
                        deletions: None,
                    });
                }
            }
            "DD" | "DU" | "UD" => {
                // Delete-style merge conflicts should not try to open a
                // missing worktree file as modified.
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Deleted,
                    staged: false,
                    insertions: None,
                    deletions: None,
                });
            }
            "UU" | "AA" | "AU" | "UA" => {
                // Merge conflict codes without a deletion side are shown as
                // unstaged modified until the UI grows conflict-specific state.
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Modified,
                    staged: false,
                    insertions: None,
                    deletions: None,
                });
            }
            _ => {
                // Default to modified unstaged for unknown codes
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Modified,
                    staged: false,
                    insertions: None,
                    deletions: None,
                });
            }
        }

        // For renames/copies, consume the next NUL-separated token as old path
        if is_rename_or_copy {
            i += 1;
            let _old_path = entries.get(i).map(|s| s.to_string());
            // old_path not surfaced in ChangedFile yet — tracked in FileDiff
        }

        i += 1;
    }

    files
}

/// Parse git diff output into a FileDiff struct
fn parse_git_diff(output: &str, file_path: &str) -> FileDiff {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<DiffHunk> = None;
    let mut old_line_num = 0u32;
    let mut new_line_num = 0u32;
    let mut old_path: Option<String> = None;
    let mut new_path: Option<String> = None;

    for line in output.lines() {
        if let Some(path) = line
            .strip_prefix("rename from ")
            .or_else(|| line.strip_prefix("copy from "))
        {
            old_path = Some(decode_git_patch_path(path));
        } else if let Some(path) = line
            .strip_prefix("rename to ")
            .or_else(|| line.strip_prefix("copy to "))
        {
            new_path = Some(decode_git_patch_path(path));
        } else if line.starts_with("@@") {
            // Save previous hunk if exists
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }

            // Parse hunk header: @@ -old_start,old_lines +new_start,new_lines @@
            let header = line.to_string();
            let parts: Vec<&str> = line.split_whitespace().collect();

            let (old_start, old_lines) = if parts.len() > 1 {
                parse_hunk_range(parts[1])
            } else {
                (0, 0)
            };

            let (new_start, new_lines) = if parts.len() > 2 {
                parse_hunk_range(parts[2])
            } else {
                (0, 0)
            };

            old_line_num = old_start;
            new_line_num = new_start;

            current_hunk = Some(DiffHunk {
                id: format!("hunk-{}-{}", old_start, new_start),
                header,
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
        } else if let Some(ref mut hunk) = current_hunk {
            // Parse diff line
            let (line_type, content) = if let Some(stripped) = line.strip_prefix('+') {
                (DiffLineType::Added, stripped)
            } else if let Some(stripped) = line.strip_prefix('-') {
                (DiffLineType::Removed, stripped)
            } else if let Some(stripped) = line.strip_prefix(' ') {
                (DiffLineType::Context, stripped)
            } else {
                // Skip non-diff lines (e.g., "\ No newline at end of file")
                continue;
            };

            let (old_line_number, new_line_number) = match line_type {
                DiffLineType::Added => {
                    let num = new_line_num;
                    new_line_num += 1;
                    (None, Some(num))
                }
                DiffLineType::Removed => {
                    let num = old_line_num;
                    old_line_num += 1;
                    (Some(num), None)
                }
                DiffLineType::Context => {
                    let old_num = old_line_num;
                    let new_num = new_line_num;
                    old_line_num += 1;
                    new_line_num += 1;
                    (Some(old_num), Some(new_num))
                }
            };

            hunk.lines.push(DiffLine {
                line_type,
                content: content.to_string(),
                old_line_number,
                new_line_number,
            });
        }
    }

    // Save last hunk
    if let Some(hunk) = current_hunk {
        hunks.push(hunk);
    }

    FileDiff {
        file_path: file_path.to_string(),
        old_path,
        new_path,
        hunks,
    }
}

fn decode_git_patch_path(path: &str) -> String {
    let Some(quoted) = path.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else {
        return path.to_string();
    };

    let mut bytes = Vec::with_capacity(quoted.len());
    let mut chars = quoted.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '\\' {
            let mut buf = [0; 4];
            bytes.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
            continue;
        }

        let Some(escaped) = chars.next() else {
            bytes.push(b'\\');
            break;
        };

        match escaped {
            '0'..='7' => {
                let mut octal_escape = String::with_capacity(3);
                octal_escape.push(escaped);
                let mut value = escaped.to_digit(8).unwrap_or(0) as u16;
                for _ in 0..2 {
                    let Some(next) = chars.peek().copied() else {
                        break;
                    };
                    let Some(digit) = next.to_digit(8) else {
                        break;
                    };
                    octal_escape.push(next);
                    value = (value * 8) + digit as u16;
                    chars.next();
                }
                if let Ok(byte) = u8::try_from(value) {
                    bytes.push(byte);
                } else {
                    bytes.push(b'\\');
                    bytes.extend_from_slice(octal_escape.as_bytes());
                }
            }
            'a' => bytes.push(0x07),
            'b' => bytes.push(0x08),
            'f' => bytes.push(0x0c),
            'n' => bytes.push(b'\n'),
            'r' => bytes.push(b'\r'),
            't' => bytes.push(b'\t'),
            'v' => bytes.push(0x0b),
            '\\' => bytes.push(b'\\'),
            '"' => bytes.push(b'"'),
            other => {
                bytes.push(b'\\');
                let mut buf = [0; 4];
                bytes.extend_from_slice(other.encode_utf8(&mut buf).as_bytes());
            }
        }
    }

    String::from_utf8_lossy(&bytes).into_owned()
}

/// Parse hunk range like "-102,7" or "+102,6" into (start, lines)
fn parse_hunk_range(range: &str) -> (u32, u32) {
    let range = range.trim_start_matches(&['-', '+'][..]);
    let parts: Vec<&str> = range.split(',').collect();

    let start = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let lines = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);

    (start, lines)
}

/// Get all files with git changes.
// Git unit tests call the command name directly with plain args.
#[cfg(test)]
pub async fn git_status(cwd: String) -> Result<Vec<ChangedFile>, String> {
    git_status_inner(cwd).await
}

pub(crate) async fn git_status_inner(cwd: String) -> Result<Vec<ChangedFile>, String> {
    let safe_cwd = validate_cwd(&cwd)?;

    // Resolve repo toplevel — if not in a repo, return empty list
    let mut toplevel_cmd = Command::new("git");
    toplevel_cmd
        .arg("-C")
        .arg(&safe_cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .env("GIT_TERMINAL_PROMPT", "0");

    let toplevel_output = run_git_with_timeout(toplevel_cmd).await?;

    if !toplevel_output.status.success() {
        // Not a git repo — return empty list (no error state)
        return Ok(vec![]);
    }

    let toplevel_str = String::from_utf8_lossy(&toplevel_output.stdout);
    let toplevel_path = toplevel_str.trim();

    // Canonicalize and validate toplevel is under $HOME
    let canonical_toplevel = validate_cwd(toplevel_path)?;

    // Run git status and numstat commands from toplevel.
    //
    // `--untracked-files=all` is load-bearing for file-oriented UIs like the
    // diff sidebar. Without it, Git collapses an untracked directory tree to a
    // single `?? dir/` row, which is not diffable and renders as a blank label
    // in basename-only views (`split('/').pop()` on a trailing slash => "").
    let mut status_cmd = Command::new("git");
    status_cmd
        .arg("-C")
        .arg(&canonical_toplevel)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("--untracked-files=all")
        .arg("-z")
        .env("GIT_TERMINAL_PROMPT", "0");

    let mut diff_cmd = Command::new("git");
    diff_cmd
        .arg("-C")
        .arg(&canonical_toplevel)
        .arg("diff")
        .arg("--numstat")
        .arg("-z")
        .env("GIT_TERMINAL_PROMPT", "0");

    let mut cached_diff_cmd = Command::new("git");
    cached_diff_cmd
        .arg("-C")
        .arg(&canonical_toplevel)
        .arg("diff")
        .arg("--cached")
        .arg("--numstat")
        .arg("-z")
        .env("GIT_TERMINAL_PROMPT", "0");

    // Run status + both diff commands in parallel. The three subprocesses
    // are independent; the earlier revision awaited status serially before
    // the diffs, adding unnecessary latency to every watcher-triggered
    // refresh. With all three in one `join!`, wall-clock time is the max
    // of the three rather than the sum of one + max of two.
    let (status_output, diff_output, cached_diff_output) = tokio::join!(
        run_git_with_timeout(status_cmd),
        run_git_with_timeout(diff_cmd),
        run_git_with_timeout(cached_diff_cmd),
    );

    let status_output = status_output?;
    let diff_output = diff_output?;
    let cached_diff_output = cached_diff_output?;

    // Check all commands succeeded
    if !status_output.status.success() {
        let stderr = String::from_utf8_lossy(&status_output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!("git status failed with exit code {}", status_output.status)
        } else {
            format!("git status failed: {}", stderr.trim())
        });
    }

    if !diff_output.status.success() {
        let stderr = String::from_utf8_lossy(&diff_output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!("git diff failed with exit code {}", diff_output.status)
        } else {
            format!("git diff failed: {}", stderr.trim())
        });
    }

    if !cached_diff_output.status.success() {
        let stderr = String::from_utf8_lossy(&cached_diff_output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!(
                "git diff --cached failed with exit code {}",
                cached_diff_output.status
            )
        } else {
            format!("git diff --cached failed: {}", stderr.trim())
        });
    }

    // Parse outputs
    let status_stdout = String::from_utf8_lossy(&status_output.stdout);
    let mut files = parse_git_status(&status_stdout);

    let working_tree_stats = parse_numstat(&diff_output.stdout);
    let cached_stats = parse_numstat(&cached_diff_output.stdout);

    // Merge numstat data into ChangedFile entries
    for file in &mut files {
        if file.staged {
            // Staged entries look up cached map
            if let Some((insertions, deletions)) = cached_stats.get(&file.path) {
                file.insertions = Some(*insertions);
                file.deletions = Some(*deletions);
            }
        } else {
            // Unstaged entries look up working-tree map
            if let Some((insertions, deletions)) = working_tree_stats.get(&file.path) {
                file.insertions = Some(*insertions);
                file.deletions = Some(*deletions);
            }
        }
        // Untracked rows need a separate pass (see below) — the two numstat
        // maps above don't include them because untracked paths aren't in
        // the index.
    }

    // Second pass: synthesize numstat for untracked files via
    // `git diff --no-index /dev/null <file>` so the sidebar `+N / -0`
    // badge reflects the file's actual line count. Skips binary files
    // (helper returns None) so they stay badge-less.
    //
    // Parallelized via `tokio::task::JoinSet` with a Semaphore-bounded
    // fan-out. `run_git_with_timeout` fork+execs synchronously on the
    // task thread before its first await, so without the semaphore a
    // repo with many untracked files (freshly scaffolded, post-`git
    // stash pop`, pre-first-commit builds) would instantly fork N git
    // processes — blowing out the process table and Tokio worker threads.
    // A cap of 8 matches typical disk-I/O parallelism while preserving
    // nearly all of the latency win over fully-serial execution.
    const UNTRACKED_NUMSTAT_MAX_CONCURRENCY: usize = 8;

    let untracked_indices: Vec<(usize, String)> = files
        .iter()
        .enumerate()
        .filter(|(_, f)| matches!(f.status, ChangedFileStatus::Untracked))
        .map(|(i, f)| (i, f.path.clone()))
        .collect();

    if !untracked_indices.is_empty() {
        let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(
            UNTRACKED_NUMSTAT_MAX_CONCURRENCY,
        ));
        let mut set = tokio::task::JoinSet::new();
        for (idx, path) in untracked_indices {
            let toplevel = canonical_toplevel.clone();
            let sem = sem.clone();
            set.spawn(async move {
                // Acquire a permit BEFORE the blocking fork+exec in
                // `run_git_with_timeout` (called inside the helper).
                // `.expect` is safe: the Semaphore is owned by this
                // function and never closed.
                let _permit = sem.acquire_owned().await.expect("semaphore closed");
                let counts = get_untracked_numstat(&toplevel, &path).await.ok().flatten();
                (idx, counts)
            });
        }

        while let Some(join_result) = set.join_next().await {
            if let Ok((idx, Some((insertions, deletions)))) = join_result {
                files[idx].insertions = Some(insertions);
                files[idx].deletions = Some(deletions);
            }
        }
    }

    Ok(files)
}

/// Check whether a repo-relative file path is untracked under the given
/// toplevel. Uses `git ls-files --error-unmatch`: exit 0 = tracked, non-zero
/// = untracked (or the path doesn't exist, or some other git error — all
/// treated as "not tracked" which is the safe fallback for the caller).
async fn is_file_untracked(toplevel: &Path, file: &str) -> Result<bool, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(toplevel)
        .arg("ls-files")
        .arg("--error-unmatch")
        .arg("--")
        .arg(file)
        .env("GIT_TERMINAL_PROMPT", "0");

    let output = run_git_with_timeout(cmd).await?;
    Ok(!output.status.success())
}

/// Platform-portable path to the null device for `git diff --no-index`.
/// On Unix this is `/dev/null`; on Windows, `NUL`. Git accepts both on
/// their respective platforms but not cross-platform, so cfg-dispatch.
#[cfg(windows)]
const NULL_DEVICE: &str = "NUL";
#[cfg(not(windows))]
const NULL_DEVICE: &str = "/dev/null";

/// Run `git diff --no-index /dev/null <file>` to synthesize an "all new"
/// diff for an untracked file. The regular `git diff -- <file>` produces
/// empty output for untracked paths (git won't diff against the index
/// because the file isn't in it), which made the diff viewer unable to
/// show content for new-but-not-yet-staged files. This fallback shows the
/// full file content as one big set of added lines.
///
/// `git diff --no-index` exits 0 when files are identical, 1 when they
/// differ (expected here since the comparison is against an empty file),
/// and other codes for genuine errors.
async fn get_untracked_diff(toplevel: &Path, file: &str) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(toplevel)
        .arg("diff")
        .arg("--no-index")
        .arg("--no-color")
        .arg("--")
        .arg(NULL_DEVICE)
        .arg(file)
        .env("GIT_TERMINAL_PROMPT", "0");

    let output = run_git_with_timeout(cmd).await?;

    let exit_code = output.status.code().unwrap_or(-1);
    if exit_code != 0 && exit_code != 1 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!(
                "git diff --no-index failed with exit code {}",
                output.status
            )
        } else {
            format!("git diff --no-index failed: {}", stderr.trim())
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Run `git diff --no-index --numstat -z /dev/null <file>` to get numstat
/// counts for an untracked file. Returns `Some((insertions, deletions))`
/// for a text file (deletions is always 0 for an all-new file), `None`
/// for binary files or on any soft failure (caller treats it as "no
/// numstat available" and leaves the sidebar badge off).
///
/// Invoked per untracked file from `git_status`. The regular `git diff
/// --numstat` run from `git_status` doesn't see untracked paths because
/// they aren't in the index, so without this fallback the sidebar
/// `+N / -N` badge would never render for untracked rows — even though
/// the row click now successfully shows the full-content diff in the
/// viewer via `get_untracked_diff`.
async fn get_untracked_numstat(toplevel: &Path, file: &str) -> Result<Option<(u32, u32)>, String> {
    let file_abs = toplevel.join(file);

    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(toplevel)
        .arg("diff")
        .arg("--no-index")
        .arg("--numstat")
        .arg("-z")
        .arg("--")
        .arg(NULL_DEVICE)
        .arg(&file_abs)
        .env("GIT_TERMINAL_PROMPT", "0");

    let output = run_git_with_timeout(cmd).await?;
    let exit_code = output.status.code().unwrap_or(-1);

    // Exit 1 is normal for --no-index when files differ.
    // Exit 0 means they were identical (empty untracked file vs /dev/null).
    // Anything else is a genuine error; soft-fail rather than poisoning the
    // whole git_status response.
    if exit_code != 0 && exit_code != 1 {
        return Ok(None);
    }

    // First record has shape `<ins>\t<del>\t<path>\0`. We only care about the
    // first two fields; the path is the absolute one we passed in so there's
    // nothing useful to parse from it.
    let first_record: &[u8] = output.stdout.split(|&b| b == b'\0').next().unwrap_or(&[]);
    let parts: Vec<&[u8]> = first_record.split(|&b| b == b'\t').collect();

    if parts.len() < 2 {
        return Ok(None);
    }

    let ins_str = String::from_utf8_lossy(parts[0]);
    let del_str = String::from_utf8_lossy(parts[1]);

    // Binary files report `-\t-\t<path>`.
    if ins_str == "-" || del_str == "-" {
        return Ok(None);
    }

    let insertions = ins_str.parse::<u32>().ok();
    let deletions = del_str.parse::<u32>().ok();

    match (insertions, deletions) {
        (Some(i), Some(d)) => Ok(Some((i, d))),
        _ => Ok(None),
    }
}

/// Get diff for a specific file.
// Git unit tests call the command name directly with plain args.
#[cfg(test)]
pub async fn get_git_diff(
    cwd: String,
    file: String,
    staged: bool,
    untracked: Option<bool>,
) -> Result<GetGitDiffResponse, String> {
    get_git_diff_inner(cwd, file, staged, untracked).await
}

pub(crate) async fn get_git_diff_inner(
    cwd: String,
    file: String,
    staged: bool,
    untracked: Option<bool>,
) -> Result<GetGitDiffResponse, String> {
    let safe_cwd = validate_cwd(&cwd)?;
    validate_file_path(&file)?;

    // Resolve repo toplevel — if not in a repo, return empty response.
    let mut toplevel_cmd = Command::new("git");
    toplevel_cmd
        .arg("-C")
        .arg(&safe_cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .env("GIT_TERMINAL_PROMPT", "0");

    let toplevel_output = run_git_with_timeout(toplevel_cmd).await?;

    if !toplevel_output.status.success() {
        // Not a git repo — return empty response.
        return Ok(GetGitDiffResponse {
            file_diff: FileDiff {
                file_path: file.clone(),
                old_path: None,
                new_path: None,
                hunks: vec![],
            },
            old_text: String::new(),
            new_text: String::new(),
            raw_diff: String::new(),
            repo_root: String::new(),
        });
    }

    let toplevel_str = String::from_utf8_lossy(&toplevel_output.stdout);
    let toplevel_path = toplevel_str.trim();

    // Canonicalize and validate toplevel is under $HOME
    let canonical_toplevel = validate_cwd(toplevel_path)?;

    // Detect a rename touching `file`. `git diff -M -- <single path>` cannot
    // see renames (the second endpoint is outside the path filter), so we
    // probe the rename-status output once over the full diff scope. When
    // `file` appears as a rename destination, we re-run `git diff` against
    // BOTH endpoints so the unified-diff header carries `rename from <old>`
    // and `parse_git_diff` populates `file_diff.old_path`.
    let rename_source = detect_rename_source(&canonical_toplevel, &file, staged).await?;

    // Run git diff from toplevel
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&canonical_toplevel)
        .arg("diff")
        .arg("--no-color")
        .env("GIT_TERMINAL_PROMPT", "0");

    if staged {
        cmd.arg("--cached");
    }

    // Rename detection needs to be on AND both endpoints must be in scope.
    if rename_source.is_some() {
        cmd.arg("-M");
    }

    cmd.arg("--");
    if let Some(ref old) = rename_source {
        validate_file_path(old)?;
        cmd.arg(old);
    }
    cmd.arg(&file);

    let output = run_git_with_timeout(cmd).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!("git diff failed with exit code {}", output.status)
        } else {
            format!("git diff failed: {}", stderr.trim())
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed = parse_git_diff(&stdout, &file);

    // Fallback for untracked files: the regular `git diff -- <file>`
    // produces empty output because untracked paths aren't in the index.
    // When that's the case AND we're asking for the working-tree side
    // (staged == false), try `git diff --no-index /dev/null <file>` to
    // synthesize a full-content diff so the viewer can show it as "all
    // new lines" instead of a blank pane.
    //
    // Skipped for staged == true: staged new files show up as status "A"
    // and `git diff --cached -- <file>` already produces correct output
    // for them. Only the untracked (status "??") path needs the fallback.
    let should_try_untracked_fallback = if parsed.hunks.is_empty() && !staged {
        match untracked {
            Some(value) => value,
            None => is_file_untracked(&canonical_toplevel, &file).await?,
        }
    } else {
        false
    };

    let (file_diff, raw_diff, is_untracked) = if should_try_untracked_fallback {
        let untracked_stdout = get_untracked_diff(&canonical_toplevel, &file).await?;
        let parsed_untracked = parse_git_diff(&untracked_stdout, &file);
        (parsed_untracked, untracked_stdout, true)
    } else {
        (parsed, stdout.into_owned(), false)
    };

    // Resolve old/new paths with rename awareness. On rename, the diff
    // header carries `rename from <old>` / `rename to <new>` so we can
    // fetch each side from its actual path.
    let new_path = file_diff
        .new_path
        .as_deref()
        .unwrap_or(file_diff.file_path.as_str())
        .to_string();
    let old_path = file_diff
        .old_path
        .as_deref()
        .unwrap_or(new_path.as_str())
        .to_string();
    validate_file_path(&old_path)?;
    validate_file_path(&new_path)?;

    // Compute old_text per the four-case table:
    //   - Untracked (used --no-index branch) → ""
    //   - Newly-added staged file (--- /dev/null in header AND staged=true) → ""
    //   - staged=true → `git show HEAD:<old_path>`
    //   - staged=false → `git show :<old_path>` (index version)
    let is_new_at_base = raw_diff_is_new_at_base(&raw_diff);
    let old_text = if is_untracked || (staged && is_new_at_base) {
        String::new()
    } else {
        let ref_spec = if staged {
            format!("HEAD:{}", old_path)
        } else {
            format!(":{}", old_path)
        };
        let stage_fallback_ref = if staged {
            None
        } else {
            Some(format!(":2:{}", old_path))
        };
        git_show_text_with_fallback(
            &canonical_toplevel,
            &ref_spec,
            stage_fallback_ref.as_deref(),
        )
        .await?
    };

    // Compute new_text:
    //   - Deleted file (+++ /dev/null in header) → ""
    //   - staged=true → `git show :<new_path>` (index version)
    //   - else → filesystem read of `<toplevel>/<new_path>`
    //
    // The filesystem read maps `NotFound` to an empty string (covers a racy
    // delete between the diff and the read), decodes invalid UTF-8 lossily so
    // changed binary-ish files don't fail the whole diff request, and surfaces
    // every other I/O error so the frontend can render the error card.
    let is_deletion = raw_diff_is_deletion(&raw_diff);
    let new_text = if is_deletion {
        String::new()
    } else if staged {
        let ref_spec = format!(":{}", new_path);
        let stage_fallback_ref = format!(":2:{}", new_path);
        git_show_text_with_fallback(&canonical_toplevel, &ref_spec, Some(&stage_fallback_ref))
            .await?
    } else {
        read_worktree_text_no_follow(&canonical_toplevel, &new_path)?
    };

    Ok(GetGitDiffResponse {
        file_diff,
        old_text,
        new_text,
        raw_diff,
        repo_root: canonical_toplevel.to_string_lossy().into_owned(),
    })
}

/// If `file` is the destination of a rename in the diff scope (HEAD→index
/// when `staged`, index→worktree otherwise), return the source path so the
/// caller can re-run `git diff -M` against both endpoints. Returns `None`
/// when there is no rename involving `file`.
///
/// Internally runs `git diff --name-status -M -z` over the whole scope
/// (no path filter) — single-path `git diff -M -- <file>` cannot detect
/// renames because the second endpoint is outside the filter. The scan
/// is bounded by the count of changed files, not the size of the repo.
async fn detect_rename_source(
    toplevel: &Path,
    file: &str,
    staged: bool,
) -> Result<Option<String>, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(toplevel)
        .arg("diff")
        .arg("--name-status")
        .arg("--diff-filter=RC")
        .arg("-M")
        .arg("-z")
        .env("GIT_TERMINAL_PROMPT", "0");
    if staged {
        cmd.arg("--cached");
    }

    let output = match run_git_with_timeout(cmd).await {
        Ok(output) => output,
        Err(_) => return Ok(None),
    };
    if !output.status.success() {
        // Treat a failed probe as "no rename detected" rather than fatally
        // erroring the diff — the main `git diff` call below will surface
        // the real failure if there is one.
        return Ok(None);
    }

    // `-z` records: status\0src\0dst\0 for renames/copies; status\0path\0
    // for ordinary entries. Walk the tokens looking for `R<score>` /
    // `C<score>` whose `dst` equals `file`.
    let stdout = output.stdout;
    let tokens: Vec<&[u8]> = stdout.split(|&b| b == b'\0').collect();
    let mut i = 0;
    while i < tokens.len() {
        let tok = tokens[i];
        if tok.is_empty() {
            i += 1;
            continue;
        }

        let first = tok[0];
        if first == b'R' || first == b'C' {
            // Rename/copy entries consume src and dst.
            let src = tokens
                .get(i + 1)
                .map(|b| String::from_utf8_lossy(b).into_owned());
            let dst = tokens
                .get(i + 2)
                .map(|b| String::from_utf8_lossy(b).into_owned());
            if let (Some(src), Some(dst)) = (src, dst) {
                if dst == file {
                    return Ok(Some(src));
                }
            }
            i += 3;
        } else {
            // Ordinary entries consume one path.
            i += 2;
        }
    }

    Ok(None)
}

fn read_worktree_text_no_follow(toplevel: &Path, path: &str) -> Result<String, String> {
    let abs_path = toplevel.join(path);
    let metadata = match std::fs::symlink_metadata(&abs_path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(format!("stat {}: {}", abs_path.display(), e)),
    };

    if metadata.file_type().is_symlink() {
        let target = std::fs::read_link(&abs_path)
            .map_err(|e| format!("readlink {}: {}", abs_path.display(), e))?;
        return Ok(path_to_lossy_text(&target));
    }

    if !metadata.is_file() || metadata.len() > MAX_DIFF_FILE_TEXT_BYTES {
        return Ok(String::new());
    }

    match std::fs::read(&abs_path) {
        Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("read {}: {}", abs_path.display(), e)),
    }
}

#[cfg(unix)]
fn path_to_lossy_text(path: &Path) -> String {
    use std::os::unix::ffi::OsStrExt;

    String::from_utf8_lossy(path.as_os_str().as_bytes()).into_owned()
}

#[cfg(not(unix))]
fn path_to_lossy_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn is_expected_missing_git_show(stderr: &str) -> bool {
    stderr.contains("does not exist in")
        || stderr.contains("exists on disk, but not in")
        || stderr.contains("is in the index, but not at stage ")
}

/// Run `git show <ref>` from the given toplevel and return stdout as a
/// String. Empty string only for expected "no blob at this ref" states so
/// callers can render all-new / conflicted files without masking genuine git
/// failures such as missing LFS objects or corrupt packs.
async fn git_show_text_with_fallback(
    toplevel: &Path,
    ref_spec: &str,
    stage_fallback_ref: Option<&str>,
) -> Result<String, String> {
    let size = git_blob_size(toplevel, ref_spec).await?;
    if let Some(size) = size {
        return git_show_sized_text(toplevel, ref_spec, size).await;
    }

    if let Some(fallback_ref) = stage_fallback_ref {
        if let Some(size) = git_blob_size(toplevel, fallback_ref).await? {
            return git_show_sized_text(toplevel, fallback_ref, size).await;
        }
    }

    Ok(String::new())
}

async fn git_show_sized_text(toplevel: &Path, ref_spec: &str, size: u64) -> Result<String, String> {
    if size > MAX_DIFF_FILE_TEXT_BYTES {
        return Ok(String::new());
    }

    let output = run_git_show(toplevel, ref_spec).await?;
    git_show_output_to_text(ref_spec, output)
}

async fn run_git_show(toplevel: &Path, ref_spec: &str) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(toplevel)
        .arg("show")
        .arg(ref_spec)
        .env("GIT_TERMINAL_PROMPT", "0");

    run_git_with_timeout(cmd).await
}

async fn git_blob_size(toplevel: &Path, ref_spec: &str) -> Result<Option<u64>, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(toplevel)
        .arg("cat-file")
        .arg("-s")
        .arg(ref_spec)
        .env("GIT_TERMINAL_PROMPT", "0");

    let output = run_git_with_timeout(cmd).await?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let size = stdout
            .trim()
            .parse::<u64>()
            .map_err(|e| format!("git cat-file -s {} returned invalid size: {}", ref_spec, e))?;
        return Ok(Some(size));
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if is_expected_missing_git_show(&stderr) {
        return Ok(None);
    }

    Err(git_cat_file_error(ref_spec, &stderr, &output.status))
}

fn git_show_output_to_text(ref_spec: &str, output: std::process::Output) -> Result<String, String> {
    if output.status.success() {
        if output.stdout.len() as u64 > MAX_DIFF_FILE_TEXT_BYTES {
            return Ok(String::new());
        }
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if is_expected_missing_git_show(&stderr) {
        return Ok(String::new());
    }

    Err(git_show_error(ref_spec, &stderr, &output.status))
}

fn git_cat_file_error(ref_spec: &str, stderr: &str, status: &std::process::ExitStatus) -> String {
    if stderr.trim().is_empty() {
        format!(
            "git cat-file -s {} failed with exit code {}",
            ref_spec, status
        )
    } else {
        format!("git cat-file -s {} failed: {}", ref_spec, stderr.trim())
    }
}

fn git_show_error(ref_spec: &str, stderr: &str, status: &std::process::ExitStatus) -> String {
    if stderr.trim().is_empty() {
        format!("git show {} failed with exit code {}", ref_spec, status)
    } else {
        format!("git show {} failed: {}", ref_spec, stderr.trim())
    }
}

/// Get the current branch for a git repository.
// Git unit tests call the command name directly with plain args.
#[cfg(test)]
pub async fn git_branch(cwd: String) -> Result<String, String> {
    git_branch_inner(cwd).await
}

/// Resolve the linked-worktree name for `cwd`, or `None` when `cwd` is the
/// main checkout. Returns `Err` only when `cwd` is not a git repository or
/// fails scope validation — callers can treat `Ok(None)` and any error
/// symmetrically as "no worktree chip to display".
#[cfg(test)]
pub async fn git_worktree_name(cwd: String) -> Result<Option<String>, String> {
    git_worktree_name_inner(cwd).await
}

pub(crate) async fn git_worktree_name_inner(cwd: String) -> Result<Option<String>, String> {
    let safe_cwd = validate_cwd(&cwd)?;

    let mut git_dir_cmd = Command::new("git");
    git_dir_cmd
        .arg("-C")
        .arg(&safe_cwd)
        .arg("rev-parse")
        .arg("--path-format=absolute")
        .arg("--git-dir")
        .env("GIT_TERMINAL_PROMPT", "0");

    let git_dir_output = run_git_with_timeout(git_dir_cmd).await?;

    if !git_dir_output.status.success() {
        let stderr = String::from_utf8_lossy(&git_dir_output.stderr)
            .trim()
            .to_string();
        return Err(format!("git_worktree_name git-dir: {stderr}"));
    }

    let git_dir_str = String::from_utf8(git_dir_output.stdout)
        .map_err(|e| format!("git_worktree_name git-dir utf8: {}", e))?;
    let git_dir = Path::new(git_dir_str.trim());

    // A linked worktree's gitdir lives at `<gitdir-root>/worktrees/<name>`.
    // For a standard non-bare clone the gitdir root is `<repo>/.git`; for a
    // bare repo (e.g. `/srv/repos/project.git`) or a `--separate-git-dir`
    // clone the root ends in `.git` rather than literally being `.git`, so
    // accept any grandparent whose basename ends in `.git`. Anything else
    // (most commonly the main checkout's `<repo>/.git`) is treated as
    // not-a-linked-worktree.
    let parent_name = git_dir
        .parent()
        .and_then(Path::file_name)
        .and_then(|s| s.to_str());
    let grandparent = git_dir.parent().and_then(Path::parent);
    let grandparent_name = grandparent
        .and_then(Path::file_name)
        .and_then(|s| s.to_str());

    // Confirm the grandparent is a gitdir root. Three accepted shapes:
    //   - literally named `.git` (standard non-bare clone)
    //   - ends in `.git` (e.g. `project.git` for `--separate-git-dir` or
    //     bare repos that follow the `.git` naming convention)
    //   - a bare repo created without the `.git` suffix
    //     (`git init --bare /srv/repo` → gitdir root is `/srv/repo`).
    //     For these we can't tell from the path alone, so probe for a
    //     `HEAD` file inside the grandparent — present in every gitdir
    //     root (bare or non-bare).
    let grandparent_is_gitdir = match (grandparent, grandparent_name) {
        (Some(gp), Some(name)) => {
            name == ".git" || name.ends_with(".git") || gp.join("HEAD").is_file()
        }
        _ => false,
    };

    if parent_name != Some("worktrees") || !grandparent_is_gitdir {
        return Ok(None);
    }

    let mut top_cmd = Command::new("git");
    top_cmd
        .arg("-C")
        .arg(&safe_cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .env("GIT_TERMINAL_PROMPT", "0");

    let top_output = run_git_with_timeout(top_cmd).await?;

    if !top_output.status.success() {
        let stderr = String::from_utf8_lossy(&top_output.stderr)
            .trim()
            .to_string();
        return Err(format!("git_worktree_name show-toplevel: {stderr}"));
    }

    let top_str = String::from_utf8(top_output.stdout)
        .map_err(|e| format!("git_worktree_name show-toplevel utf8: {}", e))?;
    let top = Path::new(top_str.trim());

    Ok(top.file_name().and_then(|s| s.to_str()).map(str::to_string))
}

pub(crate) async fn git_branch_inner(cwd: String) -> Result<String, String> {
    let safe_cwd = validate_cwd(&cwd)?;

    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&safe_cwd)
        .arg("symbolic-ref")
        .arg("-q")
        .arg("--short")
        .arg("HEAD")
        .env("GIT_TERMINAL_PROMPT", "0");

    let output = run_git_with_timeout(cmd).await?;

    if output.status.success() {
        let branch = String::from_utf8(output.stdout)
            .map_err(|e| format!("git_branch utf8: {}", e))?
            .trim()
            .to_string();
        return Ok(branch);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        return Err(format!("git_branch: {stderr}"));
    }

    let mut rev = Command::new("git");
    rev.arg("-C")
        .arg(&safe_cwd)
        .arg("rev-parse")
        .arg("--short=7")
        .arg("--verify")
        .arg("HEAD")
        .env("GIT_TERMINAL_PROMPT", "0");

    let rev_out = run_git_with_timeout(rev).await?;

    if rev_out.status.success() {
        let sha = String::from_utf8(rev_out.stdout)
            .map_err(|e| format!("git_branch rev-parse utf8: {}", e))?
            .trim()
            .to_string();
        return Ok(sha);
    }

    Ok(String::new())
}

#[cfg(test)]
mod tests {
    use super::test_helpers::{configure_test_git, create_main_repo_with_worktrees, home_tempdir};
    use super::*;

    #[test]
    fn test_raw_diff_is_deletion_ignores_hunk_content() {
        let raw = "\
diff --git a/path.txt b/path.txt
--- a/path.txt
+++ b/path.txt
@@ -1 +1 @@
-old
+++ /dev/null
";

        assert!(!raw_diff_is_deletion(raw));
    }

    #[test]
    fn test_raw_diff_is_deletion_reads_file_header() {
        let raw = "\
diff --git a/path.txt b/path.txt
--- a/path.txt
+++ /dev/null
@@ -1 +0,0 @@
-old
";

        assert!(raw_diff_is_deletion(raw));
    }

    #[test]
    fn test_raw_diff_is_new_at_base_ignores_hunk_content() {
        let raw = "\
diff --git a/path.txt b/path.txt
--- a/path.txt
+++ b/path.txt
@@ -1 +1 @@
--- /dev/null
+new
";

        assert!(!raw_diff_is_new_at_base(raw));
    }

    // parse_numstat tests

    #[test]
    fn test_parse_numstat_non_rename() {
        let output = b"5\t3\tsrc/main.rs\0";
        let stats = parse_numstat(output);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats.get("src/main.rs"), Some(&(5, 3)));
    }

    #[test]
    fn test_parse_numstat_rename() {
        // Rename format: <ins>\t<del>\t\0<src>\0<dst>\0
        // Keyed on dst (destination path)
        let output = b"10\t2\t\0old/path.rs\0new/path.rs\0";
        let stats = parse_numstat(output);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats.get("new/path.rs"), Some(&(10, 2)));
        assert_eq!(stats.get("old/path.rs"), None);
    }

    #[test]
    fn test_parse_numstat_binary_skipped() {
        // Binary files report "-\t-\t..." and should be skipped
        let output = b"-\t-\tbinary.png\05\t3\ttext.rs\0";
        let stats = parse_numstat(output);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats.get("text.rs"), Some(&(5, 3)));
        assert_eq!(stats.get("binary.png"), None);
    }

    #[test]
    fn test_parse_numstat_binary_rename_consumes_src_and_dst_tokens() {
        // Binary rename format: -\t-\t\0<src>\0<dst>\0. The source path may
        // legally contain tabs; it must still be consumed as a path token, not
        // reinterpreted as a standalone numstat record.
        let output = b"-\t-\t\05\t3\tbogus.rs\0dst.bin\07\t2\ttext.rs\0";
        let stats = parse_numstat(output);

        assert_eq!(stats.len(), 1);
        assert_eq!(stats.get("text.rs"), Some(&(7, 2)));
        assert_eq!(stats.get("bogus.rs"), None);
        assert_eq!(stats.get("dst.bin"), None);
    }

    #[test]
    fn test_parse_numstat_multiple_records() {
        let output = b"5\t3\tsrc/main.rs\010\t0\tsrc/new.rs\00\t7\tsrc/deleted.rs\0";
        let stats = parse_numstat(output);

        assert_eq!(stats.len(), 3);
        assert_eq!(stats.get("src/main.rs"), Some(&(5, 3)));
        assert_eq!(stats.get("src/new.rs"), Some(&(10, 0)));
        assert_eq!(stats.get("src/deleted.rs"), Some(&(0, 7)));
    }

    #[test]
    fn test_parse_numstat_empty_input() {
        let output = b"";
        let stats = parse_numstat(output);

        assert_eq!(stats.len(), 0);
    }

    #[test]
    fn test_parse_numstat_brace_format_regression() {
        // Regression test: parser assumes -z input; plain text form uses
        // brace-compressed renames like "src/{A.tsx => B.tsx}" which we
        // must NOT silently match. The parser should either skip this or
        // treat it as a malformed record (both are acceptable failure modes).
        let output = b"5\t3\tsrc/{A.tsx => B.tsx}\0";
        let stats = parse_numstat(output);

        // Parser should NOT create an entry for the brace-compressed form
        assert!(stats.get("src/{A.tsx => B.tsx}").is_none());
        assert!(stats.get("src/A.tsx").is_none());
        assert!(stats.get("src/B.tsx").is_none());
    }

    #[test]
    fn test_parse_git_status_modified() {
        let output = "M  src/main.rs\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/main.rs");
        assert!(matches!(files[0].status, ChangedFileStatus::Modified));
        assert!(files[0].staged);
    }

    #[test]
    fn test_parse_git_status_multiple_files() {
        let output = "M  src/main.rs\0 M src/lib.rs\0A  src/new.rs\0?? untracked.txt\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 4);

        // Staged modified
        assert_eq!(files[0].path, "src/main.rs");
        assert!(matches!(files[0].status, ChangedFileStatus::Modified));
        assert!(files[0].staged);

        // Unstaged modified
        assert_eq!(files[1].path, "src/lib.rs");
        assert!(matches!(files[1].status, ChangedFileStatus::Modified));
        assert!(!files[1].staged);

        // Staged added
        assert_eq!(files[2].path, "src/new.rs");
        assert!(matches!(files[2].status, ChangedFileStatus::Added));
        assert!(files[2].staged);

        // Untracked
        assert_eq!(files[3].path, "untracked.txt");
        assert!(matches!(files[3].status, ChangedFileStatus::Untracked));
        assert!(!files[3].staged);
    }

    #[test]
    fn test_parse_git_status_deleted() {
        let output = "D  removed.txt\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "removed.txt");
        assert!(matches!(files[0].status, ChangedFileStatus::Deleted));
        assert!(files[0].staged);
    }

    #[test]
    fn test_parse_git_status_renamed() {
        // Porcelain -z rename: "R  new.txt\0old.txt\0"
        let output = "R  new.txt\0old.txt\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new.txt");
        assert!(matches!(files[0].status, ChangedFileStatus::Renamed));
        assert!(files[0].staged);
    }

    #[test]
    fn test_parse_git_status_renamed_modified_dual_entry() {
        // RM = renamed in index, modified again in worktree.
        let output = "RM renamed.txt\0old.txt\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 2, "RM should produce two entries");

        // First entry: staged rename.
        assert_eq!(files[0].path, "renamed.txt");
        assert!(matches!(files[0].status, ChangedFileStatus::Renamed));
        assert!(files[0].staged, "First RM entry should be staged");

        // Second entry: unstaged modification on the renamed destination.
        assert_eq!(files[1].path, "renamed.txt");
        assert!(matches!(files[1].status, ChangedFileStatus::Modified));
        assert!(!files[1].staged, "Second RM entry should be unstaged");
    }

    #[test]
    fn test_parse_git_status_renamed_deleted_dual_entry() {
        // RD = renamed in index, deleted from worktree after staging.
        let output = "RD renamed.txt\0old.txt\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 2, "RD should produce two entries");

        assert_eq!(files[0].path, "renamed.txt");
        assert!(matches!(files[0].status, ChangedFileStatus::Renamed));
        assert!(files[0].staged, "First RD entry should be staged");

        assert_eq!(files[1].path, "renamed.txt");
        assert!(matches!(files[1].status, ChangedFileStatus::Deleted));
        assert!(!files[1].staged, "Second RD entry should be unstaged");
    }

    #[test]
    fn test_parse_git_status_renamed_copied_dual_entry() {
        // RC = renamed in index, copied again in worktree.
        let output = "RC renamed.txt\0old.txt\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 2, "RC should produce two entries");

        assert_eq!(files[0].path, "renamed.txt");
        assert!(matches!(files[0].status, ChangedFileStatus::Renamed));
        assert!(files[0].staged, "First RC entry should be staged");

        assert_eq!(files[1].path, "renamed.txt");
        assert!(matches!(files[1].status, ChangedFileStatus::Renamed));
        assert!(!files[1].staged, "Second RC entry should be unstaged");
    }

    #[test]
    fn test_parse_git_status_copied_modified_dual_entry() {
        // CM = copied in index, modified again in worktree.
        let output = "CM copied.txt\0source.txt\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 2, "CM should produce two entries");

        // Existing UI model represents copy entries with the rename status.
        assert_eq!(files[0].path, "copied.txt");
        assert!(matches!(files[0].status, ChangedFileStatus::Renamed));
        assert!(files[0].staged, "First CM entry should be staged");

        assert_eq!(files[1].path, "copied.txt");
        assert!(matches!(files[1].status, ChangedFileStatus::Modified));
        assert!(!files[1].staged, "Second CM entry should be unstaged");
    }

    #[test]
    fn test_parse_git_status_mm_dual_entry() {
        // MM = modified in both index and worktree.
        // New behavior: emit TWO entries, one staged and one unstaged.
        let output = "MM both_modified.rs\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 2, "MM should produce two entries");

        // First entry: staged half
        assert_eq!(files[0].path, "both_modified.rs");
        assert!(matches!(files[0].status, ChangedFileStatus::Modified));
        assert!(files[0].staged, "First MM entry should be staged");

        // Second entry: unstaged half
        assert_eq!(files[1].path, "both_modified.rs");
        assert!(matches!(files[1].status, ChangedFileStatus::Modified));
        assert!(!files[1].staged, "Second MM entry should be unstaged");
    }

    #[test]
    fn test_parse_git_status_am_dual_entry() {
        // AM = added in index, modified in worktree.
        // Emit TWO entries: staged Added, unstaged Modified.
        let output = "AM new_file.rs\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 2, "AM should produce two entries");

        // First entry: staged (Added)
        assert_eq!(files[0].path, "new_file.rs");
        assert!(matches!(files[0].status, ChangedFileStatus::Added));
        assert!(files[0].staged, "First AM entry should be staged");

        // Second entry: unstaged (Modified)
        assert_eq!(files[1].path, "new_file.rs");
        assert!(matches!(files[1].status, ChangedFileStatus::Modified));
        assert!(!files[1].staged, "Second AM entry should be unstaged");
    }

    #[test]
    fn test_parse_git_status_merge_conflict_modified() {
        let output = "UU conflicted.rs\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "conflicted.rs");
        assert!(matches!(files[0].status, ChangedFileStatus::Modified));
        assert!(!files[0].staged);
    }

    #[test]
    fn test_parse_git_status_merge_conflict_deleted() {
        for code in ["DD", "DU", "UD"] {
            let output = format!("{} deleted.rs\0", code);
            let files = parse_git_status(&output);

            assert_eq!(files.len(), 1, "{} should produce one entry", code);
            assert_eq!(files[0].path, "deleted.rs");
            assert!(matches!(files[0].status, ChangedFileStatus::Deleted));
            assert!(!files[0].staged);
        }
    }

    #[test]
    fn test_validate_file_path_rejects_empty() {
        let result = validate_file_path("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn test_validate_file_path_rejects_absolute() {
        let result = validate_file_path("/etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("repo-relative"));
    }

    #[test]
    fn test_validate_file_path_rejects_parent_traversal() {
        let result = validate_file_path("../../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("parent traversal"));
    }

    #[test]
    fn test_validate_file_path_allows_normal_path() {
        let result = validate_file_path("src/main.rs");
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_git_diff_single_hunk() {
        let diff = r#"@@ -1,3 +1,4 @@
 fn main() {
+    println!("Hello");
     println!("World");
 }
"#;
        let file_diff = parse_git_diff(diff, "src/main.rs");

        assert_eq!(file_diff.file_path, "src/main.rs");
        assert_eq!(file_diff.hunks.len(), 1);

        let hunk = &file_diff.hunks[0];
        assert_eq!(hunk.id, "hunk-1-1");
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.old_lines, 3);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.new_lines, 4);
        assert_eq!(hunk.lines.len(), 4);

        // Check line types
        assert!(matches!(hunk.lines[0].line_type, DiffLineType::Context));
        assert!(matches!(hunk.lines[1].line_type, DiffLineType::Added));
        assert!(matches!(hunk.lines[2].line_type, DiffLineType::Context));
        assert!(matches!(hunk.lines[3].line_type, DiffLineType::Context));

        // Check content
        assert_eq!(hunk.lines[0].content, "fn main() {");
        assert_eq!(hunk.lines[1].content, "    println!(\"Hello\");");
    }

    #[test]
    fn test_parse_git_diff_multiple_hunks() {
        let diff = r#"@@ -1,2 +1,3 @@
 line 1
+line 2
 line 3
@@ -10,1 +11,2 @@
 line 10
+line 11
"#;
        let file_diff = parse_git_diff(diff, "test.txt");

        assert_eq!(file_diff.hunks.len(), 2);

        let hunk1 = &file_diff.hunks[0];
        assert_eq!(hunk1.id, "hunk-1-1");
        assert_eq!(hunk1.old_start, 1);
        assert_eq!(hunk1.lines.len(), 3);

        let hunk2 = &file_diff.hunks[1];
        assert_eq!(hunk2.id, "hunk-10-11");
        assert_eq!(hunk2.old_start, 10);
        assert_eq!(hunk2.lines.len(), 2);
    }

    #[test]
    fn test_parse_git_diff_empty() {
        let diff = "";
        let file_diff = parse_git_diff(diff, "unchanged.txt");

        assert_eq!(file_diff.file_path, "unchanged.txt");
        assert_eq!(file_diff.hunks.len(), 0);
    }

    #[test]
    fn test_file_diff_serializes_absent_paths_as_null_keys() {
        let file_diff = FileDiff {
            file_path: "unchanged.txt".to_string(),
            old_path: None,
            new_path: None,
            hunks: Vec::new(),
        };

        let encoded = serde_json::to_value(file_diff).expect("serialize FileDiff");

        assert_eq!(encoded["oldPath"], serde_json::Value::Null);
        assert_eq!(encoded["newPath"], serde_json::Value::Null);
    }

    #[test]
    fn test_parse_git_diff_removal_only() {
        let diff = r#"@@ -1,3 +1,2 @@
 keep this
-remove this
 keep that
"#;
        let file_diff = parse_git_diff(diff, "test.txt");

        assert_eq!(file_diff.hunks.len(), 1);

        let hunk = &file_diff.hunks[0];
        assert_eq!(hunk.lines.len(), 3);
        assert!(matches!(hunk.lines[1].line_type, DiffLineType::Removed));
        assert_eq!(hunk.lines[1].content, "remove this");
    }

    #[test]
    fn test_parse_git_diff_rename_metadata() {
        let diff = r#"diff --git a/old_name.txt b/new_name.txt
similarity index 88%
rename from old_name.txt
rename to new_name.txt
@@ -1,2 +1,2 @@
 line 1
-old
+new
"#;
        let file_diff = parse_git_diff(diff, "new_name.txt");

        assert_eq!(file_diff.file_path, "new_name.txt");
        assert_eq!(file_diff.old_path, Some("old_name.txt".to_string()));
        assert_eq!(file_diff.new_path, Some("new_name.txt".to_string()));
        assert_eq!(file_diff.hunks.len(), 1);
        assert_eq!(file_diff.hunks[0].id, "hunk-1-1");
    }

    #[test]
    fn test_parse_git_diff_decodes_quoted_rename_metadata() {
        let diff = r#"diff --git "a/old\tname.txt" "b/new\nname.txt"
similarity index 88%
rename from "old\tname.txt"
rename to "new\nname.txt"
@@ -1,2 +1,2 @@
 line 1
-old
+new
"#;
        let file_diff = parse_git_diff(diff, "new\nname.txt");

        assert_eq!(file_diff.old_path, Some("old\tname.txt".to_string()));
        assert_eq!(file_diff.new_path, Some("new\nname.txt".to_string()));
    }

    #[test]
    fn test_decode_git_patch_path_handles_octal_utf8() {
        assert_eq!(decode_git_patch_path(r#""caf\303\251.txt""#), "café.txt");
    }

    #[test]
    fn test_decode_git_patch_path_preserves_unknown_escape_backslash() {
        assert_eq!(
            decode_git_patch_path(r#""dir\qfile.txt""#),
            r"dir\qfile.txt"
        );
    }

    #[test]
    fn test_decode_git_patch_path_preserves_octal_overflow_escape() {
        assert_eq!(
            decode_git_patch_path(r#""bad\400path.txt""#),
            r"bad\400path.txt"
        );
    }

    #[test]
    fn test_parse_git_diff_copy_metadata() {
        // Guards copy-from/copy-to path — structurally identical to rename but needs its own fixture.
        let diff = r#"diff --git a/template.txt b/copy.txt
similarity index 92%
copy from template.txt
copy to copy.txt
@@ -1,2 +1,2 @@
 base line
-original
+derived
"#;
        let file_diff = parse_git_diff(diff, "copy.txt");

        assert_eq!(file_diff.file_path, "copy.txt");
        assert_eq!(file_diff.old_path, Some("template.txt".to_string()));
        assert_eq!(file_diff.new_path, Some("copy.txt".to_string()));
        assert_eq!(file_diff.hunks.len(), 1);
        assert_eq!(file_diff.hunks[0].id, "hunk-1-1");
    }

    #[test]
    fn test_parse_hunk_range() {
        assert_eq!(parse_hunk_range("-102,7"), (102, 7));
        assert_eq!(parse_hunk_range("+102,6"), (102, 6));
        assert_eq!(parse_hunk_range("-1,1"), (1, 1));
        assert_eq!(parse_hunk_range("+1"), (1, 1));
    }

    // Integration tests for git_status command (Feature 4)

    #[tokio::test]
    async fn test_git_status_subdir_cwd_returns_repo_level_changes() {
        // Test that calling git_status from a subdirectory returns repo-level
        // changes (via rev-parse --show-toplevel resolution)
        use std::fs;
        use std::process::Command;

        let tmp = home_tempdir();
        let repo_path = tmp.path();

        // Initialize git repo
        Command::new("git")
            .args(["init"])
            .current_dir(repo_path)
            .output()
            .expect("git init failed");

        // Create a subdirectory
        let subdir = repo_path.join("src");
        fs::create_dir(&subdir).expect("failed to create subdir");

        // Create and stage a file at repo root
        let root_file = repo_path.join("root.txt");
        fs::write(&root_file, "root file").expect("failed to write root file");

        Command::new("git")
            .args(["add", "root.txt"])
            .current_dir(repo_path)
            .output()
            .expect("git add failed");

        // Call git_status from the subdirectory
        let subdir_str = subdir.to_string_lossy().to_string();
        let result = git_status(subdir_str).await;

        assert!(result.is_ok(), "git_status should succeed from subdir");
        let files = result.unwrap();

        // Should see root.txt even though we called from src/
        assert_eq!(files.len(), 1, "should return repo-level changes");
        assert_eq!(files[0].path, "root.txt");
        assert!(files[0].staged);
    }

    #[tokio::test]
    async fn test_git_status_non_repo_returns_empty() {
        // Test that calling git_status from a non-repo directory returns
        // empty vec (not an error)
        let tmp = home_tempdir();
        let non_repo = tmp.path().to_string_lossy().to_string();

        let result = git_status(non_repo).await;

        assert!(result.is_ok(), "non-repo should return Ok, not error");
        let files = result.unwrap();
        assert_eq!(files.len(), 0, "non-repo should return empty vec");
    }

    #[tokio::test]
    async fn test_git_status_mm_file_has_both_halves_with_numstat() {
        // Test that an MM file (modified in index and worktree) produces
        // two entries, and both have their respective numstat counts.
        use std::fs;
        use std::process::Command;

        let tmp = home_tempdir();
        let repo_path = tmp.path();

        // Initialize git repo and configure so commits work on CI runners
        Command::new("git")
            .args(["init"])
            .current_dir(repo_path)
            .output()
            .expect("git init failed");
        configure_test_git(repo_path);

        // Create and commit initial file
        let file = repo_path.join("test.txt");
        fs::write(&file, "line 1\nline 2\n").expect("failed to write file");

        Command::new("git")
            .args(["add", "test.txt"])
            .current_dir(repo_path)
            .output()
            .expect("git add failed");

        let commit_out = Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(repo_path)
            .output()
            .expect("git commit failed");
        assert!(
            commit_out.status.success(),
            "git commit must succeed: {}",
            String::from_utf8_lossy(&commit_out.stderr)
        );

        // Modify and stage (adds line 3)
        fs::write(&file, "line 1\nline 2\nline 3\n").expect("failed to write");

        Command::new("git")
            .args(["add", "test.txt"])
            .current_dir(repo_path)
            .output()
            .expect("git add failed");

        // Modify again unstaged (adds line 4)
        fs::write(&file, "line 1\nline 2\nline 3\nline 4\n").expect("failed to write");

        // Now we have MM: staged +1 line, unstaged +1 line
        let repo_str = repo_path.to_string_lossy().to_string();
        let result = git_status(repo_str).await;

        assert!(result.is_ok(), "git_status should succeed");
        let files = result.unwrap();

        assert_eq!(files.len(), 2, "MM should produce two entries");

        // Find staged and unstaged entries
        let staged = files
            .iter()
            .find(|f| f.staged)
            .expect("should have staged entry");
        let unstaged = files
            .iter()
            .find(|f| !f.staged)
            .expect("should have unstaged entry");

        assert_eq!(staged.path, "test.txt");
        assert_eq!(unstaged.path, "test.txt");

        // Both should have numstat data
        assert!(
            staged.insertions.is_some(),
            "staged entry should have insertions count"
        );
        assert!(
            staged.deletions.is_some(),
            "staged entry should have deletions count"
        );
        assert!(
            unstaged.insertions.is_some(),
            "unstaged entry should have insertions count"
        );
        assert!(
            unstaged.deletions.is_some(),
            "unstaged entry should have deletions count"
        );

        // Staged should show +1/-0 (added line 3)
        assert_eq!(staged.insertions, Some(1));
        assert_eq!(staged.deletions, Some(0));

        // Unstaged should show +1/-0 (added line 4)
        assert_eq!(unstaged.insertions, Some(1));
        assert_eq!(unstaged.deletions, Some(0));
    }

    // Integration test for get_git_diff command (Feature 5)

    #[tokio::test]
    async fn test_get_git_diff_subdir_cwd_returns_populated_hunks() {
        // Test that calling get_git_diff from a subdirectory works correctly
        // (via rev-parse --show-toplevel resolution)
        use std::fs;
        use std::process::Command;

        let tmp = home_tempdir();
        let repo_path = tmp.path();

        // Initialize git repo
        Command::new("git")
            .args(["init"])
            .current_dir(repo_path)
            .output()
            .expect("git init failed");

        // Create subdirectory
        configure_test_git(repo_path);

        let subdir = repo_path.join("sub");
        fs::create_dir(&subdir).expect("failed to create subdir");

        // Create and commit file in subdirectory
        let file_path = subdir.join("foo.ts");
        fs::write(&file_path, "line 1\nline 2\n").expect("failed to write file");

        Command::new("git")
            .args(["add", "sub/foo.ts"])
            .current_dir(repo_path)
            .output()
            .expect("git add failed");

        let commit_out = Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(repo_path)
            .output()
            .expect("git commit failed");
        assert!(
            commit_out.status.success(),
            "git commit must succeed: {}",
            String::from_utf8_lossy(&commit_out.stderr)
        );

        // Modify the file
        fs::write(&file_path, "line 1\nline 2\nline 3\n").expect("failed to write");

        // Call get_git_diff from the subdirectory with file path "sub/foo.ts"
        let subdir_str = subdir.to_string_lossy().to_string();
        let result = get_git_diff(subdir_str, "sub/foo.ts".to_string(), false, None).await;

        assert!(result.is_ok(), "get_git_diff should succeed from subdir");
        let response = result.unwrap();
        let diff = &response.file_diff;

        assert_eq!(diff.file_path, "sub/foo.ts");
        assert!(!diff.hunks.is_empty(), "should have populated hunks");

        // Verify the diff shows the added line
        let hunk = &diff.hunks[0];
        let added_lines: Vec<_> = hunk
            .lines
            .iter()
            .filter(|l| matches!(l.line_type, DiffLineType::Added))
            .collect();

        assert_eq!(added_lines.len(), 1, "should have one added line");
        assert_eq!(added_lines[0].content, "line 3");
    }

    #[tokio::test]
    async fn test_get_git_diff_non_repo_returns_empty_hunks() {
        // Test that calling get_git_diff from a non-repo directory returns
        // FileDiff with empty hunks (not an error)
        let tmp = home_tempdir();
        let non_repo = tmp.path().to_string_lossy().to_string();

        let result = get_git_diff(non_repo, "foo.txt".to_string(), false, None).await;

        assert!(result.is_ok(), "non-repo should return Ok, not error");
        let response = result.unwrap();
        let diff = &response.file_diff;
        assert_eq!(diff.file_path, "foo.txt");
        assert_eq!(diff.hunks.len(), 0, "non-repo should return empty hunks");
    }

    #[tokio::test]
    async fn test_git_branch_returns_default_branch_for_unborn_repo() {
        use std::process::Command;

        let tmp = home_tempdir();
        let repo_path = tmp.path();
        let init_out = Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(repo_path)
            .output()
            .expect("git init failed");
        assert!(
            init_out.status.success(),
            "git init must succeed: {}",
            String::from_utf8_lossy(&init_out.stderr)
        );

        let path = repo_path.to_string_lossy().to_string();
        let branch = git_branch(path).await.expect("git_branch");

        assert_eq!(branch, "main");
    }

    #[tokio::test]
    async fn test_git_branch_detached_head_returns_short_sha() {
        use std::process::Command;

        let tmp = home_tempdir();
        let repo_path = tmp.path();
        let init_out = Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(repo_path)
            .output()
            .expect("git init failed");
        assert!(
            init_out.status.success(),
            "git init must succeed: {}",
            String::from_utf8_lossy(&init_out.stderr)
        );

        configure_test_git(repo_path);

        std::fs::write(repo_path.join("seed"), "seed").expect("failed to write seed");
        let add_out = Command::new("git")
            .args(["add", "."])
            .current_dir(repo_path)
            .output()
            .expect("git add failed");
        assert!(
            add_out.status.success(),
            "git add must succeed: {}",
            String::from_utf8_lossy(&add_out.stderr)
        );

        let commit_out = Command::new("git")
            .args(["commit", "-m", "seed"])
            .current_dir(repo_path)
            .output()
            .expect("git commit failed");
        assert!(
            commit_out.status.success(),
            "git commit must succeed: {}",
            String::from_utf8_lossy(&commit_out.stderr)
        );

        let rev_out = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(repo_path)
            .output()
            .expect("git rev-parse failed");
        assert!(
            rev_out.status.success(),
            "git rev-parse must succeed: {}",
            String::from_utf8_lossy(&rev_out.stderr)
        );
        let full_sha = String::from_utf8(rev_out.stdout)
            .expect("sha should be utf8")
            .trim()
            .to_string();

        let switch_out = Command::new("git")
            .args(["switch", "--detach", &full_sha])
            .current_dir(repo_path)
            .output()
            .expect("git switch failed");
        assert!(
            switch_out.status.success(),
            "git switch must succeed: {}",
            String::from_utf8_lossy(&switch_out.stderr)
        );

        let path = repo_path.to_string_lossy().to_string();
        let branch = git_branch(path).await.expect("git_branch");

        assert_eq!(
            branch.len(),
            7,
            "short SHA should be exactly 7 chars: {branch:?}"
        );
        assert!(
            full_sha.starts_with(&branch),
            "short SHA must be a prefix of the full SHA: short={branch} full={full_sha}"
        );
    }

    #[tokio::test]
    async fn test_git_branch_returns_error_for_non_repo_cwd() {
        let tmp = home_tempdir();
        let path = tmp.path().to_string_lossy().to_string();

        let result = git_branch(path).await;

        assert!(result.is_err(), "expected error, got {:?}", result);
    }

    #[tokio::test]
    async fn test_git_branch_returns_error_for_non_detached_git_failure() {
        use std::fs;
        use std::process::Command;

        let tmp = home_tempdir();
        let repo_path = tmp.path();
        let init_out = Command::new("git")
            .args(["init", "--initial-branch=main"])
            .current_dir(repo_path)
            .output()
            .expect("git init failed");
        assert!(
            init_out.status.success(),
            "git init must succeed: {}",
            String::from_utf8_lossy(&init_out.stderr)
        );

        fs::write(repo_path.join(".git").join("config"), "[core\n")
            .expect("failed to corrupt git config");

        let path = repo_path.to_string_lossy().to_string();
        let result = git_branch(path).await;

        assert!(result.is_err(), "expected error, got {:?}", result);
    }

    #[tokio::test]
    async fn test_git_branch_rejects_out_of_scope_cwd() {
        let result = git_branch("/etc".to_string()).await;

        assert!(result.is_err(), "expected error, got {:?}", result);
    }

    #[tokio::test]
    async fn test_git_worktree_name_returns_none_for_main_checkout() {
        let (_tmp, main, _worktrees) = create_main_repo_with_worktrees(&[]);
        let result = git_worktree_name(main.to_string_lossy().to_string()).await;

        assert!(
            matches!(result, Ok(None)),
            "expected Ok(None), got {:?}",
            result
        );
    }

    #[tokio::test]
    async fn test_git_worktree_name_returns_basename_for_linked_worktree() {
        let (_tmp, _main, worktrees) = create_main_repo_with_worktrees(&["feat"]);
        let worktree_path = &worktrees[0];
        let expected = worktree_path
            .file_name()
            .and_then(|s| s.to_str())
            .map(str::to_string)
            .expect("worktree path basename");

        let result = git_worktree_name(worktree_path.to_string_lossy().to_string()).await;

        assert_eq!(result, Ok(Some(expected)));
    }

    #[tokio::test]
    async fn test_git_worktree_name_handles_bare_repo_worktree() {
        // Regression: when the gitdir root is `project.git` (bare repo or
        // `--separate-git-dir` clone) instead of `.git`, the grandparent
        // check must still accept the gitdir as a linked-worktree root.
        // Without this, the chip never appears for users who back their
        // worktrees with a bare repo (common on Gitea/Forgejo mirrors and
        // multi-worktree dev setups).
        let tmp = home_tempdir();
        let bare = tmp.path().join("project.git");
        std::process::Command::new("git")
            .args(["init", "--bare", "--initial-branch=main"])
            .arg(&bare)
            .output()
            .expect("git init --bare failed");

        // Bare repo needs at least one commit before `git worktree add` can
        // create a linked worktree. Use a transient working tree to seed.
        let seed = tmp.path().join("seed");
        std::process::Command::new("git")
            .args(["clone"])
            .arg(&bare)
            .arg(&seed)
            .output()
            .expect("git clone failed");
        configure_test_git(&seed);
        std::fs::write(seed.join("seed.txt"), "seed").expect("write seed");
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&seed)
            .output()
            .expect("git add failed");
        std::process::Command::new("git")
            .args(["commit", "-m", "seed"])
            .current_dir(&seed)
            .output()
            .expect("git commit failed");
        std::process::Command::new("git")
            .args(["push", "origin", "main"])
            .current_dir(&seed)
            .output()
            .expect("git push failed");

        // Add a linked worktree of the bare repo. The gitdir for the new
        // worktree resolves to `<tmp>/project.git/worktrees/wt-bare`.
        let worktree = tmp.path().join("wt-bare");
        std::process::Command::new("git")
            .args(["worktree", "add", "-b", "feat"])
            .arg(&worktree)
            .arg("main")
            .current_dir(&bare)
            .output()
            .expect("git worktree add failed");

        let result = git_worktree_name(worktree.to_string_lossy().to_string()).await;
        assert_eq!(result, Ok(Some("wt-bare".to_string())));
    }

    #[tokio::test]
    async fn test_git_worktree_name_handles_bare_repo_without_dot_git_suffix() {
        // Regression for cycle-2 Codex P2: `git init --bare /srv/repo`
        // creates a bare gitdir root without the `.git` suffix. The
        // grandparent name is just `repo`, which fails both the
        // `name == ".git"` and `name.ends_with(".git")` checks. The
        // HEAD-file fallback rescues this case.
        let tmp = home_tempdir();
        let bare = tmp.path().join("repo-no-suffix");
        std::process::Command::new("git")
            .args(["init", "--bare", "--initial-branch=main"])
            .arg(&bare)
            .output()
            .expect("git init --bare failed");

        // Seed via clone-and-push (bare repos need at least one commit
        // before `git worktree add` can create a linked worktree).
        let seed = tmp.path().join("seed-no-suffix");
        std::process::Command::new("git")
            .args(["clone"])
            .arg(&bare)
            .arg(&seed)
            .output()
            .expect("git clone failed");
        configure_test_git(&seed);
        std::fs::write(seed.join("seed.txt"), "seed").expect("write seed");
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&seed)
            .output()
            .expect("git add failed");
        std::process::Command::new("git")
            .args(["commit", "-m", "seed"])
            .current_dir(&seed)
            .output()
            .expect("git commit failed");
        std::process::Command::new("git")
            .args(["push", "origin", "main"])
            .current_dir(&seed)
            .output()
            .expect("git push failed");

        let worktree = tmp.path().join("wt-no-suffix");
        std::process::Command::new("git")
            .args(["worktree", "add", "-b", "feat"])
            .arg(&worktree)
            .arg("main")
            .current_dir(&bare)
            .output()
            .expect("git worktree add failed");

        let result = git_worktree_name(worktree.to_string_lossy().to_string()).await;
        assert_eq!(result, Ok(Some("wt-no-suffix".to_string())));
    }

    #[tokio::test]
    async fn test_git_worktree_name_returns_error_for_non_repo() {
        let tmp = home_tempdir();
        let result = git_worktree_name(tmp.path().to_string_lossy().to_string()).await;

        assert!(result.is_err(), "expected error, got {:?}", result);
    }

    #[tokio::test]
    async fn test_git_worktree_name_rejects_out_of_scope_cwd() {
        let result = git_worktree_name("/etc".to_string()).await;

        assert!(result.is_err(), "expected error, got {:?}", result);
    }

    #[tokio::test]
    async fn test_git_status_untracked_file_has_line_count_numstat() {
        // An untracked file should carry `insertions == <line count>` and
        // `deletions == 0` so the sidebar `+N / -0` badge renders. Verifies
        // the second-pass `git diff --no-index --numstat` synthesizer.
        use std::fs;
        use std::process::Command;

        let tmp = home_tempdir();
        let repo_path = tmp.path();

        Command::new("git")
            .args(["init"])
            .current_dir(repo_path)
            .output()
            .expect("git init failed");

        // Create an untracked 4-line file.
        let untracked = repo_path.join("fresh.txt");
        fs::write(&untracked, "one\ntwo\nthree\nfour\n").expect("write failed");

        let repo_str = repo_path.to_string_lossy().to_string();
        let result = git_status(repo_str).await;

        assert!(result.is_ok(), "git_status should succeed");
        let files = result.unwrap();
        let untracked_entry = files
            .iter()
            .find(|f| f.path == "fresh.txt")
            .expect("untracked file should appear in status");

        assert!(matches!(
            untracked_entry.status,
            ChangedFileStatus::Untracked
        ));
        assert_eq!(
            untracked_entry.insertions,
            Some(4),
            "insertions should equal the file's line count"
        );
        assert_eq!(
            untracked_entry.deletions,
            Some(0),
            "deletions should be 0 for an untracked file (nothing to remove)"
        );
    }

    #[tokio::test]
    async fn test_git_status_untracked_directory_expands_to_individual_files() {
        // Regression test: the diff sidebar is file-oriented, so `git_status`
        // must enumerate untracked files inside directories instead of
        // returning a single `?? dir/` placeholder row.
        use std::fs;
        use std::process::Command;

        let tmp = home_tempdir();
        let repo_path = tmp.path();

        Command::new("git")
            .args(["init"])
            .current_dir(repo_path)
            .output()
            .expect("git init failed");

        let session_dir = repo_path.join(".vimeflow").join("sessions").join("abc");
        fs::create_dir_all(&session_dir).expect("mkdir failed");
        fs::write(session_dir.join("bashrc"), "export PS1='$ '\n").expect("write failed");
        fs::write(session_dir.join("init.sh"), "#!/usr/bin/env bash\n").expect("write failed");

        let repo_str = repo_path.to_string_lossy().to_string();
        let result = git_status(repo_str).await;

        assert!(result.is_ok(), "git_status should succeed");
        let files = result.unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();

        assert!(
            paths.contains(&".vimeflow/sessions/abc/bashrc"),
            "untracked file inside directory should be listed individually"
        );
        assert!(
            paths.contains(&".vimeflow/sessions/abc/init.sh"),
            "second untracked file inside directory should be listed individually"
        );
        assert!(
            !paths.contains(&".vimeflow/"),
            "collapsed untracked directory placeholder should not appear"
        );
    }

    #[tokio::test]
    async fn test_get_git_diff_untracked_file_returns_all_added() {
        // An untracked file (never staged, never committed) produces zero
        // output from plain `git diff -- <file>`. The fallback via
        // `git diff --no-index /dev/null <file>` should synthesize a diff
        // where every line of the file content appears as a DiffLineType::Added.
        use std::fs;
        use std::process::Command;

        let tmp = home_tempdir();
        let repo_path = tmp.path();

        Command::new("git")
            .args(["init"])
            .current_dir(repo_path)
            .output()
            .expect("git init failed");

        // Create an untracked file — do NOT `git add` it.
        let untracked = repo_path.join("untracked.txt");
        fs::write(&untracked, "alpha\nbeta\ngamma\n").expect("failed to write");

        let repo_str = repo_path.to_string_lossy().to_string();
        let result = get_git_diff(repo_str, "untracked.txt".to_string(), false, Some(true)).await;

        assert!(
            result.is_ok(),
            "get_git_diff on untracked file should succeed (fallback to --no-index)"
        );
        let response = result.unwrap();
        let diff = &response.file_diff;
        assert_eq!(diff.file_path, "untracked.txt");
        assert_eq!(
            diff.hunks.len(),
            1,
            "untracked file should produce one hunk (whole-file)"
        );

        let hunk = &diff.hunks[0];
        assert_eq!(hunk.lines.len(), 3, "three lines of content");
        for line in &hunk.lines {
            assert!(
                matches!(line.line_type, DiffLineType::Added),
                "every line of an untracked file should be Added"
            );
        }
        assert_eq!(hunk.lines[0].content, "alpha");
        assert_eq!(hunk.lines[1].content, "beta");
        assert_eq!(hunk.lines[2].content, "gamma");

        // Untracked files have no base content; new_text is the working-tree file.
        assert_eq!(response.old_text, "", "untracked => old_text is empty");
        assert_eq!(
            response.new_text, "alpha\nbeta\ngamma\n",
            "untracked => new_text is the working-tree contents"
        );
        assert!(
            !response.raw_diff.is_empty(),
            "raw_diff should hold the synthesized --no-index diff"
        );
    }

    // Unit tests for validate_hunk_patch (pure logic, no git subprocess needed).

    #[test]
    fn test_validate_hunk_patch_rejects_absolute_path() {
        let cwd = std::path::Path::new("/home/user/repo");
        let result = validate_hunk_patch(cwd, "/etc/passwd", None);
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(
            msg.contains("repo-relative") || msg.contains("absolute"),
            "unexpected error message: {msg}"
        );
    }

    #[test]
    fn test_validate_hunk_patch_rejects_parent_traversal() {
        let cwd = std::path::Path::new("/home/user/repo");
        let result = validate_hunk_patch(cwd, "../../etc/passwd", None);
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(
            msg.contains("traversal") || msg.contains("parent") || msg.contains("denied"),
            "unexpected error message: {msg}"
        );
    }

    #[test]
    fn test_validate_hunk_patch_accepts_valid_path_no_patch() {
        let cwd = std::path::Path::new("/home/user/repo");
        let result = validate_hunk_patch(cwd, "src/main.rs", None);
        assert!(
            result.is_ok(),
            "valid repo-relative path should be accepted"
        );
    }

    #[test]
    fn test_validate_hunk_patch_rejects_multi_file_patch() {
        let cwd = std::path::Path::new("/home/user/repo");
        let patch = "\
diff --git a/src/a.rs b/src/a.rs
--- a/src/a.rs
+++ b/src/a.rs
@@ -1 +1 @@
-old
+new
diff --git a/src/b.rs b/src/b.rs
--- a/src/b.rs
+++ b/src/b.rs
@@ -1 +1 @@
-old
+new
";
        let result = validate_hunk_patch(cwd, "src/a.rs", Some(patch));
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("multi-file"),
            "should report multi-file error"
        );
    }

    #[test]
    fn test_validate_hunk_patch_rejects_mismatched_path() {
        let cwd = std::path::Path::new("/home/user/repo");
        let patch = "\
diff --git a/src/other.rs b/src/other.rs
--- a/src/other.rs
+++ b/src/other.rs
@@ -1 +1 @@
-old
+new
";
        let result = validate_hunk_patch(cwd, "src/main.rs", Some(patch));
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(
            msg.contains("different file") || msg.contains("header paths"),
            "unexpected error message: {msg}"
        );
    }

    #[test]
    fn test_validate_hunk_patch_accepts_matching_single_file_patch() {
        let cwd = std::path::Path::new("/home/user/repo");
        let patch = "\
diff --git a/src/main.rs b/src/main.rs
--- a/src/main.rs
+++ b/src/main.rs
@@ -1 +1 @@
-old
+new
";
        let result = validate_hunk_patch(cwd, "src/main.rs", Some(patch));
        assert!(
            result.is_ok(),
            "matching single-file patch should be accepted"
        );
    }

    #[test]
    fn test_validate_hunk_patch_accepts_new_file_patch() {
        // A real new-file patch: `--- /dev/null` + `+++ b/src/new.rs`.
        // The diff --git OLD is the same as the path and NEW matches path too.
        let cwd = std::path::Path::new("/home/user/repo");
        let patch = "\
diff --git a/src/new.rs b/src/new.rs
new file mode 100644
--- /dev/null
+++ b/src/new.rs
@@ -0,0 +1 @@
+hello
";
        let result = validate_hunk_patch(cwd, "src/new.rs", Some(patch));
        assert!(
            result.is_ok(),
            "new-file patch (--- /dev/null / +++ b/path) should be accepted: {:?}",
            result
        );
    }

    #[test]
    fn test_validate_hunk_patch_rejects_inconsistent_header_paths() {
        // Smuggled patch: the `diff --git` declaration says src/main.rs → src/main.rs
        // but the body headers say `--- a/evil.rs` / `+++ b/src/main.rs`.
        // The body `--- a/evil.rs` is inconsistent with the `diff --git` OLD path
        // `src/main.rs`, so this must be rejected even though `src/main.rs` appears
        // in the set of header paths.
        let cwd = std::path::Path::new("/home/user/repo");
        let patch = "\
diff --git a/src/main.rs b/src/main.rs
--- a/evil.rs
+++ b/src/main.rs
@@ -1 +1 @@
-old
+new
";
        let result = validate_hunk_patch(cwd, "src/main.rs", Some(patch));
        assert!(
            result.is_err(),
            "patch with inconsistent --- header must be rejected"
        );
        let msg = result.unwrap_err();
        assert!(
            msg.contains("inconsistency") || msg.contains("does not match"),
            "unexpected error message: {msg}"
        );
    }
}
