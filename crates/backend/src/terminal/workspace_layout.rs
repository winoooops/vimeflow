//! Durable workspace-shape store (`app_data_dir/workspace-layouts.json`).
//! Survives graceful quit (never wiped by `clear_all`). See the design spec
//! `docs/superpowers/specs/2026-06-06-browser-only-sessions-design.md`.
//!
//! Shell + browser panes ride one `kind`-discriminated structure. The base
//! pane fields are inlined into each variant (rather than a flattened shared
//! struct) because `#[serde(flatten)]` under an internally-tagged enum is a
//! serde footgun; the wire shape is identical.
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
// ts-rs is a dev-dependency; derive TS only under cfg(test), matching `terminal/types.rs`.

pub const CURRENT_WORKSPACE_LAYOUT_VERSION: u32 = 1;
const PANE_LAYOUT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
pub struct WorkspaceLayoutStore {
    pub version: u32,
    #[serde(default, rename = "customPaneLayouts")]
    pub custom_pane_layouts: Vec<PaneLayoutDefinition>,
    pub sessions: Vec<WorkspaceSession>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct PaneLayoutDefinition {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub source: String,
    pub tracks: PaneLayoutTracks,
    pub slots: Vec<PaneLayoutSlot>,
    pub add_order: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
pub struct PaneLayoutTracks {
    pub columns: Vec<PaneLayoutTrack>,
    pub rows: Vec<PaneLayoutTrack>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct PaneLayoutTrack {
    pub id: String,
    pub units: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_px: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
pub struct PaneLayoutSlot {
    pub id: String,
    pub rect: PaneLayoutSlotRect,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub accepts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct PaneLayoutSlotRect {
    pub col: u32,
    pub row: u32,
    pub col_span: u32,
    pub row_span: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct WorkspaceSession {
    pub id: String,
    pub project_id: String,
    pub layout: String,
    #[serde(default)]
    pub placements: Vec<PanePlacement>,
    pub working_directory: String,
    pub active: bool,
    pub open: bool,
    pub panes: Vec<WorkspacePane>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct PanePlacement {
    pub pane_id: String,
    pub slot_id: String,
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
    #[serde(default)]
    pub agent_launcher: Option<String>,
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

// Mirrors the spawn-path session cap (`commands.rs` try_insert(..., 64)) so a
// valid full workspace is never treated as malformed and partly dropped.
const MAX_SESSIONS: usize = 64;
const MAX_BUILTIN_PANES: usize = 6; // grid3x2 capacity
const MAX_CUSTOM_PANE_LAYOUTS: usize = 32;
const MIN_LAYOUT_TRACKS: usize = 1;
const MAX_LAYOUT_TRACKS: usize = 24;
const MIN_LAYOUT_SLOTS: usize = 1;
const MAX_LAYOUT_SLOTS: usize = 16;
const MAX_TABS: usize = 50;
const MAX_HISTORY: usize = 100;
const MAX_URL_LEN: usize = 4096;
const MAX_TITLE_LEN: usize = 1024;
const KNOWN_AGENTS: [&str; 6] = [
    "claude-code",
    "codex",
    "kimi",
    "opencode",
    "aider",
    "generic",
];
const PANE_KINDS: [&str; 2] = ["shell", "browser"];

fn builtin_layout_capacity(layout: &str) -> Option<usize> {
    match layout {
        "single" => Some(1),
        "vsplit" | "hsplit" => Some(2),
        "threeRight" => Some(3),
        "quad" => Some(4),
        "grid3x2" => Some(6),
        _ => None,
    }
}

fn custom_layout_capacity(
    custom_pane_layouts: &[PaneLayoutDefinition],
    layout: &str,
) -> Option<usize> {
    custom_pane_layouts
        .iter()
        .find(|definition| definition.id == layout)
        .map(|definition| definition.slots.len())
}

fn layout_capacity(layout: &str, custom_pane_layouts: &[PaneLayoutDefinition]) -> Option<usize> {
    builtin_layout_capacity(layout).or_else(|| custom_layout_capacity(custom_pane_layouts, layout))
}

fn builtin_layout_slot_ids(layout: &str) -> Option<Vec<String>> {
    builtin_layout_capacity(layout).map(|capacity| {
        (0..capacity)
            .map(|index| format!("slot:p{index}"))
            .collect()
    })
}

fn custom_layout_slot_ids(
    custom_pane_layouts: &[PaneLayoutDefinition],
    layout: &str,
) -> Option<Vec<String>> {
    custom_pane_layouts
        .iter()
        .find(|definition| definition.id == layout)
        .map(|definition| definition.add_order.clone())
}

fn layout_slot_ids(layout: &str, custom_pane_layouts: &[PaneLayoutDefinition]) -> Vec<String> {
    builtin_layout_slot_ids(layout)
        .or_else(|| custom_layout_slot_ids(custom_pane_layouts, layout))
        .unwrap_or_else(|| vec!["slot:p0".to_string()])
}

fn layout_for_count(n: usize) -> &'static str {
    match n {
        0 | 1 => "single",
        2 => "vsplit",
        3 => "threeRight",
        4 => "quad",
        _ => "grid3x2",
    }
}

fn is_allowed_url(u: &str) -> bool {
    if u == "about:blank" {
        return true;
    }
    // Parse with the same WHATWG URL semantics as the runtime navigation guard
    // (Chromium): an http(s) URL with a host. This avoids a hand-rolled host
    // filter that is alternately too lenient (bad ports / unclosed brackets) or
    // too strict (rejecting Chromium-valid hosts like `foo_bar`).
    match url::Url::parse(u) {
        Ok(parsed) => {
            matches!(parsed.scheme(), "http" | "https")
                && parsed.host_str().is_some_and(|h| !h.is_empty())
        }
        Err(_) => false,
    }
}

fn str_field(v: &serde_json::Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn u32_field(v: &serde_json::Value, k: &str) -> Option<u32> {
    // try_from (not `as u32`): an oversized value (> u32::MAX) becomes None and
    // is treated as missing — not wrapped to 0, which would sort a bad pane to
    // the front or restore the first history entry.
    v.get(k)
        .and_then(|x| x.as_u64())
        .and_then(|n| u32::try_from(n).ok())
}

fn bool_field(v: &serde_json::Value, k: &str) -> Option<bool> {
    v.get(k).and_then(|x| x.as_bool())
}

fn repair_custom_pane_layouts(raw_layouts: &[serde_json::Value]) -> Vec<PaneLayoutDefinition> {
    let mut layouts = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for raw in raw_layouts.iter() {
        if layouts.len() >= MAX_CUSTOM_PANE_LAYOUTS {
            break;
        }

        let Ok(definition) = serde_json::from_value::<PaneLayoutDefinition>(raw.clone()) else {
            continue;
        };

        if !is_valid_custom_pane_layout(&definition) || seen_ids.contains(&definition.id) {
            continue;
        }

        seen_ids.insert(definition.id.clone());
        layouts.push(definition);
    }

    layouts
}

fn valid_layout_tracks(tracks: &[PaneLayoutTrack]) -> bool {
    if !(MIN_LAYOUT_TRACKS..=MAX_LAYOUT_TRACKS).contains(&tracks.len()) {
        return false;
    }

    let mut ids = std::collections::HashSet::new();
    tracks.iter().all(|track| {
        !track.id.trim().is_empty()
            && ids.insert(track.id.as_str())
            && track.units.is_finite()
            && track.units > 0.0
            && track
                .min_px
                .is_none_or(|min_px| min_px.is_finite() && min_px >= 0.0)
    })
}

fn is_valid_custom_pane_layout(definition: &PaneLayoutDefinition) -> bool {
    if definition.schema_version != PANE_LAYOUT_SCHEMA_VERSION {
        return false;
    }
    if definition.source != "workspace"
        || !definition.id.starts_with("custom:")
        || definition.id.len() <= "custom:".len()
        || definition.title.trim().is_empty()
    {
        return false;
    }
    if !valid_layout_tracks(&definition.tracks.columns)
        || !valid_layout_tracks(&definition.tracks.rows)
    {
        return false;
    }
    if !(MIN_LAYOUT_SLOTS..=MAX_LAYOUT_SLOTS).contains(&definition.slots.len()) {
        return false;
    }

    let cols = definition.tracks.columns.len();
    let rows = definition.tracks.rows.len();
    let mut seen_slots = std::collections::HashSet::new();
    let mut coverage = vec![vec![false; cols]; rows];

    for slot in &definition.slots {
        if !slot.id.starts_with("slot:")
            || slot.id.len() <= "slot:".len()
            || !seen_slots.insert(slot.id.as_str())
            || !slot
                .accepts
                .iter()
                .all(|kind| PANE_KINDS.contains(&kind.as_str()))
        {
            return false;
        }

        let Some(col_end) = slot.rect.col.checked_add(slot.rect.col_span) else {
            return false;
        };
        let Some(row_end) = slot.rect.row.checked_add(slot.rect.row_span) else {
            return false;
        };
        if slot.rect.col_span == 0
            || slot.rect.row_span == 0
            || col_end as usize > cols
            || row_end as usize > rows
        {
            return false;
        }

        for row in slot.rect.row..row_end {
            for col in slot.rect.col..col_end {
                let covered = &mut coverage[row as usize][col as usize];
                if *covered {
                    return false;
                }
                *covered = true;
            }
        }
    }

    if coverage
        .iter()
        .any(|row| row.iter().any(|covered| !covered))
    {
        return false;
    }

    let slot_ids: std::collections::HashSet<&str> = definition
        .slots
        .iter()
        .map(|slot| slot.id.as_str())
        .collect();
    let mut seen_add_order = std::collections::HashSet::new();
    definition.add_order.len() == definition.slots.len()
        && definition.add_order.iter().all(|slot_id| {
            slot_ids.contains(slot_id.as_str()) && seen_add_order.insert(slot_id.as_str())
        })
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

fn pane_id(pane: &WorkspacePane) -> &str {
    match pane {
        WorkspacePane::Shell(s) => &s.pane_id,
        WorkspacePane::Browser(b) => &b.pane_id,
    }
}

fn repair_placements(
    raw_placements: &[serde_json::Value],
    panes: &[WorkspacePane],
    layout: &str,
    custom_pane_layouts: &[PaneLayoutDefinition],
) -> Vec<PanePlacement> {
    let pane_ids: std::collections::HashSet<String> =
        panes.iter().map(|pane| pane_id(pane).to_string()).collect();
    let slot_order = layout_slot_ids(layout, custom_pane_layouts);
    let slot_ids: std::collections::HashSet<String> = slot_order.iter().cloned().collect();
    let mut used_pane_ids = std::collections::HashSet::new();
    let mut used_slot_ids = std::collections::HashSet::new();
    let mut placements = Vec::new();

    for raw in raw_placements {
        let Some(pane_id) = str_field(raw, "paneId").filter(|id| pane_ids.contains(id)) else {
            continue;
        };
        let Some(slot_id) =
            str_field(raw, "slotId").filter(|id| id.starts_with("slot:") && slot_ids.contains(id))
        else {
            continue;
        };
        if used_pane_ids.contains(&pane_id) || used_slot_ids.contains(&slot_id) {
            continue;
        }

        used_pane_ids.insert(pane_id.clone());
        used_slot_ids.insert(slot_id.clone());
        placements.push(PanePlacement { pane_id, slot_id });
    }

    let mut available_slot_ids = slot_order
        .into_iter()
        .filter(|slot_id| !used_slot_ids.contains(slot_id))
        .collect::<Vec<_>>()
        .into_iter();

    for pane in panes {
        let pane_id = pane_id(pane);
        if used_pane_ids.contains(pane_id) {
            continue;
        }

        let Some(slot_id) = available_slot_ids.next() else {
            break;
        };

        used_pane_ids.insert(pane_id.to_string());
        used_slot_ids.insert(slot_id.clone());
        placements.push(PanePlacement {
            pane_id: pane_id.to_string(),
            slot_id,
        });
    }

    placements
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
        custom_pane_layouts: Vec::new(),
        sessions: Vec::new(),
    };
    // Version gate: only the current version is decodable; anything else → fresh.
    if raw.get("version").and_then(|v| v.as_u64()) != Some(CURRENT_WORKSPACE_LAYOUT_VERSION as u64)
    {
        return empty;
    }

    let raw_sessions = raw
        .get("sessions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let raw_custom_pane_layouts = raw
        .get("customPaneLayouts")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let custom_pane_layouts = repair_custom_pane_layouts(&raw_custom_pane_layouts);

    let mut seen_session_ids = std::collections::HashSet::new();
    // ptyId must be unique across the WHOLE store (restore overlays live PTYs
    // by ptyId), so this set is store-level, not per-session.
    let mut seen_pty_ids = std::collections::HashSet::new();
    let mut active_session_seen = false;
    let mut sessions: Vec<WorkspaceSession> = Vec::new();

    for rs in raw_sessions.iter() {
        if sessions.len() >= MAX_SESSIONS {
            break;
        }
        let Some(id) = str_field(rs, "id").filter(|s| !s.is_empty()) else {
            continue; // no usable id → drop
        };
        if seen_session_ids.contains(&id) {
            continue; // duplicate session id → first wins (reserved below, if kept)
        }
        let working_directory = str_field(rs, "workingDirectory")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| active_cwd.to_string());
        let project_id = str_field(rs, "projectId")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| active_project_id.to_string());

        let raw_layout = str_field(rs, "layout");
        let pane_limit = raw_layout
            .as_deref()
            .and_then(|layout| custom_layout_capacity(&custom_pane_layouts, layout))
            .unwrap_or(MAX_BUILTIN_PANES)
            .min(MAX_LAYOUT_SLOTS);

        let raw_panes = rs
            .get("panes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let panes = repair_panes(
            &raw_panes,
            &working_directory,
            active_cwd,
            &mut seen_pty_ids,
            pane_limit,
        );
        if panes.is_empty() {
            continue; // session emptied by repair → drop (floor: ≥1 pane)
        }

        // Layout: unknown → smallest fitting; widen built-ins to fit the pane count.
        // Valid custom layouts are preserved when their definition covers the
        // repaired pane count, allowing future layouts beyond grid3x2.
        let mut layout = raw_layout
            .filter(|l| layout_capacity(l, &custom_pane_layouts).is_some())
            .unwrap_or_else(|| layout_for_count(panes.len()).to_string());
        if layout_capacity(&layout, &custom_pane_layouts).unwrap_or(1) < panes.len() {
            layout = layout_for_count(panes.len()).to_string();
        }
        let raw_placements = rs
            .get("placements")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let placements = repair_placements(&raw_placements, &panes, &layout, &custom_pane_layouts);

        // At most one active session in the loop (first active:true wins).
        // `open` is independent: it records Active-section membership, so many
        // sessions can be open while only one is selected. Old stores lacked
        // the field; fall back to raw_active to preserve selected-only restore.
        let raw_active = bool_field(rs, "active").unwrap_or(false);
        let open = bool_field(rs, "open").unwrap_or(raw_active);
        let active = raw_active && !active_session_seen;
        if active {
            active_session_seen = true;
        }

        // Session survived pane repair — reserve its id now (not earlier, or a
        // dropped malformed session would block a later valid duplicate id).
        seen_session_ids.insert(id.clone());
        sessions.push(WorkspaceSession {
            id,
            project_id,
            layout,
            placements,
            working_directory,
            active,
            open,
            panes,
        });
    }

    // Exactly one active session: if none was marked, the first wins (a
    // deterministic default; the renderer may still re-select on restore).
    if !active_session_seen {
        if let Some(first) = sessions.first_mut() {
            first.active = true;
        }
    }

    WorkspaceLayoutStore {
        version: CURRENT_WORKSPACE_LAYOUT_VERSION,
        custom_pane_layouts,
        sessions,
    }
}

fn repair_panes(
    raw_panes: &[serde_json::Value],
    session_cwd: &str,
    active_cwd: &str,
    seen_pty_ids: &mut std::collections::HashSet<String>,
    max_panes: usize,
) -> Vec<WorkspacePane> {
    let mut seen_pane_ids = std::collections::HashSet::new();
    // (sort_key, original_index, pane); sort_key = paneIndex, missing → last.
    let mut built: Vec<(u64, usize, WorkspacePane)> = Vec::new();

    for (i, rp) in raw_panes.iter().enumerate() {
        let Some(pane_id) = str_field(rp, "paneId").filter(|s| !s.is_empty()) else {
            continue; // missing paneId → drop
        };
        if seen_pane_ids.contains(&pane_id) {
            continue; // duplicate paneId → first wins (reserved below, only if kept)
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
                if seen_pty_ids.contains(&pty_id) {
                    continue; // duplicate shell ptyId → first wins (reserved below)
                }
                let Some(mut cwd) = str_field(rp, "cwd").filter(|s| !s.is_empty()) else {
                    continue; // shell missing cwd → drop (required scalar)
                };
                if !std::path::Path::new(&cwd).is_dir() {
                    // present but stale (directory gone) → fall back to a valid cwd
                    cwd = if std::path::Path::new(session_cwd).is_dir() {
                        session_cwd.to_string()
                    } else {
                        active_cwd.to_string()
                    };
                }
                let agent_type = str_field(rp, "agentType")
                    .filter(|a| KNOWN_AGENTS.contains(&a.as_str()))
                    .unwrap_or_else(|| "generic".to_string());
                // Pane is now definitely kept — reserve its ptyId (not before, or
                // a later-dropped malformed pane would steal it from a valid one).
                seen_pty_ids.insert(pty_id.clone());
                WorkspacePane::Shell(ShellPane {
                    pane_id: pane_id.clone(),
                    pane_index: 0,
                    active,
                    pty_id,
                    cwd,
                    agent_type,
                    agent_session_id: str_field(rp, "agentSessionId"),
                    agent_launcher: str_field(rp, "agentLauncher"),
                })
            }
            Some("browser") => {
                let raw_tabs = rp
                    .get("tabs")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                WorkspacePane::Browser(BrowserPane {
                    pane_id: pane_id.clone(),
                    pane_index: 0,
                    active,
                    tabs: repair_tabs(&raw_tabs),
                })
            }
            _ => continue, // unrecognized kind → drop (paneId not reserved)
        };
        // Pane confirmed kept — reserve its paneId now.
        seen_pane_ids.insert(pane_id);
        built.push((sort_key, i, pane));
    }

    built.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    // Truncate to capacity BEFORE active-normalization, so an active pane beyond
    // the layout limit cannot be dropped after being chosen (which would leave none active).
    // Un-reserve the ptyIds of capped panes so a later valid pane can reuse them.
    if built.len() > max_panes {
        for (_, _, pane) in &built[max_panes..] {
            if let WorkspacePane::Shell(s) = pane {
                seen_pty_ids.remove(&s.pty_id);
            }
        }
        built.truncate(max_panes);
    }

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
            // Keep a window of MAX_HISTORY entries around the active index.
            let half = MAX_HISTORY / 2;
            let start = history_index
                .saturating_sub(half)
                .min(history.len() - MAX_HISTORY);
            history.drain(0..start);
            history.truncate(MAX_HISTORY);
            history_index -= start;
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

/// Rust-owned durable cache for `app_data_dir/workspace-layouts.json`.
/// Atomic write (`tempfile.persist`) + in-memory mirror, mirroring
/// `SessionCache`. Distinct file from `sessions.json`, so `clear_all` (which
/// only wipes `sessions.json`) never touches it — the durability invariant.
#[derive(Debug)]
pub struct WorkspaceLayoutCache {
    path: PathBuf,
    mirror: Mutex<Option<WorkspaceLayoutStore>>,
}

impl WorkspaceLayoutCache {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            mirror: Mutex::new(None),
        }
    }

    /// Load + repair (spec §2.2) using active-project context for defaults.
    /// Missing / unreadable / corrupt → empty store (never fails — this is a
    /// convenience cache that must not block lifecycle).
    pub fn load(&self, project_id: &str, cwd: &str) -> WorkspaceLayoutStore {
        // Hold the lock across read + repair + mirror update so a load cannot
        // race a save's mid-flush file and return/cache a stale layout.
        let mut guard = self
            .mirror
            .lock()
            .expect("workspace-layout mirror poisoned");
        let raw: serde_json::Value = match fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
            Err(_) => serde_json::Value::Null,
        };
        let store = repair_workspace_layout(raw, project_id, cwd);
        *guard = Some(store.clone());
        store
    }

    /// Atomically persist the assembled store + refresh the mirror, holding the
    /// lock across the disk write so overlapping saves cannot persist out of
    /// order (mirrors `SessionCache::mutate`).
    pub fn save(&self, store: &WorkspaceLayoutStore) -> Result<(), String> {
        // Fail closed: never overwrite the durable file with a version `load`
        // would discard (which would silently delete the saved workspace on the
        // next restore). The assembler always writes the current version.
        if store.version != CURRENT_WORKSPACE_LAYOUT_VERSION {
            return Err(format!(
                "refusing to save unsupported workspace-layout version {} (current {CURRENT_WORKSPACE_LAYOUT_VERSION})",
                store.version
            ));
        }
        // Defense-in-depth: run the same repair/validation that load applies,
        // so invalid URLs or malformed panes cannot be persisted. Derive the
        // default project/cwd context from the first session so a stale shell
        // pane cwd never falls back to an empty string (which would cause the
        // pane to be dropped on the next load).
        let (default_project, default_cwd) = store
            .sessions
            .first()
            .map(|s| (s.project_id.as_str(), s.working_directory.as_str()))
            .unwrap_or(("", ""));
        let raw = serde_json::to_value(store).map_err(|e| format!("serialize: {e}"))?;
        let repaired = repair_workspace_layout(raw, default_project, default_cwd);
        let mut guard = self
            .mirror
            .lock()
            .expect("workspace-layout mirror poisoned");
        self.flush_to_disk(&repaired)?;
        *guard = Some(repaired);
        Ok(())
    }

    /// The in-memory mirror (main serves restore-time tabs from it).
    #[allow(dead_code)] // consumed by the main-side restore path, wired later
    pub fn snapshot(&self) -> Option<WorkspaceLayoutStore> {
        self.mirror
            .lock()
            .expect("workspace-layout mirror poisoned")
            .clone()
    }

    fn flush_to_disk(&self, store: &WorkspaceLayoutStore) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "workspace-layout path has no parent".to_string())?;
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        let mut tmp =
            tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("create tempfile: {e}"))?;
        let bytes = serde_json::to_vec_pretty(store).map_err(|e| format!("serialize: {e}"))?;
        tmp.write_all(&bytes).map_err(|e| format!("write: {e}"))?;
        tmp.persist(&self.path)
            .map_err(|e| format!("persist: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_shell_and_browser_panes() {
        let store = WorkspaceLayoutStore {
            version: CURRENT_WORKSPACE_LAYOUT_VERSION,
            custom_pane_layouts: Vec::new(),
            sessions: vec![WorkspaceSession {
                id: "s1".into(),
                project_id: "p".into(),
                layout: "vsplit".into(),
                placements: vec![
                    PanePlacement {
                        pane_id: "p0".into(),
                        slot_id: "slot:p0".into(),
                    },
                    PanePlacement {
                        pane_id: "p1".into(),
                        slot_id: "slot:p1".into(),
                    },
                ],
                working_directory: "/w".into(),
                active: true,
                open: true,
                panes: vec![
                    WorkspacePane::Shell(ShellPane {
                        pane_id: "p0".into(),
                        pane_index: 0,
                        active: false,
                        pty_id: "pty-0".into(),
                        cwd: "/w".into(),
                        agent_type: "claude-code".into(),
                        agent_session_id: None,
                        agent_launcher: Some("CC".into()),
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
        assert!(json.contains("\"slotId\":\"slot:p1\""), "json: {json}");
        assert!(json.contains("\"agentLauncher\":\"CC\""), "json: {json}");
        assert!(json.contains("\"open\":true"), "json: {json}");
        let back: WorkspaceLayoutStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back, store);
    }

    use serde_json::json;

    fn custom_grid_layout_json(id: &str, columns: u32, rows: u32) -> serde_json::Value {
        let column_tracks: Vec<_> = (0..columns)
            .map(|col| json!({ "id": format!("c{col}"), "units": 1 }))
            .collect();
        let row_tracks: Vec<_> = (0..rows)
            .map(|row| json!({ "id": format!("r{row}"), "units": 1 }))
            .collect();
        let slots: Vec<_> = (0..rows)
            .flat_map(|row| {
                (0..columns).map(move |col| {
                    let index = row * columns + col;
                    json!({
                        "id": format!("slot:p{index}"),
                        "rect": { "col": col, "row": row, "colSpan": 1, "rowSpan": 1 }
                    })
                })
            })
            .collect();
        let add_order: Vec<_> = (0..(columns * rows))
            .map(|index| format!("slot:p{index}"))
            .collect();

        json!({
            "schemaVersion": 1,
            "id": id,
            "title": "Custom grid",
            "source": "workspace",
            "tracks": {
                "columns": column_tracks,
                "rows": row_tracks
            },
            "slots": slots,
            "addOrder": add_order
        })
    }

    fn browser_panes_json(count: u32) -> Vec<serde_json::Value> {
        (0..count)
            .map(|index| {
                json!({
                    "kind": "browser",
                    "paneId": format!("p{index}"),
                    "paneIndex": index,
                    "active": index == 0,
                    "tabs": []
                })
            })
            .collect()
    }

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
    fn repairs_custom_pane_layout_definitions_without_blocking_sessions() {
        let valid_layout = json!({
            "schemaVersion": 1,
            "id": "custom:main-side",
            "title": "Main + side",
            "source": "workspace",
            "tracks": {
                "columns": [{ "id": "main", "units": 16 }, { "id": "side", "units": 8 }],
                "rows": [{ "id": "only", "units": 24 }]
            },
            "slots": [
                { "id": "slot:main", "rect": { "col": 0, "row": 0, "colSpan": 1, "rowSpan": 1 }},
                { "id": "slot:side", "rect": { "col": 1, "row": 0, "colSpan": 1, "rowSpan": 1 }}
            ],
            "addOrder": ["slot:main", "slot:side"]
        });

        let store = repair_workspace_layout(
            json!({
            "version": 1,
            "customPaneLayouts": [
              valid_layout,
              { "schemaVersion": 1, "id": "single", "title": "Bad", "source": "workspace" },
              { "schemaVersion": 1, "id": "custom:main-side", "title": "Duplicate", "source": "workspace" }
            ],
            "sessions": [
              { "id": "s", "projectId": "p", "layout": "single",
                "workingDirectory": "/", "active": true, "open": true,
                "panes": [ { "kind": "browser", "paneId": "b1",
                  "paneIndex": 0, "active": true } ] }
            ]}),
            "proj",
            "/",
        );

        assert_eq!(store.custom_pane_layouts.len(), 1);
        assert_eq!(store.custom_pane_layouts[0].id, "custom:main-side");
        assert_eq!(store.sessions.len(), 1);
    }

    #[test]
    fn rejects_custom_layout_with_whitespace_only_track_id() {
        let store = repair_workspace_layout(
            json!({
                "version": 1,
                "customPaneLayouts": [{
                    "schemaVersion": 1,
                    "id": "custom:bad-track",
                    "title": "Bad track",
                    "source": "workspace",
                    "tracks": {
                        "columns": [{ "id": "   ", "units": 24 }],
                        "rows": [{ "id": "only", "units": 24 }]
                    },
                    "slots": [
                        { "id": "slot:only", "rect": { "col": 0, "row": 0, "colSpan": 1, "rowSpan": 1 } }
                    ],
                    "addOrder": ["slot:only"]
                }],
                "sessions": []
            }),
            "proj",
            "/",
        );

        assert!(store.custom_pane_layouts.is_empty());
    }

    #[test]
    fn preserves_custom_session_layout_when_definition_exists() {
        let store = repair_workspace_layout(
            json!({
              "version": 1,
              "customPaneLayouts": [custom_grid_layout_json("custom:grid2x2", 2, 2)],
              "sessions": [{
                "id": "s",
                "projectId": "p",
                "layout": "custom:grid2x2",
                "workingDirectory": "/",
                "active": true,
                "open": true,
                "panes": browser_panes_json(4)
              }]
            }),
            "proj",
            "/",
        );

        assert_eq!(store.sessions[0].layout, "custom:grid2x2");
        assert_eq!(store.sessions[0].panes.len(), 4);
    }

    #[test]
    fn repairs_placements_against_layout_slots_and_pane_ids() {
        let custom_layout = json!({
            "schemaVersion": 1,
            "id": "custom:main-side",
            "title": "Main side",
            "source": "workspace",
            "tracks": {
                "columns": [{ "id": "main", "units": 16 }, { "id": "side", "units": 8 }],
                "rows": [{ "id": "top", "units": 12 }, { "id": "bottom", "units": 12 }]
            },
            "slots": [
                { "id": "slot:main", "rect": { "col": 0, "row": 0, "colSpan": 1, "rowSpan": 2 }},
                { "id": "slot:side-top", "rect": { "col": 1, "row": 0, "colSpan": 1, "rowSpan": 1 }},
                { "id": "slot:side-bottom", "rect": { "col": 1, "row": 1, "colSpan": 1, "rowSpan": 1 }}
            ],
            "addOrder": ["slot:main", "slot:side-top", "slot:side-bottom"]
        });
        let store = repair_workspace_layout(
            json!({
              "version": 1,
              "customPaneLayouts": [custom_layout],
              "sessions": [{
                "id": "s",
                "projectId": "p",
                "layout": "custom:main-side",
                "workingDirectory": "/",
                "active": true,
                "open": true,
                "placements": [
                    { "paneId": "p1", "slotId": "slot:side-top" },
                    { "paneId": "missing", "slotId": "slot:main" },
                    { "paneId": "p0", "slotId": "slot:side-top" },
                    { "paneId": "p2", "slotId": "slot:missing" }
                ],
                "panes": browser_panes_json(3)
              }]
            }),
            "proj",
            "/",
        );

        assert_eq!(
            store.sessions[0].placements,
            vec![
                PanePlacement {
                    pane_id: "p1".into(),
                    slot_id: "slot:side-top".into(),
                },
                PanePlacement {
                    pane_id: "p0".into(),
                    slot_id: "slot:main".into(),
                },
                PanePlacement {
                    pane_id: "p2".into(),
                    slot_id: "slot:side-bottom".into(),
                },
            ]
        );
    }

    #[test]
    fn unknown_custom_session_layout_falls_back_to_builtin_capacity() {
        let store = repair_workspace_layout(
            json!({
              "version": 1,
              "customPaneLayouts": [],
              "sessions": [{
                "id": "s",
                "projectId": "p",
                "layout": "custom:missing",
                "workingDirectory": "/",
                "active": true,
                "open": true,
                "panes": browser_panes_json(4)
              }]
            }),
            "proj",
            "/",
        );

        assert_eq!(store.sessions[0].layout, "quad");
        assert_eq!(store.sessions[0].panes.len(), 4);
    }

    #[test]
    fn custom_session_layout_can_preserve_more_than_grid3x2_panes() {
        let store = repair_workspace_layout(
            json!({
              "version": 1,
              "customPaneLayouts": [custom_grid_layout_json("custom:grid4x2", 4, 2)],
              "sessions": [{
                "id": "s",
                "projectId": "p",
                "layout": "custom:grid4x2",
                "workingDirectory": "/",
                "active": true,
                "open": true,
                "panes": browser_panes_json(8)
              }]
            }),
            "proj",
            "/",
        );

        assert_eq!(store.sessions[0].layout, "custom:grid4x2");
        assert_eq!(store.sessions[0].panes.len(), 8);
    }

    #[test]
    fn repairs_custom_layout_with_twenty_four_tracks() {
        let columns: Vec<serde_json::Value> = (0..24)
            .map(|index| json!({ "id": format!("col-{index}"), "units": 1 }))
            .collect();
        let store = repair_workspace_layout(
            json!({
              "version": 1,
              "customPaneLayouts": [{
                "schemaVersion": 1,
                "id": "custom:wide",
                "title": "Wide",
                "source": "workspace",
                "tracks": {
                  "columns": columns,
                  "rows": [{ "id": "row-0", "units": 24 }]
                },
                "slots": [
                  { "id": "slot:p0", "rect": { "col": 0, "row": 0, "colSpan": 24, "rowSpan": 1 } }
                ],
                "addOrder": ["slot:p0"]
              }],
              "sessions": []
            }),
            "proj",
            "/",
        );

        assert_eq!(store.custom_pane_layouts.len(), 1);
        assert_eq!(store.custom_pane_layouts[0].id, "custom:wide");
    }

    #[test]
    fn preserves_many_open_sessions_but_normalizes_one_active() {
        let store = repair_workspace_layout(
            json!({
            "version": 1,
            "sessions": [
              { "id": "s1", "projectId": "p", "layout": "single",
                "workingDirectory": "/", "active": true, "open": true,
                "panes": [ { "kind": "browser", "paneId": "b1",
                  "paneIndex": 0, "active": true } ] },
              { "id": "s2", "projectId": "p", "layout": "single",
                "workingDirectory": "/", "active": true, "open": true,
                "panes": [ { "kind": "browser", "paneId": "b2",
                  "paneIndex": 0, "active": true } ] }
            ]}),
            "proj",
            "/",
        );

        assert_eq!(store.sessions.len(), 2);
        assert!(store.sessions[0].active);
        assert!(!store.sessions[1].active);
        assert!(store.sessions[0].open);
        assert!(store.sessions[1].open);
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
    fn preserves_known_kimi_agent_type() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "single", "active": true,
                "panes": [
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true,
                      "ptyId": "x", "cwd": "/", "agentType": "kimi", "agentSessionId": null,
                      "agentLauncher": "KIMI_WORK" } ] }] }),
            "proj",
            "/",
        );
        let s = shell(&store.sessions[0].panes[0]);
        assert_eq!(s.agent_type, "kimi"); // kimi is a known agent, not coerced to generic
        assert_eq!(s.agent_launcher.as_deref(), Some("KIMI_WORK"));
    }

    #[test]
    fn preserves_known_opencode_agent_type() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "single", "active": true,
                "panes": [
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true,
                      "ptyId": "x", "cwd": "/", "agentType": "opencode", "agentSessionId": null } ] }] }),
            "proj",
            "/",
        );
        let s = shell(&store.sessions[0].panes[0]);
        assert_eq!(s.agent_type, "opencode");
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
        let ids: Vec<&str> = store.sessions[0]
            .panes
            .iter()
            .map(|p| shell(p).pane_id.as_str())
            .collect();
        assert_eq!(ids, vec!["a", "b", "c"]); // sorted by paneIndex
        let idxs: Vec<u32> = store.sessions[0]
            .panes
            .iter()
            .map(|p| shell(p).pane_index)
            .collect();
        assert_eq!(idxs, vec![0, 1, 2]); // re-indexed
    }

    #[test]
    fn widens_layout_and_preserves_panes_up_to_grid3x2() {
        let panes: Vec<_> = (0..6)
            .map(|i| json!({ "kind": "shell", "paneId": format!("p{i}"), "paneIndex": i, "active": i == 0, "ptyId": format!("pty{i}"), "cwd": "/", "agentType": "generic" }))
            .collect();
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{ "id": "s", "layout": "single", "active": true, "panes": panes }] }),
            "proj",
            "/",
        );
        assert_eq!(store.sessions[0].panes.len(), 6); // preserved up to grid3x2
        assert_eq!(store.sessions[0].layout, "grid3x2"); // widened
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

    #[test]
    fn cache_save_then_load_round_trips_and_missing_loads_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace-layouts.json");
        let cache = WorkspaceLayoutCache::new(path.clone());
        assert!(cache.load("proj", "/").sessions.is_empty()); // missing → empty

        let store = WorkspaceLayoutStore {
            version: CURRENT_WORKSPACE_LAYOUT_VERSION,
            custom_pane_layouts: Vec::new(),
            sessions: vec![WorkspaceSession {
                id: "s".into(),
                project_id: "proj".into(),
                layout: "single".into(),
                placements: vec![PanePlacement {
                    pane_id: "p0".into(),
                    slot_id: "slot:p0".into(),
                }],
                working_directory: "/".into(),
                active: true,
                open: true,
                panes: vec![WorkspacePane::Shell(ShellPane {
                    pane_id: "p0".into(),
                    pane_index: 0,
                    active: true,
                    pty_id: "x".into(),
                    cwd: "/".into(),
                    agent_type: "generic".into(),
                    agent_session_id: None,
                    agent_launcher: None,
                })],
            }],
        };
        cache.save(&store).unwrap();
        assert_eq!(cache.snapshot().unwrap().sessions.len(), 1); // mirror refreshed

        // Fresh cache instance reads the persisted file.
        let loaded = WorkspaceLayoutCache::new(path).load("proj", "/");
        assert_eq!(loaded.version, CURRENT_WORKSPACE_LAYOUT_VERSION);
        assert_eq!(loaded.sessions.len(), 1);
        assert_eq!(loaded.sessions[0].id, "s");
    }

    #[test]
    fn save_rejects_unsupported_version_failing_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace-layouts.json");
        let cache = WorkspaceLayoutCache::new(path.clone());
        cache
            .save(&WorkspaceLayoutStore {
                version: CURRENT_WORKSPACE_LAYOUT_VERSION,
                custom_pane_layouts: Vec::new(),
                sessions: vec![WorkspaceSession {
                    id: "s".into(),
                    project_id: "proj".into(),
                    layout: "single".into(),
                    placements: vec![PanePlacement {
                        pane_id: "p0".into(),
                        slot_id: "slot:p0".into(),
                    }],
                    working_directory: "/".into(),
                    active: true,
                    open: true,
                    panes: vec![WorkspacePane::Browser(BrowserPane {
                        pane_id: "p0".into(),
                        pane_index: 0,
                        active: true,
                        tabs: vec![PersistedTab {
                            active: true,
                            history: vec![NavEntry {
                                url: "https://x".into(),
                                title: None,
                            }],
                            history_index: 0,
                        }],
                    })],
                }],
            })
            .unwrap();

        // A skewed-version save fails closed, leaving the good file intact.
        let bad = WorkspaceLayoutStore {
            version: 999,
            custom_pane_layouts: Vec::new(),
            sessions: Vec::new(),
        };
        assert!(cache.save(&bad).is_err());
        let loaded = WorkspaceLayoutCache::new(path).load("proj", "/");
        assert_eq!(loaded.sessions.len(), 1); // original survived
    }

    #[test]
    fn save_repair_drops_invalid_urls_before_persisting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace-layouts.json");
        let cache = WorkspaceLayoutCache::new(path);

        let store = WorkspaceLayoutStore {
            version: CURRENT_WORKSPACE_LAYOUT_VERSION,
            custom_pane_layouts: Vec::new(),
            sessions: vec![WorkspaceSession {
                id: "s".into(),
                project_id: "proj".into(),
                layout: "single".into(),
                placements: vec![PanePlacement {
                    pane_id: "p0".into(),
                    slot_id: "slot:p0".into(),
                }],
                working_directory: "/".into(),
                active: true,
                open: true,
                panes: vec![WorkspacePane::Browser(BrowserPane {
                    pane_id: "p0".into(),
                    pane_index: 0,
                    active: true,
                    tabs: vec![PersistedTab {
                        active: true,
                        history: vec![
                            NavEntry {
                                url: "javascript:alert(1)".into(),
                                title: None,
                            },
                            NavEntry {
                                url: "https://ok".into(),
                                title: None,
                            },
                        ],
                        history_index: 1,
                    }],
                })],
            }],
        };
        cache.save(&store).unwrap();
        let snap = cache.snapshot().unwrap();
        let b = browser_tab(&snap.sessions[0].panes[0]);
        assert_eq!(b.tabs[0].history.len(), 1);
        assert_eq!(b.tabs[0].history[0].url, "https://ok");
        assert_eq!(b.tabs[0].history_index, 0);
    }

    #[test]
    fn clear_all_leaves_workspace_layouts_intact() {
        use crate::terminal::cache::SessionCache;
        let dir = tempfile::tempdir().unwrap();
        let sessions_path = dir.path().join("sessions.json");
        let layouts_path = dir.path().join("workspace-layouts.json");

        // Populate the PTY session cache (sessions.json).
        let sc = SessionCache::load(sessions_path.clone()).unwrap();
        sc.mutate(|d| {
            d.session_order.push("a".into());
            Ok(())
        })
        .unwrap();
        assert!(sessions_path.exists());

        // Populate the durable workspace-layout store (workspace-layouts.json).
        let wc = WorkspaceLayoutCache::new(layouts_path.clone());
        wc.save(&WorkspaceLayoutStore {
            version: CURRENT_WORKSPACE_LAYOUT_VERSION,
            custom_pane_layouts: Vec::new(),
            sessions: vec![WorkspaceSession {
                id: "s".into(),
                project_id: "proj".into(),
                layout: "single".into(),
                placements: vec![PanePlacement {
                    pane_id: "p0".into(),
                    slot_id: "slot:p0".into(),
                }],
                working_directory: "/".into(),
                active: true,
                open: true,
                panes: vec![WorkspacePane::Shell(ShellPane {
                    pane_id: "p0".into(),
                    pane_index: 0,
                    active: true,
                    pty_id: "x".into(),
                    cwd: "/".into(),
                    agent_type: "generic".into(),
                    agent_session_id: None,
                    agent_launcher: None,
                })],
            }],
        })
        .unwrap();
        assert!(layouts_path.exists());

        // The durability invariant: clear_all wipes sessions.json but NOT
        // workspace-layouts.json.
        sc.clear_all().unwrap();
        assert!(sc.snapshot().session_order.is_empty()); // sessions.json wiped
        assert!(layouts_path.exists()); // workspace-layouts.json untouched
        let reloaded = WorkspaceLayoutCache::new(layouts_path).load("proj", "/");
        assert_eq!(reloaded.sessions.len(), 1); // content intact
    }

    #[test]
    fn drops_shell_missing_cwd() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "vsplit", "active": true, "panes": [
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true, "ptyId": "x", "agentType": "generic" },
                    { "kind": "browser", "paneId": "p1", "paneIndex": 1, "active": false, "tabs": [] } ] }] }),
            "proj",
            "/",
        );
        // shell missing cwd dropped → only the browser pane remains, forced active
        assert_eq!(store.sessions[0].panes.len(), 1);
        assert!(matches!(
            store.sessions[0].panes[0],
            WorkspacePane::Browser(_)
        ));
        assert!(pane_active(&store.sessions[0].panes[0]));
    }

    #[test]
    fn falls_back_when_cwd_is_stale() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "single", "active": true, "panes": [
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true,
                      "ptyId": "x", "cwd": "/no/such/dir/xyz", "agentType": "generic" } ] }] }),
            "proj",
            "/",
        );
        // present-but-stale cwd → fell back to active_cwd "/" (kept, not dropped)
        assert_eq!(shell(&store.sessions[0].panes[0]).cwd, "/");
    }

    #[test]
    fn active_pane_beyond_grid3x2_still_leaves_exactly_one_active() {
        let panes: Vec<_> = (0..8)
            .map(|i| json!({ "kind": "shell", "paneId": format!("p{i}"), "paneIndex": i, "active": i == 7, "ptyId": format!("pty{i}"), "cwd": "/", "agentType": "generic" }))
            .collect();
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{ "id": "s", "layout": "single", "active": true, "panes": panes }] }),
            "proj",
            "/",
        );
        assert_eq!(store.sessions[0].panes.len(), 6); // truncated to grid3x2
        let actives = store.sessions[0]
            .panes
            .iter()
            .filter(|p| pane_active(p))
            .count();
        assert_eq!(actives, 1); // exactly one, never zero (the beyond-grid3x2 active was truncated)
    }

    #[test]
    fn history_cap_keeps_window_around_active() {
        let history: Vec<_> = (0..150)
            .map(|i| json!({ "url": format!("https://e{i}"), "title": null }))
            .collect();
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{ "id": "s", "layout": "single", "active": true,
                "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true,
                    "tabs": [{ "active": true, "historyIndex": 120, "history": history }] }] }] }),
            "proj",
            "/",
        );
        let b = browser_tab(&store.sessions[0].panes[0]);
        assert_eq!(b.tabs[0].history.len(), MAX_HISTORY); // capped
                                                          // the formerly-active entry is preserved at the remapped index
        assert_eq!(
            b.tabs[0].history[b.tabs[0].history_index as usize].url,
            "https://e120"
        );
    }

    #[test]
    fn drops_overlong_url() {
        let long = format!("https://{}", "a".repeat(MAX_URL_LEN));
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{ "id": "s", "layout": "single", "active": true,
                "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true,
                    "tabs": [{ "active": true, "historyIndex": 0, "history": [
                        { "url": long, "title": null },
                        { "url": "https://ok", "title": null } ] }] }] }] }),
            "proj",
            "/",
        );
        let b = browser_tab(&store.sessions[0].panes[0]);
        assert_eq!(b.tabs[0].history.len(), 1); // overlong url dropped
        assert_eq!(b.tabs[0].history[0].url, "https://ok");
    }

    #[test]
    fn drops_malformed_urls() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{ "id": "s", "layout": "single", "active": true,
                "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true,
                    "tabs": [{ "active": true, "historyIndex": 0, "history": [
                        { "url": "https://", "title": null },
                        { "url": "https://exa mple.com", "title": null },
                        { "url": "https://%zz", "title": null },
                        { "url": "https://foo:bar", "title": null },
                        { "url": "http://[::1", "title": null },
                        { "url": "ftp://host/x", "title": null },
                        { "url": "https://real.example", "title": null } ] }] }] }] }),
            "proj",
            "/",
        );
        let b = browser_tab(&store.sessions[0].panes[0]);
        assert_eq!(b.tabs[0].history.len(), 1); // only the well-formed http(s) url survives
        assert_eq!(b.tabs[0].history[0].url, "https://real.example");
    }

    #[test]
    fn keeps_valid_host_forms() {
        for url in [
            "https://example.com",
            "http://localhost:8080",
            "https://[::1]:443/path",
            "http://192.168.0.1",
            "http://foo_bar:3000/", // underscore host: Chromium-valid, must survive
            "about:blank",
        ] {
            let store = repair_workspace_layout(
                json!({ "version": 1, "sessions": [{ "id": "s", "layout": "single", "active": true,
                    "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true,
                        "tabs": [{ "active": true, "historyIndex": 0, "history": [{ "url": url, "title": null }] }] }] }] }),
                "proj",
                "/",
            );
            let b = browser_tab(&store.sessions[0].panes[0]);
            assert_eq!(b.tabs[0].history[0].url, url, "should keep {url}");
        }
    }

    #[test]
    fn dropped_malformed_shell_does_not_reserve_pty_id() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{
                "id": "s", "layout": "vsplit", "active": true, "panes": [
                    // malformed: has ptyId "live" but missing cwd → dropped
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true, "ptyId": "live", "agentType": "generic" },
                    // valid, reuses ptyId "live" → must be KEPT (the dropped one didn't reserve it)
                    { "kind": "shell", "paneId": "p1", "paneIndex": 1, "active": false, "ptyId": "live", "cwd": "/", "agentType": "generic" } ] }] }),
            "proj",
            "/",
        );
        assert_eq!(store.sessions[0].panes.len(), 1);
        let s = shell(&store.sessions[0].panes[0]);
        assert_eq!(s.pane_id, "p1"); // the valid pane survived
        assert_eq!(s.pty_id, "live");
    }

    #[test]
    fn forces_first_session_active_when_none_active() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [
                { "id": "a", "layout": "single", "active": false, "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true, "tabs": [] }] },
                { "id": "b", "layout": "single", "active": false, "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true, "tabs": [] }] } ] }),
            "proj",
            "/",
        );
        assert!(store.sessions[0].active); // none active → first forced active
        assert!(!store.sessions[1].active);
    }

    #[test]
    fn oversized_pane_index_sorts_last_not_front() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{ "id": "s", "layout": "vsplit", "active": true, "panes": [
                { "kind": "shell", "paneId": "huge", "paneIndex": 4294967296u64, "active": false, "ptyId": "a", "cwd": "/", "agentType": "generic" },
                { "kind": "shell", "paneId": "first", "paneIndex": 0, "active": true, "ptyId": "b", "cwd": "/", "agentType": "generic" } ] }] }),
            "proj",
            "/",
        );
        // paneIndex > u32::MAX → treated as missing → sorts LAST (not wrapped to 0)
        let ids: Vec<&str> = store.sessions[0]
            .panes
            .iter()
            .map(|p| shell(p).pane_id.as_str())
            .collect();
        assert_eq!(ids, vec!["first", "huge"]);
    }

    #[test]
    fn dropped_session_does_not_reserve_id() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [
                // first "s": only an unknown-kind pane → 0 valid panes → session dropped
                { "id": "s", "layout": "single", "active": true, "panes": [{ "kind": "frob", "paneId": "p0", "paneIndex": 0, "active": true }] },
                // second "s": valid → must be KEPT (the dropped one didn't reserve "s")
                { "id": "s", "layout": "single", "active": false, "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true, "tabs": [] }] } ] }),
            "proj",
            "/",
        );
        assert_eq!(store.sessions.len(), 1);
        assert!(matches!(
            store.sessions[0].panes[0],
            WorkspacePane::Browser(_)
        ));
    }

    #[test]
    fn truncated_pane_does_not_poison_pty_id() {
        let panes: Vec<_> = (0..7)
            .map(|i| json!({ "kind": "shell", "paneId": format!("p{i}"), "paneIndex": i, "active": i == 0, "ptyId": format!("pty{i}"), "cwd": "/", "agentType": "generic" }))
            .collect();
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [
                { "id": "s1", "layout": "grid3x2", "active": true, "panes": panes },
                // reuses pty6 (the 7th pane of s1, dropped by the grid3x2 cap) → must be KEPT
                { "id": "s2", "layout": "single", "active": false, "panes": [{ "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true, "ptyId": "pty6", "cwd": "/", "agentType": "generic" }] } ] }),
            "proj",
            "/",
        );
        assert_eq!(store.sessions[0].panes.len(), 6); // s1 capped to grid3x2
        assert_eq!(store.sessions.len(), 2); // s2 survived (pty6 un-reserved after the cap)
        assert_eq!(shell(&store.sessions[1].panes[0]).pty_id, "pty6");
    }

    #[test]
    fn dedupes_pty_id_across_sessions() {
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [
                { "id": "s1", "layout": "single", "active": true, "panes": [
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true, "ptyId": "shared", "cwd": "/", "agentType": "generic" } ] },
                { "id": "s2", "layout": "single", "active": false, "panes": [
                    { "kind": "shell", "paneId": "p0", "paneIndex": 0, "active": true, "ptyId": "shared", "cwd": "/", "agentType": "generic" } ] } ] }),
            "proj",
            "/",
        );
        // s2's shell reuses ptyId "shared" → dropped → s2 emptied → s2 dropped
        assert_eq!(store.sessions.len(), 1);
        assert_eq!(store.sessions[0].id, "s1");
    }

    #[test]
    fn caps_session_count() {
        let sessions: Vec<_> = (0..(MAX_SESSIONS + 6))
            .map(|i| json!({ "id": format!("s{i}"), "layout": "single", "active": i == 0, "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true, "tabs": [] }] }))
            .collect();
        let store =
            repair_workspace_layout(json!({ "version": 1, "sessions": sessions }), "proj", "/");
        assert_eq!(store.sessions.len(), MAX_SESSIONS);
    }

    #[test]
    fn keeps_a_full_session_workspace() {
        // 64 sessions (the spawn cap) must all survive — not be partly dropped.
        let sessions: Vec<_> = (0..MAX_SESSIONS)
            .map(|i| json!({ "id": format!("s{i}"), "layout": "single", "active": i == 0, "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true, "tabs": [] }] }))
            .collect();
        let store =
            repair_workspace_layout(json!({ "version": 1, "sessions": sessions }), "proj", "/");
        assert_eq!(store.sessions.len(), MAX_SESSIONS);
    }

    #[test]
    fn caps_tab_count() {
        let tabs: Vec<_> = (0..60)
            .map(|i| json!({ "active": i == 0, "historyIndex": 0, "history": [{ "url": format!("https://t{i}"), "title": null }] }))
            .collect();
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{ "id": "s", "layout": "single", "active": true,
                "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true, "tabs": tabs }] }] }),
            "proj",
            "/",
        );
        assert_eq!(
            browser_tab(&store.sessions[0].panes[0]).tabs.len(),
            MAX_TABS
        );
    }

    #[test]
    fn truncates_overlong_title() {
        let long_title = "t".repeat(MAX_TITLE_LEN + 50);
        let store = repair_workspace_layout(
            json!({ "version": 1, "sessions": [{ "id": "s", "layout": "single", "active": true,
                "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true,
                    "tabs": [{ "active": true, "historyIndex": 0, "history": [{ "url": "https://x", "title": long_title }] }] }] }] }),
            "proj",
            "/",
        );
        let b = browser_tab(&store.sessions[0].panes[0]);
        assert_eq!(
            b.tabs[0].history[0].title.as_ref().unwrap().chars().count(),
            MAX_TITLE_LEN
        );
    }
}
