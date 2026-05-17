//! Terminal PTY management module
//!
//! This module handles PTY (pseudo-terminal) spawning, lifecycle management,
//! and IPC communication with the frontend.

pub mod bridge;
pub mod cache;
pub mod commands;
pub(crate) mod events;
pub mod state;
#[cfg(feature = "e2e-test")]
pub mod test_commands;
pub mod types;

pub use state::PtyState;

// Note: `cache::SessionCache` and the request/response types are accessed
// via fully-qualified paths (`crate::terminal::cache::SessionCache`,
// `super::types::SessionList`, etc.). Re-exporting them here previously
// produced unused-import warnings since nothing consumed `terminal::*`
// for those names — removed.
