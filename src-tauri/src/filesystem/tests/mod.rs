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
pub(super) use super::types::{EntryType, ListDirRequest, ReadFileRequest, WriteFileRequest};

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
