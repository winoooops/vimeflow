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
fn validate_cwd(cwd: &str) -> Result<std::path::PathBuf, String> {
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
            // Non-rename: path is in the third field
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
        return Err(if stderr.trim().is_empty() {
            format!("git status failed with exit code {}", output.status)
        } else {
            format!("git status failed: {}", stderr.trim())
        });
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
        return Err(if stderr.trim().is_empty() {
            format!("git diff failed with exit code {}", output.status)
        } else {
            format!("git diff failed: {}", stderr.trim())
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_git_diff(&stdout, &file))
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
