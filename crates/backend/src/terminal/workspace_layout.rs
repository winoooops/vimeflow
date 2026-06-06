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

// Default URL a seeded/empty browser tab opens to. Kept in sync with the
// renderer's `DEFAULT_BROWSER_URL` (cross-process boundary prevents sharing).
const DEFAULT_BROWSER_URL: &str = "https://www.google.com/";

const MAX_SESSIONS: usize = 50;
const MAX_PANES: usize = 4; // quad capacity
const MAX_TABS: usize = 50;
const MAX_HISTORY: usize = 100;
const MAX_URL_LEN: usize = 4096;
const MAX_TITLE_LEN: usize = 1024;
const KNOWN_AGENTS: [&str; 4] = ["claude-code", "codex", "aider", "generic"];

fn layout_capacity(layout: &str) -> Option<usize> {
    match layout {
        "single" => Some(1),
        "vsplit" | "hsplit" => Some(2),
        "threeRight" => Some(3),
        "quad" => Some(4),
        _ => None,
    }
}

fn layout_for_count(n: usize) -> &'static str {
    match n {
        0 | 1 => "single",
        2 => "vsplit",
        3 => "threeRight",
        _ => "quad",
    }
}

fn is_allowed_url(u: &str) -> bool {
    u == "about:blank" || u.starts_with("http://") || u.starts_with("https://")
}

fn str_field(v: &serde_json::Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn u32_field(v: &serde_json::Value, k: &str) -> Option<u32> {
    v.get(k).and_then(|x| x.as_u64()).map(|n| n as u32)
}

fn bool_field(v: &serde_json::Value, k: &str) -> Option<bool> {
    v.get(k).and_then(|x| x.as_bool())
}

fn truncate_chars(s: String, max: usize) -> String {
    if s.chars().count() <= max {
        s
    } else {
        s.chars().take(max).collect()
    }
}

fn set_pane_index_active(pane: &mut WorkspacePane, index: u32, active: bool) {
    match pane {
        WorkspacePane::Shell(s) => {
            s.pane_index = index;
            s.active = active;
        }
        WorkspacePane::Browser(b) => {
            b.pane_index = index;
            b.active = active;
        }
    }
}

fn pane_active(pane: &WorkspacePane) -> bool {
    match pane {
        WorkspacePane::Shell(s) => s.active,
        WorkspacePane::Browser(b) => b.active,
    }
}

/// Lenient decode + repair (spec §2.2). Reads each field tolerantly from
/// `raw` (never hard-fails on missing/wrong-typed values), then repairs into
/// the strict model. `active_project_id` / `active_cwd` supply the defaults
/// Rust lacks context for (passed into the load command).
pub fn repair_workspace_layout(
    raw: serde_json::Value,
    active_project_id: &str,
    active_cwd: &str,
) -> WorkspaceLayoutStore {
    let empty = WorkspaceLayoutStore {
        version: CURRENT_WORKSPACE_LAYOUT_VERSION,
        sessions: Vec::new(),
    };
    // Version gate: only the current version is decodable; anything else → fresh.
    if raw.get("version").and_then(|v| v.as_u64())
        != Some(CURRENT_WORKSPACE_LAYOUT_VERSION as u64)
    {
        return empty;
    }

    let raw_sessions = raw
        .get("sessions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut seen_session_ids = std::collections::HashSet::new();
    let mut active_session_seen = false;
    let mut sessions: Vec<WorkspaceSession> = Vec::new();

    for rs in raw_sessions.iter() {
        if sessions.len() >= MAX_SESSIONS {
            break;
        }
        let Some(id) = str_field(rs, "id").filter(|s| !s.is_empty()) else {
            continue; // no usable id → drop
        };
        if !seen_session_ids.insert(id.clone()) {
            continue; // duplicate session id → first wins
        }
        let working_directory = str_field(rs, "workingDirectory")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| active_cwd.to_string());
        let project_id = str_field(rs, "projectId")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| active_project_id.to_string());

        let raw_panes = rs
            .get("panes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut panes = repair_panes(&raw_panes, &working_directory, active_cwd);
        if panes.len() > MAX_PANES {
            panes.truncate(MAX_PANES);
        }
        if panes.is_empty() {
            continue; // session emptied by repair → drop (floor: ≥1 pane)
        }

        // Layout: unknown → smallest fitting; widen to fit the pane count, cap quad.
        let mut layout = str_field(rs, "layout")
            .filter(|l| layout_capacity(l).is_some())
            .unwrap_or_else(|| layout_for_count(panes.len()).to_string());
        if layout_capacity(&layout).unwrap_or(1) < panes.len() {
            layout = layout_for_count(panes.len()).to_string();
        }

        // At most one active session (first with active:true wins).
        let raw_active = bool_field(rs, "active").unwrap_or(false);
        let active = raw_active && !active_session_seen;
        if active {
            active_session_seen = true;
        }

        sessions.push(WorkspaceSession {
            id,
            project_id,
            layout,
            working_directory,
            active,
            panes,
        });
    }

    WorkspaceLayoutStore {
        version: CURRENT_WORKSPACE_LAYOUT_VERSION,
        sessions,
    }
}

fn repair_panes(
    raw_panes: &[serde_json::Value],
    session_cwd: &str,
    active_cwd: &str,
) -> Vec<WorkspacePane> {
    let mut seen_pane_ids = std::collections::HashSet::new();
    let mut seen_pty_ids = std::collections::HashSet::new();
    // (sort_key, original_index, pane); sort_key = paneIndex, missing → last.
    let mut built: Vec<(u64, usize, WorkspacePane)> = Vec::new();

    for (i, rp) in raw_panes.iter().enumerate() {
        let Some(pane_id) = str_field(rp, "paneId").filter(|s| !s.is_empty()) else {
            continue; // missing paneId → drop
        };
        if !seen_pane_ids.insert(pane_id.clone()) {
            continue; // duplicate paneId → first wins
        }
        let sort_key = u32_field(rp, "paneIndex")
            .map(|n| n as u64)
            .unwrap_or(u64::MAX);
        let active = bool_field(rp, "active").unwrap_or(false);

        let pane = match str_field(rp, "kind").as_deref() {
            Some("shell") => {
                let Some(pty_id) = str_field(rp, "ptyId").filter(|s| !s.is_empty()) else {
                    continue; // shell missing ptyId → drop
                };
                if !seen_pty_ids.insert(pty_id.clone()) {
                    continue; // duplicate shell ptyId → first wins
                }
                let mut cwd = str_field(rp, "cwd")
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| session_cwd.to_string());
                if !std::path::Path::new(&cwd).is_dir() {
                    cwd = if std::path::Path::new(session_cwd).is_dir() {
                        session_cwd.to_string()
                    } else {
                        active_cwd.to_string()
                    };
                }
                let agent_type = str_field(rp, "agentType")
                    .filter(|a| KNOWN_AGENTS.contains(&a.as_str()))
                    .unwrap_or_else(|| "generic".to_string());
                WorkspacePane::Shell(ShellPane {
                    pane_id,
                    pane_index: 0,
                    active,
                    pty_id,
                    cwd,
                    agent_type,
                    agent_session_id: str_field(rp, "agentSessionId"),
                })
            }
            Some("browser") => {
                let raw_tabs = rp
                    .get("tabs")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                WorkspacePane::Browser(BrowserPane {
                    pane_id,
                    pane_index: 0,
                    active,
                    tabs: repair_tabs(&raw_tabs),
                })
            }
            _ => continue, // unrecognized kind → drop
        };
        built.push((sort_key, i, pane));
    }

    built.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

    let any_active = built.iter().any(|(_, _, p)| pane_active(p));
    let mut active_seen = false;
    built
        .into_iter()
        .enumerate()
        .map(|(idx, (_, _, mut pane))| {
            let want_active = if any_active {
                pane_active(&pane) && !active_seen
            } else {
                idx == 0 // none active → first pane wins
            };
            if want_active {
                active_seen = true;
            }
            set_pane_index_active(&mut pane, idx as u32, want_active);
            pane
        })
        .collect()
}

fn repair_tabs(raw_tabs: &[serde_json::Value]) -> Vec<PersistedTab> {
    let mut tabs: Vec<PersistedTab> = Vec::new();
    for rt in raw_tabs.iter() {
        if tabs.len() >= MAX_TABS {
            break;
        }
        let active = bool_field(rt, "active").unwrap_or(false);
        let raw_index = u32_field(rt, "historyIndex").unwrap_or(0) as usize;
        let raw_history = rt
            .get("history")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        // Drop invalid-url entries; remap the index past entries removed before it.
        let mut history: Vec<NavEntry> = Vec::new();
        let mut removed_before_index = 0usize;
        for (i, re) in raw_history.iter().enumerate() {
            match str_field(re, "url") {
                Some(u) if is_allowed_url(&u) && u.len() <= MAX_URL_LEN => {
                    let title = str_field(re, "title").map(|t| truncate_chars(t, MAX_TITLE_LEN));
                    history.push(NavEntry { url: u, title });
                }
                _ => {
                    if i < raw_index {
                        removed_before_index += 1;
                    }
                }
            }
        }
        let mut history_index = raw_index.saturating_sub(removed_before_index);

        if history.is_empty() {
            history.push(NavEntry {
                url: DEFAULT_BROWSER_URL.to_string(),
                title: None,
            });
            history_index = 0;
        }
        if history.len() > MAX_HISTORY {
            let drop = history.len() - MAX_HISTORY;
            history.drain(0..drop);
            history_index = history_index.saturating_sub(drop);
        }
        if history_index >= history.len() {
            history_index = history.len() - 1;
        }

        tabs.push(PersistedTab {
            active,
            history,
            history_index: history_index as u32,
        });
    }

    if tabs.is_empty() {
        // Browser pane with no tabs → one default tab.
        tabs.push(PersistedTab {
            active: true,
            history: vec![NavEntry {
                url: DEFAULT_BROWSER_URL.to_string(),
                title: None,
            }],
            history_index: 0,
        });
    }

    // Exactly one active tab (first active wins; none → first tab).
    let any_active = tabs.iter().any(|t| t.active);
    let mut active_seen = false;
    for (i, t) in tabs.iter_mut().enumerate() {
        t.active = if any_active {
            t.active && !active_seen
        } else {
            i == 0
        };
        if t.active {
            active_seen = true;
        }
    }
    tabs
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

    use serde_json::json;

    fn browser_tab(b: &WorkspacePane) -> &BrowserPane {
        match b {
            WorkspacePane::Browser(x) => x,
            _ => panic!("expected browser pane"),
        }
    }
    fn shell(p: &WorkspacePane) -> &ShellPane {
        match p {
            WorkspacePane::Shell(x) => x,
            _ => panic!("expected shell pane"),
        }
    }

    #[test]
    fn unknown_version_yields_empty() {
        let store = repair_workspace_layout(json!({ "version": 999, "sessions": [] }), "proj", "/");
        assert!(store.sessions.is_empty());
        assert_eq!(store.version, CURRENT_WORKSPACE_LAYOUT_VERSION);
    }

    #[test]
    fn clamps_history_index_and_seeds_empty_history() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "single", "active": true,
                "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true,
                    "tabs": [{ "active": true, "history": [], "historyIndex": 9 }] }] }] }),
            "proj",
            "/",
        );
        let b = browser_tab(&store.sessions[0].panes[0]);
        assert_eq!(b.tabs[0].history.len(), 1); // seeded
        assert_eq!(b.tabs[0].history_index, 0); // clamped
    }

    #[test]
    fn drops_unknown_kind_coerces_agent_and_forces_active() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "single", "active": true,
                "panes": [
                    { "kind": "frobnicate", "paneId": "p0", "paneIndex": 0, "active": true },
                    { "kind": "shell", "paneId": "p1", "paneIndex": 1, "active": false,
                      "ptyId": "x", "cwd": "/", "agentType": "weird", "agentSessionId": null } ] }] }),
            "proj",
            "/",
        );
        assert_eq!(store.sessions[0].panes.len(), 1); // unknown-kind dropped
        let s = shell(&store.sessions[0].panes[0]);
        assert_eq!(s.agent_type, "generic"); // unknown agentType coerced
        assert!(s.active); // sole pane forced active (none were active after drop)
        assert_eq!(s.pane_index, 0); // re-indexed
    }

    #[test]
    fn defaults_project_context_and_drops_invalid_urls_remapping_index() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "single", "active": true,
                "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true,
                    "tabs": [{ "active": true, "historyIndex": 1, "history": [
                        { "url": "javascript:alert(1)", "title": null },
                        { "url": "https://ok", "title": "ok" }] }] }] }] }),
            "proj",
            "/",
        );
        assert_eq!(store.sessions[0].project_id, "proj"); // defaulted
        assert_eq!(store.sessions[0].working_directory, "/"); // defaulted
        let b = browser_tab(&store.sessions[0].panes[0]);
        assert_eq!(b.tabs[0].history.len(), 1); // js: url dropped
        assert_eq!(b.tabs[0].history[0].url, "https://ok");
        assert_eq!(b.tabs[0].history_index, 0); // remapped after drop-before-active
    }

    #[test]
    fn dedupes_session_pane_and_pty_ids() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [
                { "id": "s", "layout": "vsplit", "active": true, "panes": [
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true, "ptyId": "a", "cwd": "/", "agentType": "generic" },
                    { "kind": "shell", "paneId": "p0", "paneIndex": 1, "active": false, "ptyId": "b", "cwd": "/", "agentType": "generic" },
                    { "kind": "shell", "paneId": "p1", "paneIndex": 2, "active": false, "ptyId": "a", "cwd": "/", "agentType": "generic" } ] },
                { "id": "s", "layout": "single", "active": true, "panes": [
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true, "ptyId": "z", "cwd": "/", "agentType": "generic" } ] } ] }),
            "proj",
            "/",
        );
        assert_eq!(store.sessions.len(), 1); // duplicate session id dropped
        // p0 (first), p0-dup dropped, p1 has dup ptyId "a" → dropped → only p0 remains
        assert_eq!(store.sessions[0].panes.len(), 1);
        assert_eq!(shell(&store.sessions[0].panes[0]).pane_id, "p0");
    }

    #[test]
    fn normalizes_multiple_active_to_first() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [
                { "id": "s1", "layout": "vsplit", "active": true, "panes": [
                    { "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true, "tabs": [
                        { "active": true, "historyIndex": 0, "history": [{ "url": "https://a", "title": null }] },
                        { "active": true, "historyIndex": 0, "history": [{ "url": "https://b", "title": null }] } ] },
                    { "kind": "shell", "paneId": "p1", "paneIndex": 1, "active": true, "ptyId": "x", "cwd": "/", "agentType": "generic" } ] },
                { "id": "s2", "layout": "single", "active": true, "panes": [
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true, "ptyId": "y", "cwd": "/", "agentType": "generic" } ] } ] }),
            "proj",
            "/",
        );
        // one active session
        assert!(store.sessions[0].active);
        assert!(!store.sessions[1].active);
        // one active pane in s1 (first)
        assert!(pane_active(&store.sessions[0].panes[0]));
        assert!(!pane_active(&store.sessions[0].panes[1]));
        // one active tab in the browser pane (first)
        let b = browser_tab(&store.sessions[0].panes[0]);
        assert!(b.tabs[0].active && !b.tabs[1].active);
    }

    #[test]
    fn sorts_panes_by_index_and_reindexes() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "threeRight", "active": true, "panes": [
                    { "kind": "shell", "paneId": "c", "paneIndex": 2, "active": false, "ptyId": "1", "cwd": "/", "agentType": "generic" },
                    { "kind": "shell", "paneId": "a", "paneIndex": 0, "active": true, "ptyId": "2", "cwd": "/", "agentType": "generic" },
                    { "kind": "shell", "paneId": "b", "paneIndex": 1, "active": false, "ptyId": "3", "cwd": "/", "agentType": "generic" } ] }] }),
            "proj",
            "/",
        );
        let ids: Vec<&str> = store.sessions[0].panes.iter().map(|p| shell(p).pane_id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b", "c"]); // sorted by paneIndex
        let idxs: Vec<u32> = store.sessions[0].panes.iter().map(|p| shell(p).pane_index).collect();
        assert_eq!(idxs, vec![0, 1, 2]); // re-indexed
    }

    #[test]
    fn widens_layout_and_drops_panes_beyond_quad() {
        let panes: Vec<_> = (0..6)
            .map(|i| json!({ "kind": "shell", "paneId": format!("p{i}"), "paneIndex": i, "active": i == 0, "ptyId": format!("pty{i}"), "cwd": "/", "agentType": "generic" }))
            .collect();
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{ "id": "s", "layout": "single", "active": true, "panes": panes }] }),
            "proj",
            "/",
        );
        assert_eq!(store.sessions[0].panes.len(), 4); // dropped beyond quad
        assert_eq!(store.sessions[0].layout, "quad"); // widened
    }

    #[test]
    fn seeds_empty_browser_tabs() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "single", "active": true,
                "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true, "tabs": [] }] }] }),
            "proj",
            "/",
        );
        let b = browser_tab(&store.sessions[0].panes[0]);
        assert_eq!(b.tabs.len(), 1); // seeded one default tab
        assert!(b.tabs[0].active);
        assert_eq!(b.tabs[0].history[0].url, DEFAULT_BROWSER_URL);
    }
}
