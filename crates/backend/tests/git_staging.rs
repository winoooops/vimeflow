//! Integration tests for the stage/unstage/discard handlers.
//!
//! Every test creates a real git repo inside `$HOME` (matching the production
//! `validate_cwd` scope) via `init_repo()` and drives the handlers end-to-end.
//!
//! Run with: `cargo test --test git_staging`

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;
use vimeflow_lib::git::{DiscardFileRequest, DiscardScope, StageFileRequest};

// ── repo helpers ─────────────────────────────────────────────────────────────

/// Create a fresh git repo inside `$HOME` (matching the production
/// `validate_cwd` scope) and return its tempdir.
fn init_repo() -> TempDir {
    let home = dirs::home_dir().expect("no home directory");
    let dir = tempfile::Builder::new()
        .prefix("vimeflow-git-staging-test-")
        .tempdir_in(&home)
        .expect("failed to create tempdir under $HOME");

    run_git(dir.path(), &["init", "--quiet", "--initial-branch=main"]);
    run_git(dir.path(), &["config", "user.email", "test@vimeflow.test"]);
    run_git(dir.path(), &["config", "user.name", "Vimeflow Test"]);

    dir
}

/// Run a git command in `cwd`, asserting success.
fn run_git(cwd: &Path, args: &[&str]) {
    let status = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .status()
        .unwrap_or_else(|err| panic!("failed to spawn git {args:?}: {err}"));
    assert!(
        status.success(),
        "git {args:?} failed (cwd={})",
        cwd.display()
    );
}

/// Run a git command and return combined stdout as a String.
fn git_output(cwd: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap_or_else(|err| panic!("failed to spawn git {args:?}: {err}"));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Write `content` to `file` (relative to `cwd`), creating parent dirs if needed.
fn write_file(cwd: &Path, file: &str, content: &str) {
    let full = cwd.join(file);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).expect("create_dir_all");
    }
    std::fs::write(&full, content).unwrap_or_else(|e| panic!("write {file}: {e}"));
}

/// Make an initial commit with one file so HEAD is valid.
fn initial_commit(repo: &TempDir) {
    write_file(repo.path(), "init.txt", "initial\n");
    run_git(repo.path(), &["add", "init.txt"]);
    run_git(repo.path(), &["commit", "-m", "initial", "--no-gpg-sign"]);
}

fn cwd_str(repo: &TempDir) -> String {
    repo.path().to_string_lossy().into_owned()
}

// ── helper to capture `git status --short` output ────────────────────────────

fn git_status_short(repo: &TempDir) -> String {
    git_output(repo.path(), &["status", "--short"])
}

fn git_diff_cached(repo: &TempDir) -> String {
    git_output(repo.path(), &["diff", "--cached"])
}

fn git_diff_workdir(repo: &TempDir) -> String {
    git_output(repo.path(), &["diff"])
}

/// Capture `git diff -- <file>` output as a string (the working-tree patch).
/// Returns the raw unified-diff text that `git apply --cached` can consume.
fn capture_diff(repo: &TempDir, file: &str) -> String {
    let out = Command::new("git")
        .current_dir(repo.path())
        .args(["diff", "--", file])
        .output()
        .unwrap_or_else(|e| panic!("git diff failed: {e}"));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Capture `git diff --cached -- <file>` output as a string (the index patch).
/// Used to get a per-hunk patch that can be applied with `--cached --reverse`.
fn capture_cached_diff(repo: &TempDir, file: &str) -> String {
    let out = Command::new("git")
        .current_dir(repo.path())
        .args(["diff", "--cached", "--", file])
        .output()
        .unwrap_or_else(|e| panic!("git diff --cached failed: {e}"));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Extract just the first hunk from a multi-hunk `git diff` output.
/// Keeps the file headers (`diff --git`, `---`, `+++`) and replaces the body
/// with only the lines up to (but not including) the second `@@ ` marker.
fn first_hunk_only(diff: &str) -> String {
    let mut out = String::new();
    let mut in_first_hunk = false;
    for line in diff.lines() {
        if line.starts_with("@@") {
            if in_first_hunk {
                // Second hunk starts — stop.
                break;
            }
            in_first_hunk = true;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

// ── tokio runtime helper ──────────────────────────────────────────────────────

fn rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("rt")
}

// ── Test 1: whole-file stage of a modified tracked file ──────────────────────

#[test]
fn whole_file_stage_shows_staged_in_status() {
    let repo = init_repo();
    initial_commit(&repo);

    // Modify the tracked file.
    write_file(repo.path(), "init.txt", "changed\n");

    let req = StageFileRequest {
        cwd: cwd_str(&repo),
        path: "init.txt".to_string(),
        hunk_patch: None,
    };

    rt().block_on(vimeflow_lib::git::stage_file_inner(req))
        .expect("stage_file_inner should succeed");

    // "M " means the modification is staged (index ≠ HEAD, working tree = index).
    let status = git_status_short(&repo);
    assert!(
        status.contains("M  init.txt"),
        "expected 'M  init.txt' in status, got: {status}"
    );
}

// ── Test 2: per-hunk stage with a valid patch ─────────────────────────────────

#[test]
fn per_hunk_stage_only_that_hunk_in_diff_cached() {
    let repo = init_repo();

    // Commit a file with two blocks far enough apart that git produces two
    // separate hunks (>6 lines between them, since the default context is 3).
    let initial = concat!(
        "alpha\n",
        "ctx1\nctx2\nctx3\nctx4\nctx5\nctx6\nctx7\n",
        "gamma\n",
    );
    write_file(repo.path(), "multi.txt", initial);
    run_git(repo.path(), &["add", "multi.txt"]);
    run_git(repo.path(), &["commit", "-m", "add multi", "--no-gpg-sign"]);

    // Modify the first and last lines — the two hunks are far apart.
    let modified = concat!(
        "ALPHA\n",
        "ctx1\nctx2\nctx3\nctx4\nctx5\nctx6\nctx7\n",
        "GAMMA\n",
    );
    write_file(repo.path(), "multi.txt", modified);

    // Capture the full diff and extract just the first hunk (alpha→ALPHA).
    let full_diff = capture_diff(&repo, "multi.txt");
    let patch = first_hunk_only(&full_diff);

    // Count hunk headers: lines starting with "@@".
    let full_hunk_count = full_diff.lines().filter(|l| l.starts_with("@@")).count();
    let patch_hunk_count = patch.lines().filter(|l| l.starts_with("@@")).count();
    assert!(
        full_hunk_count >= 2,
        "expected at least 2 hunk headers in full diff, got {full_hunk_count}: {full_diff}"
    );
    assert_eq!(
        patch_hunk_count, 1,
        "first_hunk_only should retain exactly one hunk, got {patch_hunk_count}"
    );

    let req = StageFileRequest {
        cwd: cwd_str(&repo),
        path: "multi.txt".to_string(),
        hunk_patch: Some(patch),
    };

    rt().block_on(vimeflow_lib::git::stage_file_inner(req))
        .expect("per-hunk stage should succeed");

    let cached = git_diff_cached(&repo);
    // The staged diff should mention ALPHA but NOT GAMMA.
    assert!(
        cached.contains("+ALPHA"),
        "cached diff should contain +ALPHA, got: {cached}"
    );
    assert!(
        !cached.contains("+GAMMA"),
        "cached diff should NOT contain +GAMMA, got: {cached}"
    );

    // The working-tree diff should still contain GAMMA (unstaged).
    let workdir = git_diff_workdir(&repo);
    assert!(
        workdir.contains("+GAMMA"),
        "working-tree diff should still contain +GAMMA, got: {workdir}"
    );
}

// ── Test 3: per-hunk stage with a stale patch returns Err ────────────────────
//
// "Stale" means the index content has changed since the patch was captured,
// so the context lines no longer match what `git apply --cached` sees. We
// simulate this by:
//   1. Capturing a patch while the file is at revision A.
//   2. Staging the file at revision B (modifying the index).
//   3. Applying the revision-A patch — git rejects it because the index no
//      longer looks like revision A.

#[test]
fn per_hunk_stage_stale_patch_returns_err() {
    let repo = init_repo();

    write_file(repo.path(), "stale.txt", "line1\nline2\n");
    run_git(repo.path(), &["add", "stale.txt"]);
    run_git(repo.path(), &["commit", "-m", "add stale", "--no-gpg-sign"]);

    // Make a first modification: capture a patch from line1 → MODIFIED.
    write_file(repo.path(), "stale.txt", "MODIFIED\nline2\n");
    let stale_patch = capture_diff(&repo, "stale.txt");
    assert!(!stale_patch.is_empty(), "stale patch should not be empty");

    // Stage this first modification (index is now MODIFIED\nline2\n).
    run_git(repo.path(), &["add", "stale.txt"]);

    // Make a second modification in the working tree (doesn't affect the index).
    write_file(repo.path(), "stale.txt", "SECOND_CHANGE\nline2\n");

    // Now try to re-apply the first patch to the index. The index already
    // contains MODIFIED (not line1), so the context no longer matches and
    // git apply --cached should reject it.
    let req = StageFileRequest {
        cwd: cwd_str(&repo),
        path: "stale.txt".to_string(),
        hunk_patch: Some(stale_patch),
    };

    let result = rt().block_on(vimeflow_lib::git::stage_file_inner(req));
    assert!(
        result.is_err(),
        "applying a stale patch against a changed index should fail, got Ok"
    );
}

// ── Test 4: per-hunk stage with a multi-file patch is rejected ───────────────

#[test]
fn per_hunk_stage_multi_file_patch_rejected_before_git() {
    let repo = init_repo();
    initial_commit(&repo);

    // A patch with two `diff --git` headers — must be rejected by validate_hunk_patch.
    let bad_patch = concat!(
        "diff --git a/foo.txt b/foo.txt\n",
        "--- a/foo.txt\n",
        "+++ b/foo.txt\n",
        "@@ -1,1 +1,1 @@\n",
        "-old\n",
        "+new\n",
        "diff --git a/bar.txt b/bar.txt\n",
        "--- a/bar.txt\n",
        "+++ b/bar.txt\n",
        "@@ -1,1 +1,1 @@\n",
        "-old\n",
        "+new\n",
    );

    let req = StageFileRequest {
        cwd: cwd_str(&repo),
        path: "foo.txt".to_string(),
        hunk_patch: Some(bad_patch.to_string()),
    };

    let result = rt().block_on(vimeflow_lib::git::stage_file_inner(req));
    assert!(
        result.is_err(),
        "multi-file patch should be rejected before git"
    );
    let err = result.unwrap_err();
    assert!(
        err.contains("multi-file"),
        "error should mention multi-file, got: {err}"
    );
}

// ── Test 5: patch whose header names a different file is rejected ─────────────

#[test]
fn per_hunk_stage_patch_for_wrong_file_rejected() {
    let repo = init_repo();
    initial_commit(&repo);

    // Patch declares it targets "other.txt" but req.path is "init.txt".
    let bad_patch = concat!(
        "diff --git a/other.txt b/other.txt\n",
        "--- a/other.txt\n",
        "+++ b/other.txt\n",
        "@@ -1,1 +1,1 @@\n",
        "-old\n",
        "+new\n",
    );

    let req = StageFileRequest {
        cwd: cwd_str(&repo),
        path: "init.txt".to_string(),
        hunk_patch: Some(bad_patch.to_string()),
    };

    let result = rt().block_on(vimeflow_lib::git::stage_file_inner(req));
    assert!(
        result.is_err(),
        "patch targeting wrong file should be rejected"
    );
    let err = result.unwrap_err();
    assert!(
        err.contains("different file") || err.contains("targets"),
        "error should mention file mismatch, got: {err}"
    );
}

// ── Test 6: discard of an untracked file removes it from disk ─────────────────

#[test]
fn discard_untracked_file_removes_it() {
    let repo = init_repo();
    initial_commit(&repo);

    // Write an untracked file (never git-added).
    write_file(repo.path(), "untracked.txt", "some content\n");
    assert!(
        repo.path().join("untracked.txt").exists(),
        "file should exist before discard"
    );

    let req = DiscardFileRequest {
        cwd: cwd_str(&repo),
        path: "untracked.txt".to_string(),
        hunk_patch: None,
        scope: DiscardScope::Unstaged,
    };

    rt().block_on(vimeflow_lib::git::discard_file_inner(req))
        .expect("discard untracked should succeed");

    assert!(
        !repo.path().join("untracked.txt").exists(),
        "file should be removed after discard"
    );
}

// ── Test 7: whole-file discard of a modified tracked file restores HEAD ───────

#[test]
fn whole_file_discard_tracked_restores_head() {
    let repo = init_repo();
    initial_commit(&repo);

    // Confirm the initial content.
    let original = std::fs::read_to_string(repo.path().join("init.txt")).expect("read");
    assert_eq!(original, "initial\n");

    // Modify the file without staging.
    write_file(repo.path(), "init.txt", "modified content\n");

    let req = DiscardFileRequest {
        cwd: cwd_str(&repo),
        path: "init.txt".to_string(),
        hunk_patch: None,
        scope: DiscardScope::Unstaged,
    };

    rt().block_on(vimeflow_lib::git::discard_file_inner(req))
        .expect("discard modified tracked file should succeed");

    let after = std::fs::read_to_string(repo.path().join("init.txt")).expect("read after");
    assert_eq!(
        after, "initial\n",
        "file should be restored to HEAD content"
    );
}

// ── Test 8: unstage of a per-hunk stage restores the delta to working tree ────

#[test]
fn unstage_per_hunk_restores_delta_to_working_tree() {
    let repo = init_repo();

    // Commit a single-change file so the diff has exactly one hunk.
    write_file(repo.path(), "one_hunk.txt", "alpha\nbeta\ngamma\n");
    run_git(repo.path(), &["add", "one_hunk.txt"]);
    run_git(
        repo.path(),
        &["commit", "-m", "add one_hunk", "--no-gpg-sign"],
    );

    // Modify the working tree.
    write_file(repo.path(), "one_hunk.txt", "ALPHA\nbeta\ngamma\n");

    // Capture the real diff as the hunk patch.
    let patch = capture_diff(&repo, "one_hunk.txt");
    assert!(!patch.is_empty(), "patch should not be empty");

    // Stage using the captured patch.
    let stage_req = StageFileRequest {
        cwd: cwd_str(&repo),
        path: "one_hunk.txt".to_string(),
        hunk_patch: Some(patch.clone()),
    };
    rt().block_on(vimeflow_lib::git::stage_file_inner(stage_req))
        .expect("stage should succeed");

    // Confirm it's staged.
    let cached_before = git_diff_cached(&repo);
    assert!(
        cached_before.contains("+ALPHA"),
        "hunk should be staged, got: {cached_before}"
    );

    // The patch to reverse is the cached diff (index → HEAD direction).
    let cached_patch = capture_cached_diff(&repo, "one_hunk.txt");
    assert!(!cached_patch.is_empty(), "cached patch should not be empty");

    // Unstage using the cached diff patch.
    let unstage_req = StageFileRequest {
        cwd: cwd_str(&repo),
        path: "one_hunk.txt".to_string(),
        hunk_patch: Some(cached_patch),
    };
    rt().block_on(vimeflow_lib::git::unstage_file_inner(unstage_req))
        .expect("unstage should succeed");

    // Index should now match HEAD (no staged diff).
    let cached_after = git_diff_cached(&repo);
    assert!(
        cached_after.is_empty(),
        "index should be clean after unstage, got: {cached_after}"
    );

    // But the working tree still has the change.
    let workdir_after = git_diff_workdir(&repo);
    assert!(
        workdir_after.contains("+ALPHA"),
        "working tree should still have ALPHA after unstage, got: {workdir_after}"
    );
}
