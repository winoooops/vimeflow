use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

/// Create a tempdir inside `$HOME` so `validate_cwd`'s
/// `ensure_within_home` check passes. The default `tempfile::tempdir()`
/// lives in `/tmp` which is outside `$HOME` on every supported platform,
/// and the validation in production code would reject the path before
/// any git subprocess runs. Tests that exercise git Tauri commands must
/// use this helper instead.
pub fn home_tempdir() -> TempDir {
    let home = dirs::home_dir().expect("no home directory");
    tempfile::Builder::new()
        .prefix("vimeflow-git-test-")
        .tempdir_in(&home)
        .expect("failed to create temp dir under $HOME")
}

/// Configure `user.email` and `user.name` on a fresh git repo so
/// `git commit` doesn't fail on CI runners without a global git config.
pub fn configure_test_git(repo_path: &Path) {
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
