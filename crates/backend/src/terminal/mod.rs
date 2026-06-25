//! Terminal PTY management module
//!
//! This module handles PTY (pseudo-terminal) spawning, lifecycle management,
//! and IPC communication with the frontend.

pub mod bridge;
pub(crate) mod bytes;
pub mod cache;
pub mod commands;
pub(crate) mod events;
pub(crate) mod foreground;
#[cfg(feature = "ghostty-vt")]
pub(crate) mod ghostty;
#[cfg(not(feature = "ghostty-vt"))]
pub(crate) mod ghostty {
    use super::types::GhosttyVtRenderSnapshot;

    #[derive(Debug)]
    pub(crate) struct GhosttySessionHandle;

    impl Clone for GhosttySessionHandle {
        fn clone(&self) -> Self {
            Self
        }
    }

    impl GhosttySessionHandle {
        pub fn new() -> (Self, GhosttySessionReader) {
            (Self, GhosttySessionReader)
        }

        pub fn resize(&self, _cols: u16, _rows: u16) -> Result<(), String> {
            Ok(())
        }

        pub fn latest_snapshot(&self) -> Option<GhosttyVtRenderSnapshot> {
            None
        }
    }

    #[derive(Debug)]
    pub(crate) struct GhosttySessionReader;

    impl GhosttySessionReader {
        pub fn create_state(self, _cols: u16, _rows: u16) -> Result<GhosttyTerminalState, String> {
            Err("Ghostty VT support is disabled for this build".to_string())
        }
    }

    #[derive(Debug)]
    pub(crate) struct GhosttyTerminalState;

    impl GhosttyTerminalState {
        pub(crate) fn feed(&mut self, _bytes: &[u8]) -> Result<(), String> {
            Ok(())
        }

        pub(crate) fn render(
            &mut self,
        ) -> Result<(GhosttyVtRenderSnapshot, Option<String>), String> {
            Err("Ghostty VT support is disabled for this build".to_string())
        }

        pub(crate) fn scroll(&mut self, _delta: i32) -> Result<GhosttyVtRenderSnapshot, String> {
            Err("Ghostty VT support is disabled for this build".to_string())
        }
    }
}
pub mod state;
#[cfg(feature = "e2e-test")]
pub mod test_commands;
pub mod types;
pub mod workspace_layout;

pub use state::PtyState;

// Note: `cache::SessionCache` and the request/response types are accessed
// via fully-qualified paths (`crate::terminal::cache::SessionCache`,
// `super::types::SessionList`, etc.). Re-exporting them here previously
// produced unused-import warnings since nothing consumed `terminal::*`
// for those names — removed.
