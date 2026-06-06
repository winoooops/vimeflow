//! Durable workspace-shape store (`app_data_dir/workspace-layouts.json`).
//! Survives graceful quit (never wiped by `clear_all`). See the design spec
//! `docs/superpowers/specs/2026-06-06-browser-only-sessions-design.md`.
//!
//! Shell + browser panes ride one `kind`-discriminated structure. The base
//! pane fields are inlined into each variant (rather than a flattened shared
//! struct) because `#[serde(flatten)]` under an internally-tagged enum is a
//! serde footgun; the wire shape is identical.
use serde::{Deserialize, Serialize};
// ts-rs is a dev-dependency; derive TS only under cfg(test), matching `terminal/types.rs`.

pub const CURRENT_WORKSPACE_LAYOUT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
pub struct WorkspaceLayoutStore {
    pub version: u32,
    pub sessions: Vec<WorkspaceSession>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct WorkspaceSession {
    pub id: String,
    pub project_id: String,
    pub layout: String,
    pub working_directory: String,
    pub active: bool,
    pub panes: Vec<WorkspacePane>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "lowercase")]
#[cfg_attr(test, ts(export))]
pub enum WorkspacePane {
    Shell(ShellPane),
    Browser(BrowserPane),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ShellPane {
    pub pane_id: String,
    pub pane_index: u32,
    pub active: bool,
    pub pty_id: String,
    pub cwd: String,
    pub agent_type: String,
    pub agent_session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct BrowserPane {
    pub pane_id: String,
    pub pane_index: u32,
    pub active: bool,
    pub tabs: Vec<PersistedTab>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct PersistedTab {
    pub active: bool,
    pub history: Vec<NavEntry>,
    pub history_index: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct NavEntry {
    pub url: String,
    pub title: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_shell_and_browser_panes() {
        let store = WorkspaceLayoutStore {
            version: CURRENT_WORKSPACE_LAYOUT_VERSION,
            sessions: vec![WorkspaceSession {
                id: "s1".into(),
                project_id: "p".into(),
                layout: "vsplit".into(),
                working_directory: "/w".into(),
                active: true,
                panes: vec![
                    WorkspacePane::Shell(ShellPane {
                        pane_id: "p0".into(),
                        pane_index: 0,
                        active: false,
                        pty_id: "pty-0".into(),
                        cwd: "/w".into(),
                        agent_type: "claude-code".into(),
                        agent_session_id: None,
                    }),
                    WorkspacePane::Browser(BrowserPane {
                        pane_id: "p1".into(),
                        pane_index: 1,
                        active: true,
                        tabs: vec![PersistedTab {
                            active: true,
                            history_index: 0,
                            history: vec![NavEntry {
                                url: "https://x".into(),
                                title: None,
                            }],
                        }],
                    }),
                ],
            }],
        };
        let json = serde_json::to_string(&store).unwrap();
        // camelCase fields on the wire + lowercase kind tag.
        assert!(json.contains("\"paneId\":\"p0\""), "json: {json}");
        assert!(json.contains("\"projectId\":\"p\""), "json: {json}");
        assert!(json.contains("\"historyIndex\":0"), "json: {json}");
        assert!(json.contains("\"kind\":\"shell\""), "json: {json}");
        assert!(json.contains("\"kind\":\"browser\""), "json: {json}");
        let back: WorkspaceLayoutStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back, store);
    }
}
