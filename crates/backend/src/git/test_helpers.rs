use std::path::{Path, PathBuf};
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

/// Create a main repo plus linked worktrees in a tempdir under `$HOME`.
/// Worktrees are siblings of the main repo so the main working tree does not
/// see them as untracked nested directories.
pub(crate) fn create_main_repo_with_worktrees(
    branches: &[&str],
) -> (TempDir, PathBuf, Vec<PathBuf>) {
    let tmp = home_tempdir();
    let main = tmp.path().join("main");
    std::fs::create_dir(&main).expect("failed to create main repo dir");

    let init = Command::new("git")
        .args(["init", "--initial-branch=main"])
        .current_dir(&main)
        .output()
        .expect("git init failed");
    assert!(
        init.status.success(),
        "git init must succeed: {}",
        String::from_utf8_lossy(&init.stderr)
    );

    configure_test_git(&main);
    std::fs::write(main.join("seed"), "seed").expect("failed to write seed");

    let add = Command::new("git")
        .args(["add", "."])
        .current_dir(&main)
        .output()
        .expect("git add failed");
    assert!(
        add.status.success(),
        "git add must succeed: {}",
        String::from_utf8_lossy(&add.stderr)
    );

    let commit = Command::new("git")
        .args(["commit", "-m", "seed"])
        .current_dir(&main)
        .output()
        .expect("git commit failed");
    assert!(
        commit.status.success(),
        "git commit must succeed: {}",
        String::from_utf8_lossy(&commit.stderr)
    );

    let mut worktrees = Vec::with_capacity(branches.len());
    for (index, branch) in branches.iter().enumerate() {
        let worktree = tmp.path().join(format!("wt-{index}"));
        let add_worktree = Command::new("git")
            .args([
                "worktree",
                "add",
                "-b",
                branch,
                worktree.to_str().expect("worktree path should be utf8"),
            ])
            .current_dir(&main)
            .output()
            .expect("git worktree add failed");
        assert!(
            add_worktree.status.success(),
            "git worktree add must succeed: {}",
            String::from_utf8_lossy(&add_worktree.stderr)
        );
        worktrees.push(worktree);
    }

    (tmp, main, worktrees)
}
