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
