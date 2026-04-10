# Filesystem Module Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src-tauri/src/filesystem/commands.rs` (864 lines) into focused files (`list.rs`, `read.rs`, `write.rs`, `scope.rs`), extract tests into a `tests/` sub-module, and add `SECURITY.md` documenting the threat model — without changing any production behavior.

**Architecture:** Pure refactor. Shared sandbox helpers move into `scope.rs`; each Tauri command gets its own file. `mod.rs` keeps re-exporting the same three public command names so `src-tauri/src/lib.rs` (the `invoke_handler!` macro) needs no changes. All 15 existing regression tests from PR #38 must pass at every commit boundary — they are the safety net for the 14 security findings catalogued in `docs/reviews/patterns/filesystem-scope.md`.

**Tech Stack:** Rust, Tauri 2, `cargo test`, `cargo clippy`, `cargo fmt`. Crate: `vimeflow` (lib: `vimeflow_lib`). Test binary runs from `src-tauri/Cargo.toml`.

**Spec:** `docs/superpowers/specs/2026-04-10-filesystem-module-refactor-design.md`

---

## Working Directory

**All work happens in the worktree at `.claude/worktrees/fs-refactor/`** (branch `refactor/filesystem-module-split`). The main checkout at `/home/claw/projects/Vimeflow/` must remain on `main` and untouched.

```bash
cd /home/claw/projects/Vimeflow/.claude/worktrees/fs-refactor
```

All `cargo` and `git` commands below assume this working directory.

---

## Regression Safety Net

The 15 existing tests in `src-tauri/src/filesystem/commands.rs` lines 490-864 MUST all pass at every commit boundary. Their names (ordered as they appear in the file):

1. `list_dir_returns_sorted_entries`
2. `list_dir_skips_hidden_files`
3. `list_dir_rejects_nonexistent_path`
4. `read_file_returns_content`
5. `read_file_rejects_path_outside_home`
6. `read_file_rejects_directory`
7. `write_file_creates_file`
8. `write_file_creates_parent_dirs`
9. `write_file_rejects_path_outside_home`
10. `write_file_rejects_traversal_into_sibling_of_home`
11. `read_file_refuses_to_follow_symlink_escaping_home` (`#[cfg(unix)]`)
12. `write_file_refuses_to_follow_symlink_escaping_home` (`#[cfg(unix)]`)
13. `write_file_refuses_intermediate_symlink_escape` (`#[cfg(unix)]`)
14. `write_file_refuses_symlink_even_to_in_home_target` (`#[cfg(unix)]`)
15. `write_file_overwrites_existing`

Tests 11-14 are Unix-only (`#[cfg(unix)]`). On Linux/macOS: all 15 run. On Windows: 11 run. All development in this plan assumes Linux/WSL (15 tests expected).

**Test count baseline (run this once at Task 0 and copy the exact number into each subsequent test step):**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: 2>&1 | tail -5
```

Expected output includes: `test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured`

---

## Task 0: Baseline Verification

Record the starting state so we can detect silent drift.

**Files:** none modified

- [ ] **Step 1: Confirm clean worktree and correct branch**

Run:

```bash
git status
git branch --show-current
```

Expected:

- `On branch refactor/filesystem-module-split`
- Working tree clean (only the previously-committed spec file exists)

- [ ] **Step 2: Record baseline test count**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: 2>&1 | tail -5
```

Expected output (last line):

```
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

If the count is not exactly 15 on Linux, STOP. Something has changed upstream and this plan's assumptions are wrong.

- [ ] **Step 3: Record baseline test name list**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: -- --list 2>&1 | grep ": test" | sort
```

Expected output (15 lines, exact names, alphabetized):

```
filesystem::commands::tests::list_dir_rejects_nonexistent_path: test
filesystem::commands::tests::list_dir_returns_sorted_entries: test
filesystem::commands::tests::list_dir_skips_hidden_files: test
filesystem::commands::tests::read_file_refuses_to_follow_symlink_escaping_home: test
filesystem::commands::tests::read_file_rejects_directory: test
filesystem::commands::tests::read_file_rejects_path_outside_home: test
filesystem::commands::tests::read_file_returns_content: test
filesystem::commands::tests::write_file_creates_file: test
filesystem::commands::tests::write_file_creates_parent_dirs: test
filesystem::commands::tests::write_file_overwrites_existing: test
filesystem::commands::tests::write_file_refuses_intermediate_symlink_escape: test
filesystem::commands::tests::write_file_refuses_symlink_even_to_in_home_target: test
filesystem::commands::tests::write_file_refuses_to_follow_symlink_escaping_home: test
filesystem::commands::tests::write_file_rejects_path_outside_home: test
filesystem::commands::tests::write_file_rejects_traversal_into_sibling_of_home: test
```

Save this list mentally or in a scratch buffer. After each commit in this plan, the 15 test names must still be present (the **module path prefix will change** as we move files, but the final segment — the test function name — must match).

- [ ] **Step 4: Confirm lib.rs re-export**

Run:

```bash
grep -n "filesystem" src-tauri/src/lib.rs
```

Expected:

```
1:mod filesystem;
4:use filesystem::{list_dir, read_file, write_file};
```

This import MUST continue to resolve after every commit. Breaking it means `mod.rs` stopped re-exporting one of the three public commands — stop and investigate.

---

## Task 1: Commit 1 — Extract Tests into `filesystem/tests/`

**Goal:** Move the 15 tests out of `commands.rs` into a `tests/` sub-module with one file per command. Production code in `commands.rs` is unchanged. After this task, `commands.rs` drops from 864 → ~489 lines.

**Files:**

- Create: `src-tauri/src/filesystem/tests/mod.rs`
- Create: `src-tauri/src/filesystem/tests/list_tests.rs`
- Create: `src-tauri/src/filesystem/tests/read_tests.rs`
- Create: `src-tauri/src/filesystem/tests/write_tests.rs`
- Modify: `src-tauri/src/filesystem/mod.rs` (add `#[cfg(test)] mod tests;` declaration)
- Modify: `src-tauri/src/filesystem/commands.rs` (delete lines 490-864, the `#[cfg(test)] mod tests { ... }` block)

### Step 1: Create `tests/mod.rs`

- [ ] **Step 1: Write `src-tauri/src/filesystem/tests/mod.rs`**

Create the file with this exact content:

```rust
//! Test module for filesystem IPC commands.
//!
//! Tests are split by command (`list_tests`, `read_tests`, `write_tests`)
//! to keep each file under the 800-line guideline. Shared helpers live
//! here and are re-exported to child modules via `use super::*;`.
//!
//! The 15 tests in this tree are the regression safety net for the 14
//! security findings catalogued in
//! `docs/reviews/patterns/filesystem-scope.md`. If you're renaming a
//! test, update the map in `src-tauri/src/filesystem/SECURITY.md`
//! (once added in Task 4).

#![cfg(test)]

use std::path::PathBuf;

// Re-export the items under test so child modules can `use super::*;`
pub(super) use super::commands::{list_dir, read_file, write_file};
pub(super) use super::types::{
    EntryType, ListDirRequest, ReadFileRequest, WriteFileRequest,
};

/// Create a temp dir under $HOME so it passes the home-directory scope check.
/// Tests using `/tmp` would fail the sandbox check (see finding #3 in
/// `docs/reviews/patterns/filesystem-scope.md`).
pub(super) fn home_test_dir(name: &str) -> PathBuf {
    dirs::home_dir()
        .expect("HOME must be set for tests")
        .join(format!(".vimeflow_test_{}", name))
}

mod list_tests;
mod read_tests;
mod write_tests;
```

### Step 2: Create `tests/list_tests.rs`

- [ ] **Step 2: Write `src-tauri/src/filesystem/tests/list_tests.rs`**

Create the file with this exact content (these are the 3 `list_dir_*` tests copied verbatim from `commands.rs` lines 502-559):

```rust
use super::*;
use std::fs;

#[test]
fn list_dir_returns_sorted_entries() {
    let dir = home_test_dir("list_dir");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::create_dir(dir.join("beta")).unwrap();
    fs::create_dir(dir.join("alpha")).unwrap();
    fs::write(dir.join("zebra.txt"), "").unwrap();
    fs::write(dir.join("apple.txt"), "").unwrap();

    let result = list_dir(ListDirRequest {
        path: dir.to_string_lossy().to_string(),
    });

    assert!(result.is_ok());
    let entries = result.unwrap();
    assert_eq!(entries.len(), 4);
    // Folders first, sorted
    assert_eq!(entries[0].name, "alpha");
    assert_eq!(entries[0].entry_type, EntryType::Folder);
    assert_eq!(entries[1].name, "beta");
    assert_eq!(entries[1].entry_type, EntryType::Folder);
    // Files second, sorted
    assert_eq!(entries[2].name, "apple.txt");
    assert_eq!(entries[2].entry_type, EntryType::File);
    assert_eq!(entries[3].name, "zebra.txt");
    assert_eq!(entries[3].entry_type, EntryType::File);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn list_dir_skips_hidden_files() {
    let dir = home_test_dir("hidden");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(".hidden"), "").unwrap();
    fs::write(dir.join("visible.txt"), "").unwrap();

    let result = list_dir(ListDirRequest {
        path: dir.to_string_lossy().to_string(),
    });

    assert!(result.is_ok());
    let entries = result.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "visible.txt");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn list_dir_rejects_nonexistent_path() {
    let result = list_dir(ListDirRequest {
        path: "/nonexistent/path/abc123".to_string(),
    });
    assert!(result.is_err());
}
```

### Step 3: Create `tests/read_tests.rs`

- [ ] **Step 3: Write `src-tauri/src/filesystem/tests/read_tests.rs`**

Create the file with this exact content (these are the 4 `read_file_*` tests copied verbatim from `commands.rs` lines 561-601 and 684-724):

```rust
use super::*;
use std::fs;

#[test]
fn read_file_returns_content() {
    let dir = home_test_dir("read_file");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("hello.txt"), "hello world").unwrap();

    let result = read_file(ReadFileRequest {
        path: dir.join("hello.txt").to_string_lossy().to_string(),
    });

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "hello world");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_file_rejects_path_outside_home() {
    let result = read_file(ReadFileRequest {
        path: "/etc/passwd".to_string(),
    });
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("access denied"));
}

#[test]
fn read_file_rejects_directory() {
    let dir = home_test_dir("read_file_dir");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let result = read_file(ReadFileRequest {
        path: dir.to_string_lossy().to_string(),
    });

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not a file"));

    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn read_file_refuses_to_follow_symlink_escaping_home() {
    // Mirror of the write_file symlink regression test. If a symlink
    // inside home points outside home and `read_file` follows it,
    // the webview would receive sandbox-escaped contents.
    use std::os::unix::fs::symlink;

    let dir = home_test_dir("read_file_symlink_escape");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    // Point the symlink at a real file outside home so canonicalize() resolves
    // and the scope check would otherwise accept it if not for O_NOFOLLOW.
    let outside_target = std::env::temp_dir().join(
        ".vimeflow_read_file_symlink_secret.txt",
    );
    fs::write(&outside_target, "SECRET").unwrap();

    let link = dir.join("innocent_name.txt");
    symlink(&outside_target, &link).unwrap();

    // The expand_home+canonicalize path will resolve the symlink and
    // realize it's outside home, so the scope check rejects it here.
    // (The O_NOFOLLOW guard is defense-in-depth for the TOCTOU race
    // where the symlink is introduced between canonicalize and open.)
    let result = read_file(ReadFileRequest {
        path: link.to_string_lossy().to_string(),
    });

    assert!(result.is_err(), "symlink-escape read must be rejected");
    let err = result.unwrap_err();
    assert!(
        err.contains("access denied") || err.contains("invalid path"),
        "expected scope rejection, got: {}",
        err
    );

    let _ = fs::remove_file(&outside_target);
    let _ = fs::remove_dir_all(&dir);
}
```

### Step 4: Create `tests/write_tests.rs`

- [ ] **Step 4: Write `src-tauri/src/filesystem/tests/write_tests.rs`**

Create the file with this exact content (these are the 8 `write_file_*` tests copied verbatim from `commands.rs` lines 603-682 and 727-863):

```rust
use super::*;
use std::fs;

#[test]
fn write_file_creates_file() {
    let dir = home_test_dir("write_file");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let file_path = dir.join("new_file.txt");
    let result = write_file(WriteFileRequest {
        path: file_path.to_string_lossy().to_string(),
        content: "test content".to_string(),
    });

    assert!(result.is_ok());
    assert!(file_path.exists());
    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "test content");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_file_creates_parent_dirs() {
    let dir = home_test_dir("write_file_nested");
    let _ = fs::remove_dir_all(&dir);

    let file_path = dir.join("subdir").join("nested").join("file.txt");
    let result = write_file(WriteFileRequest {
        path: file_path.to_string_lossy().to_string(),
        content: "nested content".to_string(),
    });

    assert!(result.is_ok());
    assert!(file_path.exists());
    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "nested content");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_file_rejects_path_outside_home() {
    let result = write_file(WriteFileRequest {
        path: "/etc/test_forbidden.txt".to_string(),
        content: "forbidden".to_string(),
    });
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("access denied"));
}

#[test]
fn write_file_rejects_traversal_into_sibling_of_home() {
    // A path like `~/../etc/evil.txt` must be rejected WITHOUT creating
    // any directories on disk (the P1 fix) — the previous implementation
    // ran `create_dir_all` before canonicalizing, which could mutate the
    // filesystem outside the home scope.
    let home = dirs::home_dir().expect("HOME must be set for tests");
    let home_parent = home
        .parent()
        .expect("home dir should have a parent in tests");

    // Forge a path that escapes home via `..`
    let evil = home.join("..").join(".vimeflow_traversal_test").join("evil.txt");
    let marker = home_parent.join(".vimeflow_traversal_test");
    let _ = fs::remove_dir_all(&marker);

    let result = write_file(WriteFileRequest {
        path: evil.to_string_lossy().to_string(),
        content: "should be rejected".to_string(),
    });

    assert!(result.is_err(), "traversal path must be rejected");
    assert!(result.unwrap_err().contains("access denied"));

    // Crucial: verify that NO directory was created outside home.
    assert!(
        !marker.exists(),
        "traversal fix must not create directories outside home: {}",
        marker.display()
    );
}

#[cfg(unix)]
#[test]
fn write_file_refuses_to_follow_symlink_escaping_home() {
    // A symlink inside home pointing outside home must not let `fs::write`
    // escape the sandbox. The previous implementation only canonicalized
    // the parent directory, so `fs::write` would follow the target
    // symlink and mutate files anywhere on disk the process could reach.
    use std::os::unix::fs::symlink;

    let dir = home_test_dir("write_file_symlink_escape");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    // The symlink target is a path outside home. We never want to touch it.
    let outside_target = std::env::temp_dir().join(
        ".vimeflow_write_file_symlink_escape_target.txt",
    );
    let _ = fs::remove_file(&outside_target);

    let link = dir.join("evil_link");
    // evil_link -> /tmp/.vimeflow_write_file_symlink_escape_target.txt
    symlink(&outside_target, &link).unwrap();

    let result = write_file(WriteFileRequest {
        path: link.to_string_lossy().to_string(),
        content: "should not escape".to_string(),
    });

    assert!(result.is_err(), "symlink write must be rejected");
    assert!(result.unwrap_err().contains("access denied"));

    // Crucial: verify nothing was written outside home.
    assert!(
        !outside_target.exists(),
        "symlink guard must not write outside home: {}",
        outside_target.display()
    );

    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn write_file_refuses_intermediate_symlink_escape() {
    // Cover the TOCTOU class where an INTERMEDIATE path component is
    // swapped for a symlink pointing outside home. O_NOFOLLOW on the
    // final open() only guards the last segment, so this must be
    // caught by re-canonicalizing the parent after create_dir_all.
    use std::os::unix::fs::symlink;

    let dir = home_test_dir("write_file_intermediate_symlink");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    // Pre-plant a symlink at an "intermediate" directory that points
    // outside home. The target path uses this link as a parent.
    let outside = std::env::temp_dir().join(".vimeflow_intermediate_escape");
    let _ = fs::remove_dir_all(&outside);
    fs::create_dir_all(&outside).unwrap();

    let link = dir.join("escape_link");
    symlink(&outside, &link).unwrap();

    // raw path: dir/escape_link/file.txt
    //   - walk-up check: dir/escape_link exists → canonicalize resolves
    //     it to the outside path → starts_with(home) fails → rejected.
    let evil = link.join("file.txt");

    let result = write_file(WriteFileRequest {
        path: evil.to_string_lossy().to_string(),
        content: "should not escape".to_string(),
    });

    assert!(result.is_err(), "intermediate symlink write must be rejected");
    assert!(result.unwrap_err().contains("access denied"));

    // Confirm the attacker target is untouched.
    assert!(
        !outside.join("file.txt").exists(),
        "intermediate symlink guard must not write outside home"
    );

    let _ = fs::remove_dir_all(&outside);
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn write_file_refuses_symlink_even_to_in_home_target() {
    // Stricter: reject *any* symlink at the target position, even ones
    // pointing inside home. This closes the TOCTOU window where a symlink
    // could be swapped between our check and the write.
    use std::os::unix::fs::symlink;

    let dir = home_test_dir("write_file_symlink_inner");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let real_target = dir.join("real.txt");
    fs::write(&real_target, "original").unwrap();

    let link = dir.join("link.txt");
    symlink(&real_target, &link).unwrap();

    let result = write_file(WriteFileRequest {
        path: link.to_string_lossy().to_string(),
        content: "nope".to_string(),
    });

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("symlink"));

    // Real target should be untouched.
    assert_eq!(fs::read_to_string(&real_target).unwrap(), "original");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_file_overwrites_existing() {
    let dir = home_test_dir("write_file_overwrite");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let file_path = dir.join("overwrite.txt");
    fs::write(&file_path, "original").unwrap();

    let result = write_file(WriteFileRequest {
        path: file_path.to_string_lossy().to_string(),
        content: "updated".to_string(),
    });

    assert!(result.is_ok());
    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "updated");

    let _ = fs::remove_dir_all(&dir);
}
```

### Step 5: Update `filesystem/mod.rs`

- [ ] **Step 5: Add `mod tests;` declaration to `src-tauri/src/filesystem/mod.rs`**

Replace the entire file with:

```rust
mod commands;
mod types;

pub use commands::{list_dir, read_file, write_file};

#[cfg(test)]
mod tests;
```

### Step 6: Delete the `#[cfg(test)]` block from `commands.rs`

- [ ] **Step 6: Remove lines 490-864 from `src-tauri/src/filesystem/commands.rs`**

Delete exactly these lines (the `#[cfg(test)] mod tests { ... }` block including its closing brace). The first deleted line is:

```rust
#[cfg(test)]
```

The last deleted line is the closing `}` of `mod tests`. After the edit, the file should end at line 488 with `    Ok(())\n}\n` (the closing of `write_file`).

Use the Edit tool to remove the block. The `old_string` should be the full content from line 490 (`\n#[cfg(test)]`) to the end of the file; the `new_string` should be empty (or a single trailing newline).

Verify with:

```bash
wc -l src-tauri/src/filesystem/commands.rs
```

Expected: `489 src-tauri/src/filesystem/commands.rs` (or very close — 488-490 depending on trailing newline handling).

### Step 7: Run tests — verify count and names unchanged

- [ ] **Step 7: `cargo test` shows 15 tests, all passing, under new module paths**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: 2>&1 | tail -5
```

Expected:

```
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

Then verify each test function name still exists (the module path changed from `commands::tests::` to `tests::{list,read,write}_tests::`):

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: -- --list 2>&1 | grep ": test" | sort
```

Expected 15 lines (module paths will be the NEW ones):

```
filesystem::tests::list_tests::list_dir_rejects_nonexistent_path: test
filesystem::tests::list_tests::list_dir_returns_sorted_entries: test
filesystem::tests::list_tests::list_dir_skips_hidden_files: test
filesystem::tests::read_tests::read_file_refuses_to_follow_symlink_escaping_home: test
filesystem::tests::read_tests::read_file_rejects_directory: test
filesystem::tests::read_tests::read_file_rejects_path_outside_home: test
filesystem::tests::read_tests::read_file_returns_content: test
filesystem::tests::write_tests::write_file_creates_file: test
filesystem::tests::write_tests::write_file_creates_parent_dirs: test
filesystem::tests::write_tests::write_file_overwrites_existing: test
filesystem::tests::write_tests::write_file_refuses_intermediate_symlink_escape: test
filesystem::tests::write_tests::write_file_refuses_symlink_even_to_in_home_target: test
filesystem::tests::write_tests::write_file_refuses_to_follow_symlink_escaping_home: test
filesystem::tests::write_tests::write_file_rejects_path_outside_home: test
filesystem::tests::write_tests::write_file_rejects_traversal_into_sibling_of_home: test
```

**CRITICAL:** The final segment (the test function name) of every line must match a line from Task 0 Step 3's baseline. If any name is missing, renamed, or duplicated, STOP and investigate — we have silently dropped or renamed a regression guard.

### Step 8: Run clippy and fmt

- [ ] **Step 8: `cargo clippy` and `cargo fmt` pass**

Run:

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --package vimeflow --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Both should exit with code 0 and no output of concern. If `fmt --check` complains about the new files, run `cargo fmt --manifest-path src-tauri/Cargo.toml` to apply formatting, then re-run the check.

### Step 9: Commit

- [ ] **Step 9: `git commit` with test-count in the message body**

```bash
git add src-tauri/src/filesystem/mod.rs \
        src-tauri/src/filesystem/commands.rs \
        src-tauri/src/filesystem/tests/

git commit -m "$(cat <<'EOF'
refactor(filesystem): extract tests into tests/ sub-module (#40)

Move the #[cfg(test)] mod tests { ... } block out of commands.rs into
a new filesystem/tests/ sub-module with one file per command:
  - tests/mod.rs     — shared home_test_dir helper + re-exports
  - tests/list_tests.rs  — 3 list_dir tests
  - tests/read_tests.rs  — 4 read_file tests
  - tests/write_tests.rs — 8 write_file tests

Production code in commands.rs is unchanged. This drops commands.rs
from 864 → ~489 lines, getting the file back under the 800-line
CLAUDE.md guideline.

Test count: 15 before, 15 after. All regression tests from PR #38
pass under the new module paths.
EOF
)"
```

Expected: commit succeeds and husky hooks pass. If a pre-commit hook complains, fix the underlying issue (do NOT `--no-verify`).

- [ ] **Step 10: Verify commit landed on the feature branch**

```bash
git log --oneline -3
git branch --show-current
```

Expected:

- Branch: `refactor/filesystem-module-split`
- Latest commit: the one just created
- Previous commit: `91365fa docs: filesystem module refactor design (#40)`

---

## Task 2: Commit 2 — Extract `scope.rs` Helpers

**Goal:** Pull the shared sandbox primitives (`expand_home`, `reject_parent_refs`, `canonicalize_within_home`, `ensure_within_home`, `open_nofollow`, plus a `home_canonical` helper) out of `commands.rs` into a new `scope.rs` file. `commands.rs` becomes a thin caller of these helpers. No behavior change. All 15 tests still pass. Also add 3 new unit tests for the scope helpers directly.

**Files:**

- Create: `src-tauri/src/filesystem/scope.rs`
- Create: `src-tauri/src/filesystem/tests/scope_tests.rs`
- Modify: `src-tauri/src/filesystem/mod.rs` (add `mod scope;`)
- Modify: `src-tauri/src/filesystem/tests/mod.rs` (add `mod scope_tests;` + re-exports for scope helpers)
- Modify: `src-tauri/src/filesystem/commands.rs` (rewrite `list_dir`, `read_file`, `write_file` to call scope helpers)

### Step 1: Create `scope.rs`

- [ ] **Step 1: Write `src-tauri/src/filesystem/scope.rs`**

Create the file with this exact content. This consolidates all the inline sandbox logic from `commands.rs` into named helpers with the same behavior.

```rust
//! Filesystem sandbox primitives.
//!
//! These helpers enforce the `$HOME`-rooted sandbox boundary for all
//! Tauri filesystem IPC commands. They are the single source of truth
//! for symlink refusal, canonicalization, and scope checks.
//!
//! **Do not inline these checks in command modules.** Every sandbox
//! primitive lives here so that `list.rs`, `read.rs`, and `write.rs`
//! cannot silently diverge. See `SECURITY.md` in this directory
//! for the full threat model and a map of each primitive to the
//! review findings it prevents.

use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};

/// Expand `~` to the user's home directory.
///
/// Returns the input unchanged if it does not start with `~`, or if the
/// home directory cannot be determined (in which case downstream checks
/// will reject the path anyway).
pub(super) fn expand_home(path: &str) -> PathBuf {
    if path == "~" || path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            if path == "~" {
                return home;
            }
            return home.join(&path[2..]);
        }
    }
    PathBuf::from(path)
}

/// Resolve the canonical home directory.
///
/// Failure here means we cannot enforce the sandbox at all, so every
/// caller treats it as a fatal `access denied`.
pub(super) fn home_canonical() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot determine home directory".to_string())?;
    fs::canonicalize(&home).map_err(|e| format!("cannot resolve home dir: {}", e))
}

/// Reject any `..` component in a path.
///
/// Called before any filesystem mutation so a forged path like
/// `~/../etc/evil.txt` cannot trigger `create_dir_all` or any other
/// side effect outside of home. Legitimate UI paths are built from
/// the current working directory plus a basename, so `..` is always
/// suspicious and blocking it sidesteps the subtle interaction between
/// lexical `Path::parent()` walks and OS-level `..` resolution.
pub(super) fn reject_parent_refs(path: &Path) -> Result<(), String> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!(
            "access denied: path contains parent traversal segments: {}",
            path.display()
        ));
    }
    Ok(())
}

/// Verify that a canonical path is under the canonical home directory.
///
/// The caller is responsible for canonicalizing first; this helper only
/// performs the `starts_with` check.
pub(super) fn ensure_within_home(canonical: &Path, home_canonical: &Path) -> Result<(), String> {
    if !canonical.starts_with(home_canonical) {
        return Err(format!(
            "access denied: path is outside home directory: {}",
            canonical.display()
        ));
    }
    Ok(())
}

/// Walk up `parent` until we find an existing ancestor, canonicalize it,
/// verify it's inside home, then re-anchor the unresolved tail onto the
/// canonical ancestor. Finally, create missing segments ONE AT A TIME,
/// canonicalizing after each step — this caps the blast radius of a
/// racing symlink at one stray empty directory per call.
///
/// Returns the canonical `PathBuf` of the resolved parent. Guaranteed
/// to be inside `home_canonical` on success.
///
/// # Why per-segment mkdir?
///
/// `create_dir_all` in a single shot would leave a TOCTOU window where
/// a concurrent process creates a symlink at an intermediate
/// not-yet-existing component and redirects subsequent segments outside
/// home. Even if the eventual write is blocked by the final scope
/// re-check plus `O_NOFOLLOW`, `create_dir_all` itself would have
/// already created empty directories outside the sandbox along the way.
///
/// Walking the segments one at a time and canonicalizing after each
/// `create_dir` means the first out-of-scope segment is detected
/// immediately, before any further creations happen — at worst one
/// stray empty dir can be created per call. Full mitigation would need
/// `openat(2)` with `O_NOFOLLOW` per component, but that is a larger
/// refactor; this approach closes the practical window for the
/// single-user desktop threat model.
///
/// # Why swallow `AlreadyExists`?
///
/// `exists()` + `create_dir` is not atomic: a concurrent process could
/// create the same directory in the gap. The `AlreadyExists` case is
/// benign — the directory we wanted to create is already there — so we
/// swallow it and let the subsequent canonicalize + scope check verify
/// the final state is still inside home. Any OTHER error is fatal.
/// Do not "clean up" this match arm into a `?` operator.
pub(super) fn canonicalize_within_home(
    parent: &Path,
    home_canonical: &Path,
) -> Result<PathBuf, String> {
    let mut ancestor = parent;
    let existing_ancestor = loop {
        if ancestor.exists() {
            break ancestor;
        }
        match ancestor.parent() {
            Some(next) => ancestor = next,
            None => {
                return Err(format!(
                    "access denied: path has no existing ancestor under home: {}",
                    parent.display()
                ));
            }
        }
    };

    let ancestor_canonical = fs::canonicalize(existing_ancestor)
        .map_err(|e| format!("invalid ancestor path '{}': {}", parent.display(), e))?;

    ensure_within_home(&ancestor_canonical, home_canonical)?;

    let relative_tail = parent.strip_prefix(existing_ancestor).map_err(|_| {
        format!(
            "invalid path: cannot rebase '{}' onto '{}'",
            parent.display(),
            existing_ancestor.display()
        )
    })?;

    let mut resolved_parent = ancestor_canonical.clone();
    for segment in relative_tail.components() {
        let next = resolved_parent.join(segment);
        if !next.exists() {
            match fs::create_dir(&next) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                Err(e) => {
                    return Err(format!(
                        "failed to create directory '{}': {}",
                        next.display(),
                        e
                    ));
                }
            }
        }
        let next_canonical = fs::canonicalize(&next)
            .map_err(|e| format!("failed to canonicalize '{}': {}", next.display(), e))?;
        ensure_within_home(&next_canonical, home_canonical)?;
        resolved_parent = next_canonical;
    }

    // Belt-and-braces final check in case the loop didn't run (no tail segments)
    ensure_within_home(&resolved_parent, home_canonical)?;

    Ok(resolved_parent)
}

/// Open a file with kernel-level refusal to follow symlinks on the leaf.
///
/// - **Unix:** `O_NOFOLLOW` makes `open(2)` return `ELOOP` if the final
///   component is a symlink. Atomic refusal, no TOCTOU window.
/// - **Windows:** `FILE_FLAG_OPEN_REPARSE_POINT` opens the reparse point
///   itself rather than following it. We then post-check the handle's
///   file type and reject if we landed on a symlink, giving the same
///   end-state as the Unix `ELOOP` path.
///
/// The caller supplies `options` pre-configured with read/write/create
/// as needed; this function only adds the symlink-refusal flags and
/// the Windows post-open metadata check. Keep all `cfg(unix)` and
/// `cfg(windows)` arms for this behavior in this single function — if
/// they ever drift across files, the Windows post-open check gets
/// silently skipped (this is exactly how finding #9 in the review
/// knowledge base slipped through the first time).
pub(super) fn open_nofollow(path: &Path, mut options: OpenOptions) -> Result<File, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x00200000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }

    let file = options
        .open(path)
        .map_err(|e| format!("failed to open '{}': {}", path.display(), e))?;

    #[cfg(windows)]
    {
        let metadata = file
            .metadata()
            .map_err(|e| format!("failed to stat '{}': {}", path.display(), e))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "access denied: refusing to operate through symlink: {}",
                path.display()
            ));
        }
    }

    Ok(file)
}
```

### Step 2: Declare `mod scope;` in `filesystem/mod.rs`

- [ ] **Step 2: Update `src-tauri/src/filesystem/mod.rs`**

Replace the entire file with:

```rust
mod commands;
mod scope;
mod types;

pub use commands::{list_dir, read_file, write_file};

#[cfg(test)]
mod tests;
```

### Step 3: Rewrite `list_dir` in `commands.rs` to call scope helpers

- [ ] **Step 3: Replace the `list_dir` function in `commands.rs`**

Use the Edit tool to replace the current `list_dir` (lines 25-89 in the original file) with the version below. The `expand_home` fn at lines 12-23 should also be deleted in Step 6 below (it now lives in `scope.rs`) — for now just leave it and rely on the new import.

First, add this import near the top of `commands.rs` (replace the existing `use super::types::*;` line):

```rust
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use super::scope::{
    canonicalize_within_home, ensure_within_home, expand_home, home_canonical, open_nofollow,
    reject_parent_refs,
};
use super::types::*;
```

Then replace the `list_dir` function with:

```rust
/// List directory contents (single level, sorted: folders first then files).
/// Restricted to the user's home directory to prevent arbitrary filesystem enumeration.
#[tauri::command]
pub fn list_dir(request: ListDirRequest) -> Result<Vec<FileEntry>, String> {
    let raw = expand_home(&request.path);
    let canonical = fs::canonicalize(&raw)
        .map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    if !canonical.is_dir() {
        return Err(format!("not a directory: {}", canonical.display()));
    }

    let home_canonical = home_canonical()?;
    ensure_within_home(&canonical, &home_canonical)?;

    log::info!("Listing directory: {}", canonical.display());

    let mut folders: Vec<FileEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    let entries = fs::read_dir(&canonical)
        .map_err(|e| format!("failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/folders
        if name.starts_with('.') {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to get file type: {}", e))?;

        if file_type.is_dir() {
            folders.push(FileEntry {
                name,
                entry_type: EntryType::Folder,
                children: None,
            });
        } else if file_type.is_file() {
            files.push(FileEntry {
                name,
                entry_type: EntryType::File,
                children: None,
            });
        }
    }

    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    folders.append(&mut files);

    Ok(folders)
}
```

### Step 4: Rewrite `read_file` in `commands.rs`

- [ ] **Step 4: Replace the `read_file` function in `commands.rs`**

Replace with:

```rust
/// Read file contents as UTF-8 string.
/// Restricted to the user's home directory.
///
/// Uses `scope::open_nofollow` to close the TOCTOU window between the
/// canonical scope check and the actual open: without `O_NOFOLLOW` a
/// concurrent unlink+symlink race could swap the validated file for a
/// symlink pointing outside home, and `fs::read_to_string` would happily
/// follow it and leak the contents back to the webview.
#[tauri::command]
pub fn read_file(request: ReadFileRequest) -> Result<String, String> {
    let raw = expand_home(&request.path);
    let canonical =
        fs::canonicalize(&raw).map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    let home_canonical = home_canonical()?;
    ensure_within_home(&canonical, &home_canonical)?;

    if !canonical.is_file() {
        return Err(format!("not a file: {}", canonical.display()));
    }

    log::info!("Reading file: {}", canonical.display());

    use std::io::Read;
    let mut options = fs::OpenOptions::new();
    options.read(true);

    let mut file = open_nofollow(&canonical, options)?;

    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("failed to read file '{}': {}", canonical.display(), e))?;

    Ok(content)
}
```

### Step 5: Rewrite `write_file` in `commands.rs`

- [ ] **Step 5: Replace the `write_file` function in `commands.rs`**

Replace with:

```rust
/// Per-process monotonic counter for write_file temp-file names. Ensures
/// concurrent saves to the same target don't collide on `create_new(true)`
/// (which would fail with EEXIST even though both calls are legitimate).
/// See finding #14 in `docs/reviews/patterns/filesystem-scope.md`.
static WRITE_FILE_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write content to a file.
/// Restricted to the user's home directory. Creates parent directories if needed.
///
/// Scope enforcement happens **before** any filesystem mutation so a
/// malicious path (e.g. `~/../etc/evil.txt`) cannot trigger `create_dir_all`
/// outside of home even when the parent path doesn't exist yet. The final
/// write uses an atomic temp-file + rename pattern so a mid-write failure
/// cannot leave the target at zero length.
#[tauri::command]
pub fn write_file(request: WriteFileRequest) -> Result<(), String> {
    let raw = expand_home(&request.path);

    reject_parent_refs(&raw)?;

    // Require an absolute path once `~` has been expanded. A relative input
    // would otherwise be resolved against the process cwd, which is not
    // necessarily inside home.
    if !raw.is_absolute() {
        return Err(format!(
            "access denied: path must be absolute or ~-relative: {}",
            raw.display()
        ));
    }

    let parent = raw
        .parent()
        .ok_or_else(|| "invalid path: no parent directory".to_string())?;

    let home_canonical = home_canonical()?;
    let resolved_parent = canonicalize_within_home(parent, &home_canonical)?;

    let file_name = raw
        .file_name()
        .ok_or_else(|| format!("invalid path: no file name in '{}'", raw.display()))?;
    let target = resolved_parent.join(file_name);

    // Final-path symlink guard. `fs::write` follows symlinks by default, so
    // even with the parent directory validated, a symlink at the target
    // position (e.g. `~/evil_link -> /etc/passwd`) would let the write
    // escape the home sandbox. Reject any symlink at the target outright —
    // regardless of where it points — to close the TOCTOU window.
    //
    // Using `symlink_metadata` means we don't follow the link; `metadata()`
    // / `exists()` would return info about the link target, not the link.
    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "access denied: refusing to write through symlink: {}",
                    target.display()
                ));
            }

            // If the target exists as a regular file, canonicalize it (which
            // resolves any symlinks in its full path — including the parent
            // chain we already validated) and verify it's still inside home.
            // This matches the pattern used by `read_file`.
            let target_canonical = fs::canonicalize(&target).map_err(|e| {
                format!("failed to canonicalize target '{}': {}", target.display(), e)
            })?;
            ensure_within_home(&target_canonical, &home_canonical)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // New file — nothing to follow, parent directory is already
            // validated against the canonical home root.
        }
        Err(e) => {
            return Err(format!(
                "failed to stat target '{}': {}",
                target.display(),
                e
            ));
        }
    }

    log::info!("Writing file: {}", target.display());

    // Atomic write via temp file + rename. See finding #13 in the review
    // knowledge base. `OpenOptions::truncate(true)` would zero the target
    // the moment `open()` returns, before any bytes are written — silent
    // data loss if `write_all` fails. The atomic rename pattern keeps the
    // target untouched until the temp file is fully written and synced.
    use std::io::Write;

    // Per-process atomic counter ensures concurrent saves don't collide on
    // `create_new(true)`. See finding #14.
    let tmp_counter = WRITE_FILE_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(
        ".{}.vimeflow.tmp.{}.{}",
        file_name.to_string_lossy(),
        std::process::id(),
        tmp_counter
    );
    let tmp_path = resolved_parent.join(&tmp_name);

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);

    let write_to_temp = || -> Result<(), String> {
        let mut tmp_file = open_nofollow(&tmp_path, options)?;

        tmp_file
            .write_all(request.content.as_bytes())
            .map_err(|e| {
                format!(
                    "failed to write temp file '{}': {}",
                    tmp_path.display(),
                    e
                )
            })?;

        // `sync_all` before rename so the replacement file is durable on
        // disk even if the machine crashes immediately after rename.
        tmp_file.sync_all().map_err(|e| {
            format!("failed to sync temp file '{}': {}", tmp_path.display(), e)
        })?;

        Ok(())
    };

    if let Err(e) = write_to_temp() {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }

    // Atomic rename onto the target. On failure, clean up the temp file
    // so we don't leave droppings in the user's directory.
    if let Err(e) = fs::rename(&tmp_path, &target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "failed to rename '{}' -> '{}': {}",
            tmp_path.display(),
            target.display(),
            e
        ));
    }

    Ok(())
}
```

**Note on `options` move semantics:** `OpenOptions` is `Clone`, but `open_nofollow` takes `options` by value (since it calls `.custom_flags(...).open(...)` which needs `&mut`). The closure `write_to_temp` captures `options` by move. This works because the closure is `FnOnce` (called exactly once in the `if let Err` chain). If clippy complains about `options` being moved, wrap it in `options.clone()` at the call site.

### Step 6: Delete the now-redundant `expand_home` function from `commands.rs`

- [ ] **Step 6: Remove the stale `expand_home` definition from `commands.rs`**

The file started with a local `expand_home` at lines 12-23 (in the original file). Now that `commands.rs` imports `expand_home` from `scope`, the local definition conflicts and must be deleted. Use the Edit tool to remove exactly these lines:

```rust
/// Expand ~ to home directory
fn expand_home(path: &str) -> PathBuf {
    if path == "~" || path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            if path == "~" {
                return home;
            }
            return home.join(&path[2..]);
        }
    }
    PathBuf::from(path)
}
```

Also remove the now-redundant top-of-file comment block about `WRITE_FILE_TMP_COUNTER` if it is duplicated (the doc comment was moved into the new `write_file` function body in Step 5).

After this edit, `commands.rs` should not have `fn expand_home` at the top level — only the three `#[tauri::command]` functions (plus the `WRITE_FILE_TMP_COUNTER` static).

### Step 7: Create `tests/scope_tests.rs` with 3 new unit tests

- [ ] **Step 7: Write `src-tauri/src/filesystem/tests/scope_tests.rs`**

These tests exercise the scope helpers directly, providing unit-level coverage alongside the existing command-level regression tests.

```rust
use super::*;
use std::fs;
use std::path::PathBuf;

#[test]
fn rejects_parent_refs_basic() {
    // Direct unit test of scope::reject_parent_refs. Covers finding #4
    // (traversal rejected before any filesystem mutation).
    let with_parent = PathBuf::from("/home/user/../etc/evil");
    let result = reject_parent_refs_helper(&with_parent);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("parent traversal"));

    let clean = PathBuf::from("/home/user/docs/file.txt");
    assert!(reject_parent_refs_helper(&clean).is_ok());
}

#[test]
fn canonicalize_within_home_resolves_nested_nonexistent() {
    // Happy path: the parent doesn't exist yet, canonicalize_within_home
    // walks up to find an existing ancestor, canonicalizes it, and
    // re-anchors the tail. The result is a canonical path inside home.
    let dir = home_test_dir("scope_canon_happy");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let nested = dir.join("a").join("b").join("c");
    let home_canon = fs::canonicalize(dirs::home_dir().unwrap()).unwrap();
    let result = canonicalize_within_home_helper(&nested, &home_canon);

    assert!(result.is_ok(), "happy path should succeed: {:?}", result.err());
    let resolved = result.unwrap();
    assert!(resolved.starts_with(&home_canon));
    assert!(resolved.exists(), "segments should have been created");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn canonicalize_within_home_rejects_escape() {
    // If the parent resolves outside home, canonicalize_within_home
    // must reject WITHOUT creating any directories. Covers findings
    // #10 and #11 at the unit level.
    let outside = std::env::temp_dir().join(".vimeflow_scope_escape_unit");
    let _ = fs::remove_dir_all(&outside);

    let home_canon = fs::canonicalize(dirs::home_dir().unwrap()).unwrap();
    let result = canonicalize_within_home_helper(&outside, &home_canon);

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("access denied"));
    assert!(
        !outside.exists(),
        "escape rejection must not create directories: {}",
        outside.display()
    );
}

// Thin wrappers that let this test module call the private scope helpers
// via the tests/mod.rs re-exports.
fn reject_parent_refs_helper(path: &std::path::Path) -> Result<(), String> {
    scope_reject_parent_refs(path)
}

fn canonicalize_within_home_helper(
    parent: &std::path::Path,
    home_canonical: &std::path::Path,
) -> Result<PathBuf, String> {
    scope_canonicalize_within_home(parent, home_canonical)
}
```

### Step 8: Update `tests/mod.rs` to re-export scope helpers and declare `scope_tests`

- [ ] **Step 8: Update `src-tauri/src/filesystem/tests/mod.rs`**

Replace the file with:

```rust
//! Test module for filesystem IPC commands.
//!
//! Tests are split by command (`list_tests`, `read_tests`, `write_tests`)
//! plus unit tests for the sandbox primitives (`scope_tests`). Shared
//! helpers live here and are re-exported to child modules via
//! `use super::*;`.
//!
//! The 15 command-level tests in this tree plus the 3 scope unit tests
//! are the regression safety net for the 14 security findings catalogued
//! in `docs/reviews/patterns/filesystem-scope.md`. If you're renaming a
//! test, update the map in `src-tauri/src/filesystem/SECURITY.md`
//! (once added in Task 4).

#![cfg(test)]

use std::path::PathBuf;

// Re-export command items under test
pub(super) use super::commands::{list_dir, read_file, write_file};
pub(super) use super::types::{
    EntryType, ListDirRequest, ReadFileRequest, WriteFileRequest,
};

// Re-export scope helpers for unit tests. Aliased with `scope_` prefix
// so they don't collide with any command-level item also named the same.
pub(super) use super::scope::canonicalize_within_home as scope_canonicalize_within_home;
pub(super) use super::scope::reject_parent_refs as scope_reject_parent_refs;

/// Create a temp dir under $HOME so it passes the home-directory scope check.
/// Tests using `/tmp` would fail the sandbox check (see finding #3 in
/// `docs/reviews/patterns/filesystem-scope.md`).
pub(super) fn home_test_dir(name: &str) -> PathBuf {
    dirs::home_dir()
        .expect("HOME must be set for tests")
        .join(format!(".vimeflow_test_{}", name))
}

mod list_tests;
mod read_tests;
mod scope_tests;
mod write_tests;
```

### Step 9: Run tests — verify 18 total (15 command + 3 scope), all passing

- [ ] **Step 9: `cargo test` shows 18 tests, all passing**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: 2>&1 | tail -5
```

Expected:

```
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

Then verify every ORIGINAL 15 test name from Task 0 Step 3's baseline is still present:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: -- --list 2>&1 | grep ": test" | sort
```

Expected: 18 lines total. The 15 command tests from Task 1 plus:

```
filesystem::tests::scope_tests::canonicalize_within_home_rejects_escape: test
filesystem::tests::scope_tests::canonicalize_within_home_resolves_nested_nonexistent: test
filesystem::tests::scope_tests::rejects_parent_refs_basic: test
```

**CRITICAL:** If any of the 15 original command-test final segments is missing from this list, STOP. The scope extraction has silently regressed behavior — the command-level test should still pass because `commands.rs` now calls the same (extracted) logic. A missing test means something in the rewrite of `list_dir` / `read_file` / `write_file` was subtly broken. Investigate with `cargo test filesystem:: --nocapture` to see which test fails.

### Step 10: Run clippy and fmt

- [ ] **Step 10: `cargo clippy` and `cargo fmt` pass**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --package vimeflow --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Both must exit 0. If clippy complains about the `OpenOptions` ownership pattern in `open_nofollow` or `write_to_temp`, address it with `.clone()` at the call site (not by changing the helper's signature — it takes ownership deliberately to allow `custom_flags` mutation).

### Step 11: Manual smoke test

- [ ] **Step 11: `npm run dev` smoke test**

Per the spec's verification requirements, verify the three user-visible code paths still work:

```bash
npm run dev
```

In a second terminal (or Tauri devtools), manually verify:

1. File explorer lists files from `$HOME`
2. Clicking a file opens it in the editor (exercises `read_file`)
3. Saving the editor writes it back (exercises `write_file`)

Stop the dev server (`Ctrl+C`) when done. **This is the only manual step in the plan — do not skip it.** The regression tests are thorough but cannot catch IPC serialization mismatches if the request/response types changed.

### Step 12: Commit

- [ ] **Step 12: `git commit` with scope extraction**

```bash
git add src-tauri/src/filesystem/mod.rs \
        src-tauri/src/filesystem/scope.rs \
        src-tauri/src/filesystem/commands.rs \
        src-tauri/src/filesystem/tests/mod.rs \
        src-tauri/src/filesystem/tests/scope_tests.rs

git commit -m "$(cat <<'EOF'
refactor(filesystem): extract sandbox primitives into scope.rs (#40)

Pull the inline sandbox logic from commands.rs into a new scope.rs
module that is the single source of truth for:
  - expand_home        — ~ expansion
  - home_canonical     — canonical $HOME resolution
  - reject_parent_refs — lexical .. rejection
  - ensure_within_home — $HOME containment check
  - canonicalize_within_home — walk-up + per-segment mkdir loop
  - open_nofollow      — unified O_NOFOLLOW / reparse-point open

commands.rs now calls these helpers instead of inlining the checks.
list_dir, read_file, and write_file become thin orchestrators. The
Windows post-open metadata check lives inside open_nofollow so
read.rs and write.rs cannot silently diverge again (see finding #9
in docs/reviews/patterns/filesystem-scope.md).

Adds 3 unit tests in tests/scope_tests.rs covering the scope
helpers directly at the unit level, complementing the existing
15 command-level regression tests.

Test count: 15 → 18. All 14 review findings in
docs/reviews/patterns/filesystem-scope.md remain guarded.
EOF
)"
```

---

## Task 3: Commit 3 — Split `commands.rs` into `list.rs` / `read.rs` / `write.rs`

**Goal:** Move each `#[tauri::command]` handler into its own file. `commands.rs` is deleted. `mod.rs` re-exports the same three public names, so `src-tauri/src/lib.rs` sees no change. All 18 tests still pass.

**Files:**

- Create: `src-tauri/src/filesystem/list.rs`
- Create: `src-tauri/src/filesystem/read.rs`
- Create: `src-tauri/src/filesystem/write.rs`
- Delete: `src-tauri/src/filesystem/commands.rs`
- Modify: `src-tauri/src/filesystem/mod.rs` (replace `mod commands;` with three new module declarations, update re-exports)
- Modify: `src-tauri/src/filesystem/tests/mod.rs` (update re-exports to point at the new modules)

### Step 1: Create `list.rs`

- [ ] **Step 1: Write `src-tauri/src/filesystem/list.rs`**

Copy the current `list_dir` function (and its imports) out of `commands.rs`. Exact content:

```rust
use std::fs;

use super::scope::{ensure_within_home, expand_home, home_canonical};
use super::types::{EntryType, FileEntry, ListDirRequest};

/// List directory contents (single level, sorted: folders first then files).
/// Restricted to the user's home directory to prevent arbitrary filesystem enumeration.
#[tauri::command]
pub fn list_dir(request: ListDirRequest) -> Result<Vec<FileEntry>, String> {
    let raw = expand_home(&request.path);
    let canonical = fs::canonicalize(&raw)
        .map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    if !canonical.is_dir() {
        return Err(format!("not a directory: {}", canonical.display()));
    }

    let home_canonical = home_canonical()?;
    ensure_within_home(&canonical, &home_canonical)?;

    log::info!("Listing directory: {}", canonical.display());

    let mut folders: Vec<FileEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    let entries = fs::read_dir(&canonical)
        .map_err(|e| format!("failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/folders
        if name.starts_with('.') {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to get file type: {}", e))?;

        if file_type.is_dir() {
            folders.push(FileEntry {
                name,
                entry_type: EntryType::Folder,
                children: None,
            });
        } else if file_type.is_file() {
            files.push(FileEntry {
                name,
                entry_type: EntryType::File,
                children: None,
            });
        }
    }

    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    folders.append(&mut files);

    Ok(folders)
}
```

### Step 2: Create `read.rs`

- [ ] **Step 2: Write `src-tauri/src/filesystem/read.rs`**

```rust
use std::fs;

use super::scope::{ensure_within_home, expand_home, home_canonical, open_nofollow};
use super::types::ReadFileRequest;

/// Read file contents as UTF-8 string.
/// Restricted to the user's home directory.
///
/// Uses `scope::open_nofollow` to close the TOCTOU window between the
/// canonical scope check and the actual open: without `O_NOFOLLOW` a
/// concurrent unlink+symlink race could swap the validated file for a
/// symlink pointing outside home, and `fs::read_to_string` would happily
/// follow it and leak the contents back to the webview.
#[tauri::command]
pub fn read_file(request: ReadFileRequest) -> Result<String, String> {
    let raw = expand_home(&request.path);
    let canonical =
        fs::canonicalize(&raw).map_err(|e| format!("invalid path '{}': {}", request.path, e))?;

    let home_canonical = home_canonical()?;
    ensure_within_home(&canonical, &home_canonical)?;

    if !canonical.is_file() {
        return Err(format!("not a file: {}", canonical.display()));
    }

    log::info!("Reading file: {}", canonical.display());

    use std::io::Read;
    let mut options = fs::OpenOptions::new();
    options.read(true);

    let mut file = open_nofollow(&canonical, options)?;

    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("failed to read file '{}': {}", canonical.display(), e))?;

    Ok(content)
}
```

### Step 3: Create `write.rs`

- [ ] **Step 3: Write `src-tauri/src/filesystem/write.rs`**

```rust
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

use super::scope::{
    canonicalize_within_home, ensure_within_home, expand_home, home_canonical, open_nofollow,
    reject_parent_refs,
};
use super::types::WriteFileRequest;

/// Per-process monotonic counter for write_file temp-file names. Ensures
/// concurrent saves to the same target don't collide on `create_new(true)`
/// (which would fail with EEXIST even though both calls are legitimate).
/// See finding #14 in `docs/reviews/patterns/filesystem-scope.md`.
static WRITE_FILE_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write content to a file.
/// Restricted to the user's home directory. Creates parent directories if needed.
///
/// Scope enforcement happens **before** any filesystem mutation so a
/// malicious path (e.g. `~/../etc/evil.txt`) cannot trigger `create_dir_all`
/// outside of home even when the parent path doesn't exist yet. The final
/// write uses an atomic temp-file + rename pattern so a mid-write failure
/// cannot leave the target at zero length.
#[tauri::command]
pub fn write_file(request: WriteFileRequest) -> Result<(), String> {
    let raw = expand_home(&request.path);

    reject_parent_refs(&raw)?;

    if !raw.is_absolute() {
        return Err(format!(
            "access denied: path must be absolute or ~-relative: {}",
            raw.display()
        ));
    }

    let parent = raw
        .parent()
        .ok_or_else(|| "invalid path: no parent directory".to_string())?;

    let home_canonical = home_canonical()?;
    let resolved_parent = canonicalize_within_home(parent, &home_canonical)?;

    let file_name = raw
        .file_name()
        .ok_or_else(|| format!("invalid path: no file name in '{}'", raw.display()))?;
    let target = resolved_parent.join(file_name);

    // Final-path symlink guard. See findings #5 and #7 in the review
    // knowledge base.
    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "access denied: refusing to write through symlink: {}",
                    target.display()
                ));
            }

            let target_canonical = fs::canonicalize(&target).map_err(|e| {
                format!("failed to canonicalize target '{}': {}", target.display(), e)
            })?;
            ensure_within_home(&target_canonical, &home_canonical)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // New file — nothing to follow.
        }
        Err(e) => {
            return Err(format!(
                "failed to stat target '{}': {}",
                target.display(),
                e
            ));
        }
    }

    log::info!("Writing file: {}", target.display());

    // Atomic write via temp file + rename. See finding #13.
    use std::io::Write;

    // Per-process counter: see finding #14.
    let tmp_counter = WRITE_FILE_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(
        ".{}.vimeflow.tmp.{}.{}",
        file_name.to_string_lossy(),
        std::process::id(),
        tmp_counter
    );
    let tmp_path = resolved_parent.join(&tmp_name);

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);

    let write_to_temp = || -> Result<(), String> {
        let mut tmp_file = open_nofollow(&tmp_path, options)?;

        tmp_file
            .write_all(request.content.as_bytes())
            .map_err(|e| {
                format!(
                    "failed to write temp file '{}': {}",
                    tmp_path.display(),
                    e
                )
            })?;

        // `sync_all` before rename so the replacement file is durable on
        // disk even if the machine crashes immediately after rename.
        tmp_file.sync_all().map_err(|e| {
            format!("failed to sync temp file '{}': {}", tmp_path.display(), e)
        })?;

        Ok(())
    };

    if let Err(e) = write_to_temp() {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }

    if let Err(e) = fs::rename(&tmp_path, &target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "failed to rename '{}' -> '{}': {}",
            tmp_path.display(),
            target.display(),
            e
        ));
    }

    Ok(())
}
```

### Step 4: Delete `commands.rs`

- [ ] **Step 4: `rm src-tauri/src/filesystem/commands.rs`**

```bash
rm src-tauri/src/filesystem/commands.rs
```

Verify:

```bash
ls src-tauri/src/filesystem/
```

Expected: `list.rs  mod.rs  read.rs  scope.rs  tests/  types.rs  write.rs` (no `commands.rs`).

### Step 5: Update `filesystem/mod.rs`

- [ ] **Step 5: Replace `src-tauri/src/filesystem/mod.rs` with new module declarations**

```rust
//! Filesystem sandbox module. See `SECURITY.md` in this directory for
//! the threat model and enforcement primitives. The public API is the
//! three Tauri commands re-exported below.

mod list;
mod read;
mod scope;
mod types;
mod write;

pub use list::list_dir;
pub use read::read_file;
pub use write::write_file;

#[cfg(test)]
mod tests;
```

### Step 6: Update `filesystem/tests/mod.rs` re-exports

- [ ] **Step 6: Update test mod re-exports to point at new command modules**

Replace the re-export lines in `src-tauri/src/filesystem/tests/mod.rs`. Change:

```rust
// Re-export command items under test
pub(super) use super::commands::{list_dir, read_file, write_file};
pub(super) use super::types::{
    EntryType, ListDirRequest, ReadFileRequest, WriteFileRequest,
};
```

To:

```rust
// Re-export command items under test
pub(super) use super::list::list_dir;
pub(super) use super::read::read_file;
pub(super) use super::write::write_file;
pub(super) use super::types::{
    EntryType, ListDirRequest, ReadFileRequest, WriteFileRequest,
};
```

All other lines in `tests/mod.rs` stay unchanged.

### Step 7: Run tests — verify 18 pass with new module paths

- [ ] **Step 7: `cargo test` shows 18 passing, new paths**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: 2>&1 | tail -5
```

Expected:

```
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

Sanity check — verify all three command names still resolve from `lib.rs`:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: clean compile. If you see `cannot find function list_dir in module filesystem`, the re-export in `mod.rs` is wrong.

### Step 8: Run clippy and fmt

- [ ] **Step 8: `cargo clippy` and `cargo fmt` pass**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --package vimeflow --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

### Step 9: File-size check

- [ ] **Step 9: Verify file sizes are under 200 lines each**

```bash
wc -l src-tauri/src/filesystem/list.rs \
      src-tauri/src/filesystem/read.rs \
      src-tauri/src/filesystem/write.rs \
      src-tauri/src/filesystem/scope.rs \
      src-tauri/src/filesystem/mod.rs
```

Expected:

- `list.rs`: ~70 lines
- `read.rs`: ~45 lines
- `write.rs`: ~140 lines
- `scope.rs`: ~195 lines
- `mod.rs`: ~15 lines

All under 200. If `write.rs` runs over 200, review the function — likely an inline comment got duplicated. Do not violate the size target without investigation.

### Step 10: Manual smoke test (second time)

- [ ] **Step 10: `npm run dev` smoke test after the file split**

Same three-step check as Task 2 Step 11:

```bash
npm run dev
```

1. File explorer lists files
2. Click file → opens in editor
3. Save → file updated on disk

Stop dev server when done.

### Step 11: Commit

- [ ] **Step 11: `git commit` with the file split**

```bash
git add -A  # picks up the deletion of commands.rs + new files + modified mod.rs and tests/mod.rs

git commit -m "$(cat <<'EOF'
refactor(filesystem): split commands.rs into per-command files (#40)

Delete src-tauri/src/filesystem/commands.rs and replace with three
single-responsibility files:
  - list.rs  (~70 lines)  — list_dir command
  - read.rs  (~45 lines)  — read_file command
  - write.rs (~140 lines) — write_file command + TEMP_COUNTER static

mod.rs re-exports list_dir, read_file, and write_file under the
same public names so src-tauri/src/lib.rs is untouched.

All three command files are thin orchestrators over scope.rs; each
file has a single responsibility and is individually testable. No
production behavior changes — all 18 tests pass unchanged.
EOF
)"
```

---

## Task 4: Commit 4 — Add `SECURITY.md` and `mod.rs` Doc Comment

**Goal:** Document the threat model in `src-tauri/src/filesystem/SECURITY.md` and add a short `//!` pointer in `mod.rs`. Pure documentation — no Rust code changes beyond the doc comment.

**Files:**

- Create: `src-tauri/src/filesystem/SECURITY.md`
- Modify: `src-tauri/src/filesystem/mod.rs` (add `//!` doc comment at top)

### Step 1: Create `SECURITY.md`

- [ ] **Step 1: Write `src-tauri/src/filesystem/SECURITY.md`**

Create the file with this exact content (long but all hand-written — no placeholders):

```markdown
# Vimeflow Filesystem Sandbox — Security Model

> **Read this before modifying anything in `src-tauri/src/filesystem/`.**
> The code here is a security boundary, not ordinary glue code. This
> document is the threat model, enforcement contract, and deferred-work
> log for the entire module.

## Purpose

This module is the Tauri IPC boundary for all filesystem access. Any
code that reads or writes user files from the frontend webview MUST go
through one of the three commands in this directory (`list_dir`,
`read_file`, `write_file`). No other module in `src-tauri` should open
files on behalf of the webview.

## Threat Model

### In scope

- **Adversary:** a compromised sibling process in the same user session
  — for example a buggy coding agent spawned by the app, a malicious
  transitive dependency loaded by the frontend, or a script run by an
  agent that has access to the user's account.
- **Goal of enforcement:** confine filesystem reads and writes to paths
  rooted at `$HOME`, even in the presence of symlinks, `..` segments,
  TOCTOU races, and intermediate-path replacement.
- **Trust boundary:** the canonical path of `$HOME` at process start.
  Anything resolving outside that subtree is rejected.

### Out of scope

- Multi-user hardening. Vimeflow is a single-user desktop app.
- Confused-deputy attacks from a different OS user.
- Kernel-level attacks, `ptrace`, or `/proc/<pid>/mem` tampering.
- Denial of service via very large files or very deep directory trees.
- Information leakage via filesystem metadata (mtime, size, inode).

## Enforcement Primitives

All primitives live in `scope.rs`. Keep them there — if a helper gets
inlined into `list.rs` / `read.rs` / `write.rs` the files will silently
diverge on the next review round (see finding #9 in the review
knowledge base for the exact way this already happened once).

| Primitive                                          | Where      | What it prevents                                                                                                 |
| -------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `reject_parent_refs`                               | `scope.rs` | Lexical `..` in user input                                                                                       |
| `home_canonical`                                   | `scope.rs` | Stale `$HOME` resolution                                                                                         |
| `ensure_within_home`                               | `scope.rs` | Containment check after canonicalization                                                                         |
| `canonicalize_within_home`                         | `scope.rs` | Walk-up + per-segment mkdir loop; symlink escapes on existing or racing segments                                 |
| `open_nofollow`                                    | `scope.rs` | Symlink races on the leaf; Unix `O_NOFOLLOW` + Windows `FILE_FLAG_OPEN_REPARSE_POINT` + post-open metadata check |
| Atomic temp-file + rename                          | `write.rs` | Partial writes, mid-write replacement                                                                            |
| `WRITE_FILE_TMP_COUNTER` (per-process `AtomicU64`) | `write.rs` | Temp-file name collisions under concurrency                                                                      |

## Test Coverage Map

Each primitive has a regression test. Reviewers cross-reference this
map before approving changes to the module.

| Primitive                               | Tests                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reject_parent_refs`                    | `scope_tests::rejects_parent_refs_basic`, `write_tests::write_file_rejects_traversal_into_sibling_of_home`                                                                                           |
| `canonicalize_within_home` (happy path) | `scope_tests::canonicalize_within_home_resolves_nested_nonexistent`, `write_tests::write_file_creates_parent_dirs`                                                                                   |
| `canonicalize_within_home` (rejection)  | `scope_tests::canonicalize_within_home_rejects_escape`, `write_tests::write_file_rejects_path_outside_home`, `write_tests::write_file_refuses_intermediate_symlink_escape`                           |
| `ensure_within_home`                    | `list_tests::list_dir_*`, `read_tests::read_file_rejects_path_outside_home`                                                                                                                          |
| `open_nofollow` (Unix)                  | `read_tests::read_file_refuses_to_follow_symlink_escaping_home`, `write_tests::write_file_refuses_to_follow_symlink_escaping_home`, `write_tests::write_file_refuses_symlink_even_to_in_home_target` |
| `open_nofollow` (Windows)               | Currently uncovered — Windows CI is not yet running these tests. Tracked in follow-up (see Deferred Work below).                                                                                     |
| Atomic write + counter                  | `write_tests::write_file_creates_file`, `write_tests::write_file_overwrites_existing`                                                                                                                |

### Findings map

Every review finding from PR #38 (catalogued in
`docs/reviews/patterns/filesystem-scope.md`) is guarded by at least
one test above. Do not remove or rename a test in this module without
also updating the regression map in the review knowledge base.

## Defense Layers

The backend sandbox is not the only line of defense. The frontend file
explorer (`src/features/files/hooks/useFileTree.ts`) clamps `navigateUp`
at the home boundary so the UI never asks the backend to read above
`$HOME`. The backend enforces the sandbox; the frontend prevents the
attempt. Both layers must hold; neither is sufficient alone.

## Invariants

The module guarantees to callers:

1. No command opens, reads, or writes a path that resolves outside
   `$HOME`.
2. Write commands are atomic at the filesystem level — readers see
   either the old contents or the new, never a partial write.
3. Commands never follow a symlink on the leaf segment.
4. `..` in user input is rejected before any filesystem syscall.
5. The three `#[tauri::command]` entry points never invoke `unsafe`
   Rust.

## Deferred Work

### Workspace crate extraction (issue #40, task 3)

**Status:** Deferred.

**Rationale:** Currently only `src-tauri` consumes this module.
Workspace-crate ceremony (nested `Cargo.toml`, path deps,
workspace-level lints, doubled CI steps) has no payoff with a single
consumer. The ~500 LOC of production code does not warrant a separate
compile unit today.

**Revisit when any of the following becomes true:**

- A second binary (CLI, fuzz harness, test fixture) needs filesystem
  access.
- The module grows beyond ~1500 LOC of production code.
- We commit to `cargo fuzz` (see below) — fuzz harnesses live more
  naturally against a dedicated crate.
- A CVE in this module prompts a desire to version and changelog it
  independently of the Tauri app.

### Fuzz testing (issue #40, task 5)

**Status:** Deferred.

**Rationale:** `cargo fuzz` requires nightly Rust and adds CI
complexity. Hand-written regression tests cover all currently-known
attack classes. Fuzz pays off _after_ the module split — fuzzing
`write.rs` in isolation yields higher signal than fuzzing a
mixed-concerns file. Fuzz findings deserve their own PR narrative
(one finding per commit) rather than being buried in a refactor.

**Revisit when either of the following becomes true:**

- A CVE or near-miss surfaces in the write path.
- New surface area is added (`move_file`, `delete_file`,
  symlink creation, chmod).

### Windows CI coverage

**Status:** Deferred but flagged.

**Rationale:** The Windows arm of `open_nofollow` is not currently
exercised by CI. The Unix regression tests cover the logical behavior,
and the Windows code path is a mechanical mirror, but a Windows CI
runner would catch subtle drift (e.g. the post-open metadata check
getting skipped).

**Revisit when:** the project gains a Windows CI runner, OR when the
Windows code path changes.

## Review Checklist

For reviewers touching this module, run through each item:

- [ ] Does the change introduce a new filesystem syscall? If so, which
      primitive in `scope.rs` enforces the sandbox boundary for it?
- [ ] Is the change covered by a test in the matching
      `tests/<area>_tests.rs` file?
- [ ] If a new primitive was added, is it in the Enforcement
      Primitives table and the Test Coverage Map above?
- [ ] If deferred work was addressed, was it removed from the
      Deferred Work section?
- [ ] Does the change rename any test? If so, update
      `docs/reviews/patterns/filesystem-scope.md` so the regression
      map stays in sync.

## References

- Review knowledge base: `docs/reviews/patterns/filesystem-scope.md`
  (14 findings from 15 rounds of review on PR #38)
- Design spec: `docs/superpowers/specs/2026-04-10-filesystem-module-refactor-design.md`
- Issue: [winoooops/vimeflow#40](https://github.com/winoooops/vimeflow/issues/40)
- PR #38 review history: the commits with messages starting
  `fix: address Claude review round N` are the raw audit trail this
  document crystallizes.
```

### Step 2: Update `mod.rs` with `//!` doc comment

- [ ] **Step 2: Replace `src-tauri/src/filesystem/mod.rs` with the doc-commented version**

```rust
//! # Filesystem sandbox
//!
//! This module is the Tauri IPC boundary for all filesystem access.
//! It enforces a `$HOME`-rooted sandbox against a compromised sibling
//! process in the same user session.
//!
//! **Before modifying this module, read `SECURITY.md` in this
//! directory.** It contains the threat model, enforcement primitives,
//! test coverage map, and deferred-work log.
//!
//! ## Quick reference
//!
//! - Sandbox boundary: `$HOME` canonical path at process start
//! - Adversary: compromised sibling process (same user session)
//! - Out of scope: multi-user, confused-deputy, kernel attacks
//! - All sandbox primitives live in [`scope`]; `list`, `read`, and
//!   `write` are thin orchestrators over those helpers.
//!
//! See `SECURITY.md` for the full model.

mod list;
mod read;
mod scope;
mod types;
mod write;

pub use list::list_dir;
pub use read::read_file;
pub use write::write_file;

#[cfg(test)]
mod tests;
```

### Step 3: Run tests one more time (sanity check)

- [ ] **Step 3: `cargo test` still passes unchanged**

Pure documentation should not affect test results, but verify anyway:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: 2>&1 | tail -5
```

Expected: `test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`

### Step 4: Run clippy and fmt

- [ ] **Step 4: `cargo clippy` and `cargo fmt` pass**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --package vimeflow --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Clippy will now rustdoc-check the `//!` comment in `mod.rs`. If it complains about the `[\`scope\`]` intra-doc link, either fix it or remove the brackets (make it plain text).

### Step 5: Commit

- [ ] **Step 5: `git commit` with the documentation**

```bash
git add src-tauri/src/filesystem/SECURITY.md \
        src-tauri/src/filesystem/mod.rs

git commit -m "$(cat <<'EOF'
docs(filesystem): add SECURITY.md and mod.rs threat model pointer (#40)

Add src-tauri/src/filesystem/SECURITY.md with the full threat model
for the filesystem sandbox, including:

- In/out of scope threats (single-user desktop; adversary = compromised
  sibling process; boundary = $HOME canonical path at process start)
- Enforcement primitives table mapped to scope.rs functions
- Test coverage map tying every primitive to a regression test
- Defense layers section noting the frontend navigateUp clamp
- Deferred work log for the crate extraction (task 3) and cargo fuzz
  (task 5) with concrete revisit triggers

Add a short //! doc comment at the top of filesystem/mod.rs that
points reviewers at SECURITY.md before they touch anything in the
module.

No production code changes.
EOF
)"
```

---

## Task 5: Final Verification and PR Preparation

**Goal:** Confirm the whole branch is clean, the 14 review findings are all guarded, and the PR description is ready.

**Files:** none modified

### Step 1: Full test battery

- [ ] **Step 1: Run the complete test suite one final time**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow 2>&1 | tail -10
```

Expected: all filesystem tests pass (18 of them) plus any other tests in the crate. If any non-filesystem test has regressed, investigate — this refactor should have zero ripple effects.

### Step 2: Final lint + format check

- [ ] **Step 2: Clippy and fmt clean**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --package vimeflow --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

### Step 3: Line-count audit

- [ ] **Step 3: Verify all production files are under 200 lines**

```bash
wc -l src-tauri/src/filesystem/*.rs
```

Expected output (approximate):

```
  15 src-tauri/src/filesystem/mod.rs
  70 src-tauri/src/filesystem/list.rs
  45 src-tauri/src/filesystem/read.rs
 140 src-tauri/src/filesystem/write.rs
 195 src-tauri/src/filesystem/scope.rs
  35 src-tauri/src/filesystem/types.rs
```

None over 200. None over the 800-line CLAUDE.md guideline. The whole `filesystem/` directory fits comfortably under 500 LOC of production Rust.

### Step 4: Commit log review

- [ ] **Step 4: Verify the branch has exactly 5 commits on top of origin/main**

```bash
git log --oneline origin/main..HEAD
```

Expected output (most recent first):

```
<sha5> docs(filesystem): add SECURITY.md and mod.rs threat model pointer (#40)
<sha4> refactor(filesystem): split commands.rs into per-command files (#40)
<sha3> refactor(filesystem): extract sandbox primitives into scope.rs (#40)
<sha2> refactor(filesystem): extract tests into tests/ sub-module (#40)
91365fa docs: filesystem module refactor design (#40)
```

Five commits. Each independently revertable. The spec commit at the bottom, four refactor commits stacked on top.

### Step 5: Regression map cross-check

- [ ] **Step 5: Verify every finding in `docs/reviews/patterns/filesystem-scope.md` still has a guarding test**

For each of the 14 findings in the review knowledge base, locate its guarding test in one of `tests/list_tests.rs`, `tests/read_tests.rs`, `tests/write_tests.rs`, or `tests/scope_tests.rs`. Use the Findings Regression Map in
`docs/superpowers/specs/2026-04-10-filesystem-module-refactor-design.md` as the checklist.

Quick verification command — every finding's test name should appear:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem:: -- --list 2>&1 | grep ": test" | sort
```

Expected: 18 lines total. Cross-check against the map. If any finding has no guarding test, something was lost during refactor — investigate before pushing.

### Step 6: Final manual smoke test

- [ ] **Step 6: `npm run dev` one last time**

```bash
npm run dev
```

1. File explorer lists files from `$HOME`
2. Click a file → opens in editor
3. Edit and save → file updated on disk
4. Navigate into a subdirectory → still works
5. Try to navigate above `$HOME` → the frontend clamp prevents it (defense-in-depth check)

Stop dev server when satisfied.

### Step 7: Push the branch

- [ ] **Step 7: `git push -u origin refactor/filesystem-module-split`**

```bash
git push -u origin refactor/filesystem-module-split
```

Expected: pre-push hook runs the test suite via husky. If it passes, the branch lands on origin.

### Step 8: Open the PR

- [ ] **Step 8: `gh pr create` with issue reference and deferred-work notes**

```bash
gh pr create --title "refactor(filesystem): split commands.rs into focused modules (#40)" \
             --body "$(cat <<'EOF'
Closes #40 (partial — tasks 1, 2, 4; tasks 3 and 5 deferred with documented rationale).

## Summary

- Split `src-tauri/src/filesystem/commands.rs` (864 lines) into four focused files: `list.rs`, `read.rs`, `write.rs`, `scope.rs`
- Extract the 15 existing regression tests into `filesystem/tests/` with one file per command, plus 3 new unit tests for `scope.rs` helpers (18 tests total)
- Add `src-tauri/src/filesystem/SECURITY.md` with the threat model, enforcement primitives table, test coverage map, and deferred-work log
- Add a `//!` doc comment in `mod.rs` pointing reviewers at `SECURITY.md`

## Scope

**In this PR (issue #40 tasks 1, 2, 4):**
- Test extraction (task 1)
- Module split by responsibility (task 2)
- Threat model doc (task 4)

**Deferred with documented rationale in `SECURITY.md` § Deferred Work:**
- **Task 3:** Workspace crate extraction to `crates/vimeflow-fs/`. Single consumer, no release pressure, workspace ceremony without payoff. Revisit triggers documented.
- **Task 5:** `cargo fuzz` harness. Nightly-only tooling; fuzz pays off *after* the module split and deserves its own PR narrative. Revisit triggers documented.

## Why the deferrals matter

The `SECURITY.md` deferred-work sections include **concrete revisit triggers** (e.g. "when the module grows beyond ~1500 LOC" or "when a CVE surfaces in the write path"). Deferred never means forgotten — a future maintainer has exactly the context needed to reopen the question.

## Commits (5, independently revertable)

1. `docs: filesystem module refactor design (#40)` — spec
2. `refactor(filesystem): extract tests into tests/ sub-module (#40)` — test extraction (864 → 489 lines)
3. `refactor(filesystem): extract sandbox primitives into scope.rs (#40)` — scope helpers + 3 unit tests
4. `refactor(filesystem): split commands.rs into per-command files (#40)` — delete commands.rs, create list/read/write
5. `docs(filesystem): add SECURITY.md and mod.rs threat model pointer (#40)` — docs

## Regression safety

All 14 security findings catalogued in `docs/reviews/patterns/filesystem-scope.md` remain guarded by regression tests. The Test Coverage Map in `SECURITY.md` traces each enforcement primitive to its guarding test. Test count: 15 before → 18 after (15 command-level + 3 scope unit tests). Every original test name is preserved.

## Test plan

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --package vimeflow filesystem::` — 18 passed
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --package vimeflow --all-targets -- -D warnings` — clean
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --check` — clean
- [ ] `wc -l src-tauri/src/filesystem/*.rs` — all under 200 lines
- [ ] `npm run dev` smoke test — file explorer lists, read_file opens in editor, write_file saves
- [ ] Each of the 14 review findings in `docs/reviews/patterns/filesystem-scope.md` traces to a passing test in `tests/*_tests.rs`
EOF
)"
```

Expected: PR URL printed. Record it.

---

## Done

When all tasks above are checked off, the refactor is complete:

- `src-tauri/src/filesystem/commands.rs` is gone
- Four focused production files under 200 lines each
- 18 tests passing (15 existing + 3 new scope unit tests)
- `SECURITY.md` captures the threat model and deferred-work log
- Branch pushed and PR opened against `main` referencing issue #40
- All 14 review findings from PR #38 still guarded

Next step after merge: the automated Codex review loop (`/harness-plugin:github-review`) will pick up the PR and surface any review findings.
