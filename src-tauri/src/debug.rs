//! Shared debug-only file logging utilities.

#[cfg(debug_assertions)]
use std::fs::{self, OpenOptions};
#[cfg(debug_assertions)]
use std::io::{self, Write};
#[cfg(debug_assertions)]
use std::path::{Path, PathBuf};
#[cfg(debug_assertions)]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(debug_assertions)]
const DEBUG_LOG_NAME: &str = "vimeflow-debug.log";
#[cfg(debug_assertions)]
const MAX_DEBUG_LOG_BYTES: u64 = 1024 * 1024;

/// Debug-only file logger. Compiles to a no-op in release builds.
#[cfg(debug_assertions)]
pub(crate) fn debug_log(tag: &str, msg: &str) {
    let Some(path) = debug_log_path() else {
        // Fail-closed when no per-user data directory is available. The
        // previous fallback to `std::env::temp_dir()` recreated a
        // predictable shared-temp path (`<tmp>/vimeflow/logs/...`) that
        // a local attacker could pre-seed with a symlink to redirect
        // append writes — exactly the security regression this PR aims
        // to remove. Better to drop debug output entirely than to write
        // it to an attacker-controlled path.
        return;
    };
    if let Err(error) = append_debug_log(&path, tag, msg, MAX_DEBUG_LOG_BYTES) {
        log::warn!("failed to write debug log: {}", error);
    }
}

#[cfg(not(debug_assertions))]
pub(crate) fn debug_log(_tag: &str, _msg: &str) {}

#[cfg(debug_assertions)]
fn debug_log_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| debug_log_path_from_base(base.as_path()))
}

#[cfg(debug_assertions)]
fn debug_log_path_from_base(base_dir: &Path) -> PathBuf {
    base_dir.join("vimeflow").join("logs").join(DEBUG_LOG_NAME)
}

#[cfg(debug_assertions)]
fn append_debug_log(path: &Path, tag: &str, msg: &str, max_bytes: u64) -> io::Result<()> {
    rotate_debug_log_if_needed(path, max_bytes)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut options = OpenOptions::new();
    options.create(true).append(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = options.open(path)?;
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    // Sanitize newlines/CRs so a tag or msg containing embedded line
    // terminators (e.g. a cwd with `\n` — POSIX paths permit any byte
    // except NUL) can't inject phantom rows or break log-parsing
    // tooling. Cosmetic protection only since the file is 0600 in a
    // debug-only build, but the cost is trivial and the corrupted-tail
    // failure mode is hard to diagnose otherwise.
    let safe_tag = sanitize_for_log(tag);
    let safe_msg = sanitize_for_log(msg);
    writeln!(file, "[{secs}] [{safe_tag}] {safe_msg}")
}

#[cfg(debug_assertions)]
fn sanitize_for_log(input: &str) -> String {
    input.replace('\n', "\\n").replace('\r', "\\r")
}

#[cfg(debug_assertions)]
fn rotate_debug_log_if_needed(path: &Path, max_bytes: u64) -> io::Result<()> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };

    if metadata.len() < max_bytes {
        return Ok(());
    }

    // Derive the rotated name from the path itself rather than a
    // separate constant — eliminates the silent-stale failure mode
    // where renaming `DEBUG_LOG_NAME` would leave the rotated form
    // pointing at the old name.
    let rotated_path = path.with_extension("log.1");
    match fs::remove_file(&rotated_path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    fs::rename(path, rotated_path)
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;

    #[test]
    fn debug_log_path_uses_user_data_vimeflow_logs_file() {
        let base_dir = Path::new("local-data");
        let path = debug_log_path_from_base(base_dir);

        assert!(path.starts_with(base_dir));
        assert!(path.ends_with(
            Path::new("vimeflow")
                .join("logs")
                .join("vimeflow-debug.log")
        ));
    }

    #[test]
    fn append_debug_log_creates_parent_directory_and_line() {
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        let path = temp_dir.path().join("logs").join("vimeflow-debug.log");

        append_debug_log(&path, "pty", "spawned", MAX_DEBUG_LOG_BYTES)
            .expect("failed to append debug log");

        let content = fs::read_to_string(path).expect("failed to read debug log");
        assert!(content.contains("[pty] spawned"));
    }

    #[test]
    fn append_debug_log_sanitizes_newlines_in_tag_and_msg() {
        // POSIX paths can contain `\n`. A cwd embedded in `msg` could
        // therefore inject phantom log lines. Sanitizer escapes both
        // `\n` and `\r` so each call produces exactly one log line.
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        let path = temp_dir.path().join("vimeflow-debug.log");

        append_debug_log(&path, "ta\ng", "first\nsecond\rthird", MAX_DEBUG_LOG_BYTES)
            .expect("failed to append debug log");

        let content = fs::read_to_string(&path).expect("failed to read debug log");
        // Exactly one trailing newline (from writeln!), no embedded
        // newlines from the inputs.
        assert_eq!(content.matches('\n').count(), 1);
        assert!(content.contains("[ta\\ng] first\\nsecond\\rthird"));
    }

    #[test]
    fn append_debug_log_rotates_existing_large_file() {
        let temp_dir = tempfile::tempdir().expect("failed to create temp dir");
        let path = temp_dir.path().join("vimeflow-debug.log");
        let rotated_path = temp_dir.path().join("vimeflow-debug.log.1");
        fs::write(&path, "old log").expect("failed to seed debug log");

        append_debug_log(&path, "bridge", "created", 1)
            .expect("failed to append rotated debug log");

        let rotated_content =
            fs::read_to_string(rotated_path).expect("failed to read rotated debug log");
        let current_content = fs::read_to_string(path).expect("failed to read current debug log");

        assert_eq!(rotated_content, "old log");
        assert!(current_content.contains("[bridge] created"));
        assert!(!current_content.contains("old log"));
    }
}
