//! Integration tests for the widened `get_git_diff` response shape
//! (`oldText` / `newText` / `rawDiff`). Drives the producer end-to-end
//! through `BackendState::get_git_diff` against tempdir git repos.
//!
//! Tempdirs live under `$HOME` so `validate_cwd`'s `ensure_within_home`
//! check passes (the helper used by `git_status` / `get_git_diff` rejects
//! paths outside the user's home, and the production code path is what we
//! want to exercise here).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use serde_json::Value;
use tempfile::TempDir;
use vimeflow_lib::runtime::{BackendState, EventSink};

/// No-op EventSink — these tests don't assert on events, so the cheapest
/// trait impl that swallows every emit is sufficient.
struct NullEventSink;

impl EventSink for NullEventSink {
    fn emit_json(&self, _event: &str, _payload: Value) -> Result<(), String> {
        Ok(())
    }
}

/// Build a `BackendState` rooted at a tempdir inside `$HOME`. Returning the
/// `TempDir` keeps it alive for the lifetime of the test.
fn make_state() -> (Arc<BackendState>, TempDir) {
    let home = dirs::home_dir().expect("no home directory");
    let app_data_dir = tempfile::Builder::new()
        .prefix("vimeflow-git-diff-response-test-")
        .tempdir_in(&home)
        .expect("failed to create app_data tempdir under $HOME");
    let sink: Arc<dyn EventSink> = Arc::new(NullEventSink);
    let state = Arc::new(BackendState::new(app_data_dir.path().to_path_buf(), sink));
    (state, app_data_dir)
}

/// Create a fresh git repo inside `$HOME` (matching the production
/// `validate_cwd` scope) and return its tempdir.
fn init_repo() -> TempDir {
    let home = dirs::home_dir().expect("no home directory");
    let dir = tempfile::Builder::new()
        .prefix("vimeflow-git-diff-test-")
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

/// Run a git command expected to fail, asserting it exits non-zero.
fn run_git_expect_failure(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap_or_else(|err| panic!("failed to spawn git {args:?}: {err}"));
    assert!(
        !output.status.success(),
        "git {args:?} unexpectedly succeeded (cwd={}): stdout={} stderr={}",
        cwd.display(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Write a file and stage it.
fn write_and_add(repo: &Path, rel: &str, contents: &str) {
    let abs = repo.join(rel);
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).expect("mkdir");
    }
    std::fs::write(&abs, contents).expect("write file");
    run_git(repo, &["add", rel]);
}

/// Commit staged changes with a fixed message.
fn commit(repo: &Path, message: &str) {
    run_git(repo, &["commit", "-m", message, "--quiet"]);
}

/// Convert the (private-type) get_git_diff response into a serde_json::Value
/// so the test can assert on fields without naming `GetGitDiffResponse`
/// (the `git` module is private inside `vimeflow_lib`).
fn diff_value(
    state: &Arc<BackendState>,
    repo: &Path,
    file: &str,
    staged: bool,
    untracked: Option<bool>,
) -> Value {
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let cwd = repo.to_string_lossy().to_string();
    let response = runtime
        .block_on(state.get_git_diff(cwd, file.to_string(), staged, untracked))
        .expect("get_git_diff failed");
    serde_json::to_value(&response).expect("encode response")
}

#[test]
fn modified_tracked_file_unstaged_returns_index_and_worktree_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    // Seed: tracked file at HEAD.
    write_and_add(repo.path(), "src/main.rs", "old line\n");
    commit(repo.path(), "seed");

    // Modify in working tree only (do not stage).
    std::fs::write(repo.path().join("src/main.rs"), "new line\n").expect("write");

    let v = diff_value(&state, repo.path(), "src/main.rs", false, None);

    assert_eq!(v["fileDiff"]["filePath"], "src/main.rs");
    assert!(
        !v["fileDiff"]["hunks"].as_array().expect("hunks").is_empty(),
        "should have at least one hunk"
    );

    // Unstaged: old = index (== HEAD here, no staged changes), new = worktree.
    assert_eq!(
        v["oldText"], "old line\n",
        "old_text should be index/HEAD content"
    );
    assert_eq!(
        v["newText"], "new line\n",
        "new_text should be the working-tree content"
    );
    assert!(
        v["rawDiff"].as_str().expect("rawDiff").contains("@@"),
        "raw_diff should contain a hunk header"
    );
}

#[test]
fn non_utf8_worktree_file_returns_lossy_new_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    write_and_add(repo.path(), "asset.bin", "old text\n");
    commit(repo.path(), "seed");

    std::fs::write(repo.path().join("asset.bin"), [0xff, 0xfe, b'\n']).expect("write");

    let v = diff_value(&state, repo.path(), "asset.bin", false, None);

    assert_eq!(v["oldText"], "old text\n");
    assert!(
        v["newText"].as_str().expect("newText").contains('\u{fffd}'),
        "invalid UTF-8 should be decoded lossily instead of failing the diff"
    );
}

#[test]
fn oversized_worktree_file_returns_empty_new_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    write_and_add(repo.path(), "large.txt", "small\n");
    commit(repo.path(), "seed");

    std::fs::write(
        repo.path().join("large.txt"),
        vec![b'x'; 2 * 1024 * 1024 + 1],
    )
    .expect("write oversized file");

    let v = diff_value(&state, repo.path(), "large.txt", false, None);

    assert_eq!(v["oldText"], "small\n");
    assert_eq!(
        v["newText"], "",
        "oversized working-tree files should not be read into the diff payload"
    );
}

#[test]
fn oversized_staged_blob_returns_empty_new_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    write_and_add(repo.path(), "large.bin", "small\n");
    commit(repo.path(), "seed");

    std::fs::write(repo.path().join("large.bin"), vec![0; 2 * 1024 * 1024 + 1])
        .expect("write oversized file");
    run_git(repo.path(), &["add", "large.bin"]);

    let v = diff_value(&state, repo.path(), "large.bin", true, None);

    assert_eq!(v["oldText"], "small\n");
    assert_eq!(
        v["newText"], "",
        "oversized staged blobs should not be read into the diff payload"
    );
}

#[test]
fn oversized_index_blob_returns_empty_unstaged_old_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    write_and_add(repo.path(), "large.bin", "seed\n");
    commit(repo.path(), "seed");

    std::fs::write(repo.path().join("large.bin"), vec![0; 2 * 1024 * 1024 + 1])
        .expect("write oversized file");
    run_git(repo.path(), &["add", "large.bin"]);
    std::fs::write(repo.path().join("large.bin"), "small worktree\n").expect("write worktree");

    let v = diff_value(&state, repo.path(), "large.bin", false, None);

    assert_eq!(
        v["oldText"], "",
        "oversized index blobs should not be read into the diff payload"
    );
    assert_eq!(v["newText"], "small worktree\n");
}

#[cfg(unix)]
#[test]
fn unstaged_symlink_returns_link_target_as_new_text() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::symlink;

    let (state, _app_data) = make_state();
    let repo = init_repo();
    let secret =
        tempfile::NamedTempFile::new_in(dirs::home_dir().expect("home")).expect("secret temp file");
    std::fs::write(secret.path(), "outside secret\n").expect("write secret");

    symlink("old-target", repo.path().join("link.txt")).expect("create original symlink");
    run_git(repo.path(), &["add", "link.txt"]);
    commit(repo.path(), "seed symlink");

    std::fs::remove_file(repo.path().join("link.txt")).expect("remove symlink");
    symlink(secret.path(), repo.path().join("link.txt")).expect("replace symlink");

    let v = diff_value(&state, repo.path(), "link.txt", false, None);
    let target_text = String::from_utf8_lossy(secret.path().as_os_str().as_bytes()).into_owned();

    assert_eq!(v["oldText"], "old-target");
    assert_eq!(
        v["newText"], target_text,
        "unstaged symlink new_text should be the link target, not followed contents"
    );
    assert_ne!(
        v["newText"], "outside secret\n",
        "new_text must not expose the symlink target file contents"
    );
}

#[test]
fn unmerged_unstaged_file_uses_stage_2_old_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    write_and_add(repo.path(), "conflict.txt", "base\n");
    commit(repo.path(), "seed");

    run_git(repo.path(), &["checkout", "-b", "theirs", "--quiet"]);
    write_and_add(repo.path(), "conflict.txt", "theirs\n");
    commit(repo.path(), "theirs edit");

    run_git(repo.path(), &["checkout", "main", "--quiet"]);
    write_and_add(repo.path(), "conflict.txt", "ours\n");
    commit(repo.path(), "ours edit");

    run_git_expect_failure(repo.path(), &["merge", "theirs"]);

    let v = diff_value(&state, repo.path(), "conflict.txt", false, None);

    assert_eq!(
        v["oldText"], "ours\n",
        "unmerged unstaged old_text should fall back to the stage-2 blob"
    );
    assert!(
        v["newText"]
            .as_str()
            .expect("newText")
            .contains("<<<<<<< HEAD"),
        "new_text should read the conflicted working-tree file"
    );
}

#[test]
fn modified_tracked_file_staged_returns_head_and_index_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    // HEAD has "v1".
    write_and_add(repo.path(), "src/main.rs", "v1\n");
    commit(repo.path(), "seed");

    // Stage a different version "v2".
    std::fs::write(repo.path().join("src/main.rs"), "v2\n").expect("write");
    run_git(repo.path(), &["add", "src/main.rs"]);

    let v = diff_value(&state, repo.path(), "src/main.rs", true, None);

    assert_eq!(
        v["oldText"], "v1\n",
        "staged old_text should be HEAD content"
    );
    assert_eq!(
        v["newText"], "v2\n",
        "staged new_text should be index content"
    );
    assert!(v["rawDiff"].as_str().expect("rawDiff").contains("@@"));
}

#[test]
fn staged_newly_added_file_returns_empty_old_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    // Seed an unrelated file so HEAD exists.
    write_and_add(repo.path(), "seed.txt", "seed\n");
    commit(repo.path(), "seed");

    // Add a brand-new file and stage it (first appearance in index, no HEAD version).
    write_and_add(repo.path(), "brand_new.rs", "fresh\ncontents\n");

    let v = diff_value(&state, repo.path(), "brand_new.rs", true, None);

    assert_eq!(
        v["oldText"], "",
        "newly-added staged file => old_text is empty"
    );
    assert_eq!(
        v["newText"], "fresh\ncontents\n",
        "newly-added staged file => new_text is the staged content"
    );
    assert!(
        v["rawDiff"]
            .as_str()
            .expect("rawDiff")
            .contains("--- /dev/null"),
        "raw_diff should mark base as /dev/null for newly-added file"
    );
}

#[test]
fn untracked_file_returns_empty_old_text_and_worktree_new_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    // No commits and no `git add` — an untracked file.
    std::fs::write(repo.path().join("untracked.txt"), "alpha\nbeta\n").expect("write");

    // Pass `untracked: Some(true)` to skip the is_file_untracked probe (which
    // requires HEAD to exist in some code paths).
    let v = diff_value(&state, repo.path(), "untracked.txt", false, Some(true));

    assert_eq!(v["oldText"], "", "untracked => old_text empty");
    assert_eq!(
        v["newText"], "alpha\nbeta\n",
        "untracked => new_text reads the worktree file"
    );
    assert!(
        !v["rawDiff"].as_str().expect("rawDiff").is_empty(),
        "raw_diff should hold the synthesized --no-index diff"
    );
    assert!(
        v["rawDiff"]
            .as_str()
            .expect("rawDiff")
            .contains("+++ b/untracked.txt"),
        "raw_diff should use a repo-relative path for hunk application"
    );
    assert!(
        !v["rawDiff"]
            .as_str()
            .expect("rawDiff")
            .contains(repo.path().to_string_lossy().as_ref()),
        "raw_diff should not embed the absolute repo path"
    );
}

#[cfg(unix)]
#[test]
fn untracked_symlink_returns_link_target_as_new_text() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::symlink;

    let (state, _app_data) = make_state();
    let repo = init_repo();
    let secret =
        tempfile::NamedTempFile::new_in(dirs::home_dir().expect("home")).expect("secret temp file");
    std::fs::write(secret.path(), "outside secret\n").expect("write secret");

    symlink(secret.path(), repo.path().join("leak.txt")).expect("create symlink");

    let v = diff_value(&state, repo.path(), "leak.txt", false, Some(true));
    let target_text = String::from_utf8_lossy(secret.path().as_os_str().as_bytes()).into_owned();

    assert_eq!(v["oldText"], "", "untracked symlink => old_text empty");
    assert_eq!(
        v["newText"], target_text,
        "untracked symlink new_text should be the link target, not followed contents"
    );
    assert_ne!(
        v["newText"], "outside secret\n",
        "new_text must not expose the symlink target file contents"
    );
    assert!(
        v["rawDiff"]
            .as_str()
            .expect("rawDiff")
            .contains(&format!("+{target_text}")),
        "raw_diff should also describe the symlink target"
    );
}

#[test]
fn deleted_file_staged_returns_empty_new_text() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    // Commit a file, then `git rm` it (stages the deletion).
    write_and_add(repo.path(), "doomed.txt", "soon to be gone\n");
    commit(repo.path(), "seed");
    run_git(repo.path(), &["rm", "--quiet", "doomed.txt"]);

    let v = diff_value(&state, repo.path(), "doomed.txt", true, None);

    assert_eq!(
        v["oldText"], "soon to be gone\n",
        "deleted file => old_text is the HEAD content"
    );
    assert_eq!(v["newText"], "", "deleted file => new_text is empty");
    assert!(
        v["rawDiff"]
            .as_str()
            .expect("rawDiff")
            .contains("+++ /dev/null"),
        "raw_diff should mark tip as /dev/null for deleted file"
    );
}

#[test]
fn renamed_file_resolves_old_and_new_paths_independently() {
    let (state, _app_data) = make_state();
    let repo = init_repo();

    // Commit at old path.
    write_and_add(repo.path(), "old_name.txt", "shared body\n");
    commit(repo.path(), "seed");

    // Rename via `git mv` (stages the rename).
    run_git(repo.path(), &["mv", "old_name.txt", "new_name.txt"]);

    let v = diff_value(&state, repo.path(), "new_name.txt", true, None);

    // The diff header should carry the rename.
    let raw = v["rawDiff"].as_str().expect("rawDiff");
    assert!(
        raw.contains("rename from old_name.txt"),
        "raw_diff should record the old name; got: {raw}"
    );

    // old_text resolves against `old_name.txt` at HEAD.
    assert_eq!(
        v["oldText"], "shared body\n",
        "renamed file => old_text reads HEAD:<oldPath>"
    );
    // new_text resolves against `new_name.txt` in the index.
    assert_eq!(
        v["newText"], "shared body\n",
        "renamed file => new_text reads :<newPath> from index"
    );

    let parsed = &v["fileDiff"];
    assert_eq!(parsed["filePath"], "new_name.txt");
    assert_eq!(parsed["oldPath"], "old_name.txt");
    assert_eq!(parsed["newPath"], "new_name.txt");
}

// Unused helper kept for symmetry with future tests that need a tracked
// working-tree edit; silences `dead_code` if any test stops using it later.
#[allow(dead_code)]
fn touch_path(repo: &Path, rel: &str) -> PathBuf {
    repo.join(rel)
}
