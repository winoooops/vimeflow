use serde::Serialize;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use crate::filesystem::scope::{ensure_within_home, expand_home, home_canonical, reject_parent_refs};

/// Timeout for git subprocess calls. Prevents indefinite blocking on
/// hung NFS mounts, slow hooks, or unresponsive credential helpers.
const GIT_TIMEOUT: Duration = Duration::from_secs(30);

/// Run a git command with a timeout. Returns the output or an error
/// if the command fails or exceeds the timeout.
async fn run_git_with_timeout(mut cmd: Command) -> Result<std::process::Output, String> {
    let result = tokio::time::timeout(GIT_TIMEOUT, tokio::task::spawn_blocking(move || {
        cmd.output()
    }))
    .await;

    match result {
        Ok(Ok(Ok(output))) => Ok(output),
        Ok(Ok(Err(e))) => Err(format!("Failed to run git: {}", e)),
        Ok(Err(e)) => Err(format!("git task failed: {}", e)),
        Err(_) => Err(format!(
            "git command timed out after {}s",
            GIT_TIMEOUT.as_secs()
        )),
    }
}

/// Validate that `cwd` resolves to a path inside the user's home directory.
fn validate_cwd(cwd: &str) -> Result<std::path::PathBuf, String> {
    let expanded = expand_home(cwd);
    reject_parent_refs(&expanded)?;
    let home = home_canonical()?;
    let canonical = std::fs::canonicalize(&expanded)
        .map_err(|e| format!("invalid cwd '{}': {}", cwd, e))?;
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
        let (status, staged) = match xy {
            "??" => (ChangedFileStatus::Untracked, false),
            "M " => (ChangedFileStatus::Modified, true),
            " M" => (ChangedFileStatus::Modified, false),
            // MM = modified in both index and worktree. A single boolean
            // can't represent both states — see the dual-flag spec at
            // docs/superpowers/specs/2026-04-11-mm-staged-unstaged-design.md
            // For v1, default to unstaged (shows working-tree changes the
            // user hasn't reviewed yet; staged changes were already reviewed
            // when the user staged them).
            "MM" => (ChangedFileStatus::Modified, false),
            "A " => (ChangedFileStatus::Added, true),
            " A" => (ChangedFileStatus::Added, false),
            "AM" => (ChangedFileStatus::Added, true),
            "D " => (ChangedFileStatus::Deleted, true),
            " D" => (ChangedFileStatus::Deleted, false),
            s if s.starts_with('R') => (ChangedFileStatus::Renamed, true), // renames are index ops
            s if s.starts_with('C') => (ChangedFileStatus::Renamed, true), // copies are index ops (no separate variant)
            // Merge conflict codes — no dedicated variant yet, show as
            // unstaged modified so the file at least appears in the list.
            "UU" | "AA" | "DD" | "AU" | "UA" | "DU" | "UD" => {
                (ChangedFileStatus::Modified, false)
            }
            _ => {
                // Default to modified unstaged for truly unknown codes
                (ChangedFileStatus::Modified, false)
            }
        };

        // For renames/copies, consume the next NUL-separated token as old path
        let old_path = if is_rename_or_copy {
            i += 1;
            entries.get(i).map(|s| s.to_string())
        } else {
            None
        };

        let _ = old_path; // old_path not surfaced in ChangedFile yet — tracked in FileDiff

        files.push(ChangedFile {
            path,
            status,
            staged,
        });

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

    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&safe_cwd)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("-z")
        .env("GIT_TERMINAL_PROMPT", "0");

    let output = run_git_with_timeout(cmd).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_git_status(&stdout))
}

/// Tauri command: Get diff for a specific file
#[tauri::command]
pub async fn get_git_diff(cwd: String, file: String, staged: bool) -> Result<FileDiff, String> {
    let safe_cwd = validate_cwd(&cwd)?;
    validate_file_path(&file)?;

    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&safe_cwd)
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
        return Err(format!("git diff failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_git_diff(&stdout, &file))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_parse_git_status_mm_defaults_to_unstaged() {
        // MM = modified in both index and worktree. v1 defaults to
        // unstaged so the working-tree diff is shown. See the dual-flag
        // spec for the v2 model that surfaces both states.
        let output = "MM both_modified.rs\0";
        let files = parse_git_status(output);

        assert_eq!(files.len(), 1);
        assert!(matches!(files[0].status, ChangedFileStatus::Modified));
        assert!(!files[0].staged, "MM should default to unstaged in v1");
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
}
