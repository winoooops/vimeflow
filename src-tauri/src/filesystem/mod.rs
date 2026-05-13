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

pub(crate) mod list;
pub(crate) mod read;
pub(crate) mod scope;
pub(crate) mod types;
pub(crate) mod write;

#[cfg(not(test))]
pub use list::list_dir;
#[cfg(not(test))]
pub use read::read_file;
#[cfg(not(test))]
pub use write::write_file;

#[cfg(test)]
mod tests;
