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
//! test, update the map in `crates/backend/src/filesystem/SECURITY.md`
//! (once added in Task 4).

#![cfg(test)]

use std::path::PathBuf;

// Re-export command items under test
pub(super) use super::list::list_dir;
pub(super) use super::read::read_file;
pub(super) use super::types::{EntryType, ListDirRequest, ReadFileRequest, WriteFileRequest};
pub(super) use super::write::write_file;

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
