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
