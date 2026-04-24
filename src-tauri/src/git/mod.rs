pub mod watcher;

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use crate::filesystem::scope::{
    ensure_within_home, expand_home, home_canonical, reject_parent_refs,
};

/// Timeout for git subprocess calls. Prevents indefinite blocking on
/// hung NFS mounts, slow hooks, or unresponsive credential helpers.
const GIT_TIMEOUT: Duration = Duration::from_secs(30);

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
                    // SAFETY: child_id is a valid PID from a process we
                    // just spawned. SIGKILL is the only reliable way to
                    // terminate a hung git process (SIGTERM may be ignored
                    // by a blocking syscall on NFS).
                    libc::kill(child_id as i32, libc::SIGKILL);
                }
            }

            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/PID", &child_id.to_string()])
                    .status();
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

        // Skip binary files (marked as "-\t-\t...")
        if insertions_str == "-" || deletions_str == "-" {
            i += 1;
            continue;
        }

        let insertions = insertions_str.parse::<u32>().unwrap_or(0);
        let deletions = deletions_str.parse::<u32>().unwrap_or(0);

        // Check if this is a rename (third field is empty)
        let path_field = String::from_utf8_lossy(parts[2]);

        if path_field.is_empty() {
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
#[serde(rename_all = "lowercase")]
pub enum DiffLineType {
    Added,
    Removed,
    Context,
}

/// A single line within a diff hunk
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub line_type: DiffLineType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_line_number: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_line_number: Option<u32>,
}

/// A single hunk within a file diff
#[derive(Debug, Clone, Serialize)]
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
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub file_path: String,
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
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
                // Renames and copies are index operations
                files.push(ChangedFile {
                    path,
                    status: ChangedFileStatus::Renamed,
                    staged: true,
                    insertions: None,
                    deletions: None,
                });
            }
            "UU" | "AA" | "DD" | "AU" | "UA" | "DU" | "UD" => {
                // Merge conflict codes — show as unstaged modified
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

    for line in output.lines() {
        if line.starts_with("@@") {
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
                id: format!("hunk-{}", hunks.len()),
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
        old_path: None,
        new_path: None,
        hunks,
    }
}

/// Parse hunk range like "-102,7" or "+102,6" into (start, lines)
fn parse_hunk_range(range: &str) -> (u32, u32) {
    let range = range.trim_start_matches(&['-', '+'][..]);
    let parts: Vec<&str> = range.split(',').collect();

    let start = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let lines = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);

    (start, lines)
}

/// Tauri command: Get all files with git changes
#[tauri::command]
pub async fn git_status(cwd: String) -> Result<Vec<ChangedFile>, String> {
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

    // Run git status and numstat commands from toplevel
    let mut status_cmd = Command::new("git");
    status_cmd
        .arg("-C")
        .arg(&canonical_toplevel)
        .arg("status")
        .arg("--porcelain=v1")
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
            format!("git diff --cached failed with exit code {}", cached_diff_output.status)
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
    // Parallelized via `tokio::task::JoinSet` — a repo with many untracked
    // files (freshly scaffolded, post-`git stash pop`, etc.) would
    // serialize as ~5-15 ms per subprocess, producing seconds of latency
    // on every watcher-triggered refresh. JoinSet runs them concurrently
    // with no explicit cap; Tokio's blocking pool and the OS's fork/spawn
    // throughput naturally gate the concurrency.
    let untracked_indices: Vec<(usize, String)> = files
        .iter()
        .enumerate()
        .filter(|(_, f)| matches!(f.status, ChangedFileStatus::Untracked))
        .map(|(i, f)| (i, f.path.clone()))
        .collect();

    if !untracked_indices.is_empty() {
        let mut set = tokio::task::JoinSet::new();
        for (idx, path) in untracked_indices {
            let toplevel = canonical_toplevel.clone();
            set.spawn(async move {
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
    let file_abs = toplevel.join(file);

    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(toplevel)
        .arg("diff")
        .arg("--no-index")
        .arg("--no-color")
        .arg("--")
        .arg(NULL_DEVICE)
        .arg(&file_abs)
        .env("GIT_TERMINAL_PROMPT", "0");

    let output = run_git_with_timeout(cmd).await?;

    let exit_code = output.status.code().unwrap_or(-1);
    if exit_code != 0 && exit_code != 1 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!("git diff --no-index failed with exit code {}", output.status)
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
async fn get_untracked_numstat(
    toplevel: &Path,
    file: &str,
) -> Result<Option<(u32, u32)>, String> {
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
    let first_record: &[u8] = output
        .stdout
        .split(|&b| b == b'\0')
        .next()
        .unwrap_or(&[]);
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

/// Tauri command: Get diff for a specific file
#[tauri::command]
pub async fn get_git_diff(cwd: String, file: String, staged: bool) -> Result<FileDiff, String> {
    let safe_cwd = validate_cwd(&cwd)?;
    validate_file_path(&file)?;

    // Resolve repo toplevel — if not in a repo, return empty hunks
    let mut toplevel_cmd = Command::new("git");
    toplevel_cmd
        .arg("-C")
        .arg(&safe_cwd)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .env("GIT_TERMINAL_PROMPT", "0");

    let toplevel_output = run_git_with_timeout(toplevel_cmd).await?;

    if !toplevel_output.status.success() {
        // Not a git repo — return empty FileDiff
        return Ok(FileDiff {
            file_path: file.clone(),
            old_path: None,
            new_path: None,
            hunks: vec![],
        });
    }

    let toplevel_str = String::from_utf8_lossy(&toplevel_output.stdout);
    let toplevel_path = toplevel_str.trim();

    // Canonicalize and validate toplevel is under $HOME
    let canonical_toplevel = validate_cwd(toplevel_path)?;

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

    cmd.arg("--").arg(&file);

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
    if parsed.hunks.is_empty()
        && !staged
        && is_file_untracked(&canonical_toplevel, &file).await?
    {
        let untracked_stdout = get_untracked_diff(&canonical_toplevel, &file).await?;
        return Ok(parse_git_diff(&untracked_stdout, &file));
    }

    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a tempdir inside `$HOME` so `validate_cwd`'s
    /// `ensure_within_home` check passes. The default `tempfile::tempdir()`
    /// lives in `/tmp` which is outside `$HOME` on every supported platform,
    /// and the validation in production code would reject the path before
    /// any git subprocess runs. Tests that exercise the `git_status` /
    /// `get_git_diff` commands must use this helper instead.
    fn home_tempdir() -> tempfile::TempDir {
        let home = dirs::home_dir().expect("no home directory");
        tempfile::Builder::new()
            .prefix("vimeflow-git-test-")
            .tempdir_in(&home)
            .expect("failed to create temp dir under $HOME")
    }

    /// Configure `user.email` and `user.name` on a fresh git repo so
    /// `git commit` doesn't fail on CI runners without a global git
    /// config. Call this after `git init`, before any `git commit`.
    fn configure_test_git(repo_path: &std::path::Path) {
        use std::process::Command;
        for (key, val) in &[
            ("user.email", "test@example.com"),
            ("user.name", "Test User"),
        ] {
            Command::new("git")
                .args(["config", key, val])
                .current_dir(repo_path)
                .output()
                .expect("git config failed");
        }
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
        assert_eq!(hunk1.old_start, 1);
        assert_eq!(hunk1.lines.len(), 3);

        let hunk2 = &file_diff.hunks[1];
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
        fs::write(&file, "line 1\nline 2\nline 3\nline 4\n")
            .expect("failed to write");

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
        let result = get_git_diff(subdir_str, "sub/foo.ts".to_string(), false).await;

        assert!(result.is_ok(), "get_git_diff should succeed from subdir");
        let diff = result.unwrap();

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

        let result = get_git_diff(non_repo, "foo.txt".to_string(), false).await;

        assert!(result.is_ok(), "non-repo should return Ok, not error");
        let diff = result.unwrap();
        assert_eq!(diff.file_path, "foo.txt");
        assert_eq!(diff.hunks.len(), 0, "non-repo should return empty hunks");
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
        let result = get_git_diff(repo_str, "untracked.txt".to_string(), false).await;

        assert!(
            result.is_ok(),
            "get_git_diff on untracked file should succeed (fallback to --no-index)"
        );
        let diff = result.unwrap();
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
    }
}
