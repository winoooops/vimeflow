//! E2E test-only Tauri commands
//!
//! Exposed only when the `e2e-test` Cargo feature is enabled. Provides
//! read-only accessors into Rust backend state so WebdriverIO specs can
//! assert on things the frontend bridge cannot see.

use tauri::State;

use super::state::PtyState;

/// Return the set of active PTY session IDs held in Rust state.
///
/// Used by session-lifecycle specs to verify spawn/close accounting.
#[tauri::command]
pub fn list_active_pty_sessions(state: State<'_, PtyState>) -> Vec<String> {
    state.active_ids()
}
