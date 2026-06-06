<!-- cspell:ignore vsplit hsplit multipane reselect reselectable respawn respawns serde ts-rs tempfile camelCase -->

# Browser-Only Sessions + Unified Durable Workspace Restore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist + restore a whole vimeflow workspace — shell panes (cwd + agent) and browser panes (full tab set + per-tab nav history) — across reload **and** graceful quit, making browser-only sessions first-class (reachable, re-selectable, restorable, creatable).

**Architecture:** A Rust-owned durable file (`workspace-layouts.json`, never wiped by `clear_all`) holds a `kind`-discriminated `WorkspaceLayoutStore`. **Electron main is the single assembler/writer** (generation-serialized writes; window-`close` flush). The renderer pushes a shape-only DTO; main owns all browser tab/history (capture + `navigationHistory.restore`). Restore is store-driven, renderer-initiated with project context, with reload-reconnect to still-live views. See the spec for every contract: `docs/superpowers/specs/2026-06-06-browser-only-sessions-design.md`.

**Tech Stack:** Rust (serde, ts-rs, tempfile) backend sidecar; Electron main (`electron/`); React/TypeScript renderer; Vitest; `cargo test`.

**Base assumption (§7 of the spec):** this plan is written against a `main` that has **#290 (`dev/session-restore-multipane`)** and **`feat/browser-pane-redesign`** merged. Where a task extends a #290 component (`usePushWorkspaceGrouping`, `groupSessionsFromInfos`, `WorkspaceSessionSnapshot`/`PaneGrouping`/`SessionInfo`, the Rust grouping commands) or a browser-pane-redesign component (`electron/browser-pane.ts`, `src/features/browser/*`), exact line targets resolve against that merged base; the named component + spec § is the contract. **Phase A (the Rust durable store) is self-contained new code and can be built before the merge.**

**Already landed (foundation, on this branch):** the two guard-relaxation commits — `canClosePane` (`SplitView.tsx`) and `removePane` (`useSessionManager.ts`) no longer gate on shell count — plus their tests. This plan builds the rest.

**Conventions:** commit per task; `feat|test|refactor(scope): …` lowercase subject ≤100 chars; `git commit --no-verify` (pre-commit `tsc` OOMs in this env — run `npm run lint`/`type-check`/`test` manually first). Frontend tests: explicit `import { test, expect } from 'vitest'`. Inline comments: one short line, no task/PR refs. **Every "Run, fail/green" step runs the task's named test file** — `npx vitest run <path>` (frontend) or `cargo test -p vimeflow <module>` (Rust). Each commit carries your executing agent's `Co-Authored-By:` trailer.

---

## Phase A — Rust durable store (self-contained; no #290 dependency)

### Task 1: `WorkspaceLayoutStore` types + serde + ts-rs bindings

**Files:**

- Create: `crates/backend/src/terminal/workspace_layout.rs`
- Modify: `crates/backend/src/terminal/mod.rs` (add `pub mod workspace_layout;`)
- Test: `crates/backend/src/terminal/workspace_layout.rs` (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing serde round-trip test**

```rust
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
                        base: PaneBase { pane_id: "p0".into(), pane_index: 0, active: false },
                        pty_id: "pty-0".into(),
                        cwd: "/w".into(),
                        agent_type: "claude-code".into(),
                        agent_session_id: None,
                    }),
                    WorkspacePane::Browser(BrowserPane {
                        base: PaneBase { pane_id: "p1".into(), pane_index: 1, active: true },
                        tabs: vec![PersistedTab {
                            active: true,
                            history_index: 0,
                            history: vec![NavEntry { url: "https://x".into(), title: None }],
                        }],
                    }),
                ],
            }],
        };
        let json = serde_json::to_string(&store).unwrap();
        // camelCase on the wire + lowercase kind tag
        assert!(json.contains("\"paneId\":\"p0\""));
        assert!(json.contains("\"projectId\":\"p\""));
        assert!(json.contains("\"historyIndex\":0"));
        assert!(json.contains("\"kind\":\"shell\""));
        assert!(json.contains("\"kind\":\"browser\""));
        let back: WorkspaceLayoutStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back, store);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test -p vimeflow workspace_layout::tests::round_trips`
Expected: FAIL — types not defined.

- [ ] **Step 3: Define the types (spec §2)**

```rust
//! Durable workspace-shape store (`app_data_dir/workspace-layouts.json`).
//! Survives graceful quit (never wiped by `clear_all`). See the design spec.
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
pub struct PaneBase {
    pub pane_id: String,
    pub pane_index: u32,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, ts(export))]
pub struct ShellPane {
    #[serde(flatten)]
    pub base: PaneBase,
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
    #[serde(flatten)]
    pub base: PaneBase,
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
```

Note: `#[serde(tag = "kind")]` requires the variant payloads be structs (they are). Verify the `flatten` + internally-tagged combination serializes as the spec's flat shape; if serde rejects `flatten` under an internally-tagged enum, inline `PaneBase`'s fields directly into `ShellPane`/`BrowserPane` instead (keep the TS shape identical).

- [ ] **Step 4: Run the test to green**

Run: `cargo test -p vimeflow workspace_layout::tests::round_trips`
Expected: PASS.

- [ ] **Step 5: Regenerate + commit**

```bash
npm run generate:bindings   # ts-rs → src/bindings/*.ts
git add crates/backend/src/terminal/workspace_layout.rs crates/backend/src/terminal/mod.rs src/bindings/
git commit --no-verify -m "feat(backend): workspace-layout store types + bindings"
```

---

### Task 2: Lenient decode → strict repair (spec §2.2)

**Files:**

- Modify: `crates/backend/src/terminal/workspace_layout.rs`
- Test: same file's `tests` module

- [ ] **Step 1: Write failing repair tests (one per §2.2 rule)**

```rust
#[test]
fn repair_clamps_history_index_and_seeds_empty() {
    let raw = serde_json::json!({
        "version": 1,
        "sessions": [{
            "id": "s", "projectId": "p", "layout": "single",
            "workingDirectory": "/w", "active": true,
            "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true,
                        "tabs": [{ "active": true, "history": [], "historyIndex": 9 }] }]
        }]
    });
    let store = repair_workspace_layout(raw, "proj", "/proj");
    let WorkspacePane::Browser(b) = &store.sessions[0].panes[0] else { panic!() };
    assert_eq!(b.tabs[0].history.len(), 1); // seeded default
    assert_eq!(b.tabs[0].history_index, 0); // clamped
}

#[test]
fn repair_drops_wrong_typed_and_unknown_kind_panes() {
    let raw = serde_json::json!({
        "version": 1,
        "sessions": [{
            "id": "s", "projectId": "p", "layout": "single",
            "workingDirectory": "/w", "active": true,
            "panes": [
                { "kind": "frobnicate", "paneId": "p0", "paneIndex": 0, "active": true },
                { "kind": "shell", "paneId": "p1", "paneIndex": 1, "active": false,
                  "ptyId": "x", "cwd": "/w", "agentType": "weird", "agentSessionId": null }
            ]
        }]
    });
    let store = repair_workspace_layout(raw, "proj", "/proj");
    assert_eq!(store.sessions[0].panes.len(), 1); // unknown-kind dropped
    let WorkspacePane::Shell(s) = &store.sessions[0].panes[0] else { panic!() };
    assert_eq!(s.agent_type, "generic"); // unknown agentType coerced
    assert!(s.base.active); // sole pane forced active
}

#[test]
fn repair_defaults_missing_project_context_and_drops_invalid_urls() {
    let raw = serde_json::json!({
        "version": 1,
        "sessions": [{
            "id": "s", "layout": "single", "active": true,
            "panes": [{ "kind": "browser", "paneId": "p0", "paneIndex": 0, "active": true,
                        "tabs": [{ "active": true, "historyIndex": 1, "history": [
                            { "url": "javascript:alert(1)", "title": null },
                            { "url": "https://ok", "title": "ok" }] }] }]
        }]
    });
    let store = repair_workspace_layout(raw, "proj", "/proj");
    assert_eq!(store.sessions[0].project_id, "proj");
    assert_eq!(store.sessions[0].working_directory, "/proj");
    let WorkspacePane::Browser(b) = &store.sessions[0].panes[0] else { panic!() };
    assert_eq!(b.tabs[0].history.len(), 1); // js: url dropped
    assert_eq!(b.tabs[0].history_index, 0); // remapped after drop-before-active
}
```

Add sibling tests for the remaining §2.2 rules (one each): unknown-`version` → empty store; duplicate session `id` / `paneId` / shell `ptyId` → first-wins; zero/multiple active tab → pane → session normalization; `paneIndex` gaps/dupes → re-index `0..n`; invalid `layout` + >`quad` capacity → drop panes beyond four; stale-`cwd` → fall back to session `workingDirectory`; size caps (history/tabs/panes/sessions/url/title); empty-after-repair session dropped.

- [ ] **Step 2: Run, watch fail** — `cargo test -p vimeflow workspace_layout::tests::repair` → FAIL (`repair_workspace_layout` undefined).

- [ ] **Step 3: Implement `repair_workspace_layout(raw: serde_json::Value, active_project_id: &str, active_cwd: &str) -> WorkspaceLayoutStore`**

Two-stage per spec §2.2: read each field tolerantly from `serde_json::Value` (never hard-fail), then build the strict model applying — in order — these rules (each is a small helper, unit-tested above):

1. unknown/absent `version` ≠ `CURRENT_WORKSPACE_LAYOUT_VERSION` → return empty store.
2. per session: default missing `projectId`/`workingDirectory` to `active_project_id`/`active_cwd`; drop a session with no usable `id`.
3. per pane: drop unrecognized `kind`, missing `paneId`, shell missing `ptyId`/`cwd`; coerce unknown `agentType` → `"generic"`; dedupe `paneId` (first wins) and shell `ptyId` (first wins).
4. per browser tab: drop invalid `NavEntry.url` (allowlist `http(s):`/`about:blank`) **and remap `historyIndex`** by removed-before count (active dropped → nearest survivor); seed empty `history` with one `DEFAULT_BROWSER_URL` entry at 0; clamp `historyIndex` to `[0, len-1]`; seed empty `tabs` with one default tab; force exactly one active tab (first wins).
5. per session: stale `cwd` (missing on disk) → fall back to session `workingDirectory` else `active_cwd`; sort panes by `paneIndex` (missing = `+∞`, ties by array order) then re-index `0..n`; force exactly one active pane (first by index); invalid `layout` → smallest fitting, then widen to fit count capped at `quad`, dropping panes beyond 4; drop session emptied of panes.
6. across sessions: dedupe session `id` (first wins); at most one active session (first wins); apply size caps (history ~100 around active, tab/pane/session counts, url/title lengths).

- [ ] **Step 4: Run to green** — `cargo test -p vimeflow workspace_layout::tests` → PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/terminal/workspace_layout.rs
git commit --no-verify -m "feat(backend): lenient decode + repair for workspace layouts"
```

---

### Task 3: Durable file IO (atomic write + mirror; load with project context)

**Files:**

- Modify: `crates/backend/src/terminal/workspace_layout.rs` (a `WorkspaceLayoutCache` struct)
- Test: same file's `tests` module (uses `tempfile::tempdir`)

- [ ] **Step 1: Failing IO test**

```rust
#[test]
fn save_then_load_round_trips_and_missing_loads_empty() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace-layouts.json");
    let cache = WorkspaceLayoutCache::new(path.clone());
    assert!(cache.load("proj", "/proj").sessions.is_empty()); // missing → empty
    let store = WorkspaceLayoutStore { version: 1, sessions: vec![/* one session */] };
    cache.save(&store).unwrap();
    let loaded = WorkspaceLayoutCache::new(path).load("proj", "/proj");
    assert_eq!(loaded.version, 1);
}
```

- [ ] **Step 2: Run, fail** — `WorkspaceLayoutCache` undefined.

- [ ] **Step 3: Implement** — `WorkspaceLayoutCache { path, data: Mutex<Option<WorkspaceLayoutStore>> }` mirroring `cache.rs`: `save` writes atomically via `tempfile::NamedTempFile::persist` + updates the mirror; `load(project_id, cwd)` reads the file → `repair_workspace_layout(value, project_id, cwd)` (lenient) → caches + returns; missing file → empty default. All errors are non-fatal (return empty, log) — the store is a convenience cache, never blocks lifecycle.

- [ ] **Step 4: Green** — `cargo test -p vimeflow workspace_layout::tests::save_then_load` → PASS.

- [ ] **Step 5: Commit** — `feat(backend): atomic workspace-layout file cache`

---

### Task 4: `clear_all` excludes `workspace-layouts.json` (durability invariant)

**Files:**

- Modify: `crates/backend/src/terminal/cache.rs` (confirm/observe `clear_all` scope)
- Test: `crates/backend/src/terminal/cache.rs` tests OR an integration test in `crates/backend/tests/`

- [ ] **Step 1: Failing invariant test** — write `sessions.json` + `workspace-layouts.json` in a temp `app_data_dir`, call the shutdown/`clear_all` path, assert `sessions.json` is gone (or emptied) but `workspace-layouts.json` is **untouched**.

- [ ] **Step 2: Run, fail** (if `clear_all` ever touched the new file) or PASS trivially (the two are separate files). Either way the test pins the invariant.

- [ ] **Step 3: Implement** — ensure `SessionCache::clear_all` only targets `sessions.json`; the `WorkspaceLayoutCache` is a distinct file/owner and is never cleared on quit. Add a one-line comment at `clear_all` noting the workspace-layout store is intentionally excluded.

- [ ] **Step 4: Green** — `cargo test -p vimeflow` (cache + workspace_layout) → PASS.

- [ ] **Step 5: Commit** — `test(backend): pin workspace-layout survives clear_all`

---

### Task 5: Main-only IPC for load/save (spec §3.2 "Main ↔ Rust")

**Files:**

- Modify: `crates/backend/src/terminal/commands.rs` (inner fns `load_workspace_layout_inner`, `save_workspace_layout_inner`)
- Modify: `crates/backend/src/runtime/state.rs` (methods on `BackendState`)
- Modify: `crates/backend/src/runtime/ipc.rs` (match arms)
- **Not** `electron/backend-methods.ts` (these are main-invoked, not renderer — spec §3.2)
- Test: `crates/backend/src/runtime/ipc.rs` or `commands.rs` tests

- [ ] **Step 1: Failing dispatch test** — dispatch a `saveWorkspaceLayout` command then `loadWorkspaceLayout` (with `projectId`/`workingDirectory` args) through the IPC router; assert the round-trip returns the saved store.

- [ ] **Step 2: Run, fail** — arms not wired.

- [ ] **Step 3: Implement** — `load_workspace_layout_inner(state, project_id, cwd) -> WorkspaceLayoutStore` and `save_workspace_layout_inner(state, store) -> ()` delegating to `WorkspaceLayoutCache`; `BackendState` holds the cache; add the two `ipc.rs` match arms. Hold the cache in `BackendState` next to `SessionCache`.

- [ ] **Step 4: Green** — `cargo test -p vimeflow` → PASS.

- [ ] **Step 5: Commit** — `feat(backend): main-only load/save workspace-layout IPC`

---

## Phase B — Electron main: assembler, lifecycle, restore (base: browser-pane-redesign)

> Exact line targets in `electron/browser-pane.ts` / `electron/main.ts` resolve against the merged base. Each task names the function + spec § as the contract.

### Task 6: Main-side workspace-layout controller + renderer↔main preload IPC

**Files:**

- Create: `electron/workspace-layout-controller.ts`
- Modify: `electron/preload.ts` (contextBridge channels) + the renderer-side bridge under `src/features/browser/` (or `src/lib/`)
- Test: `electron/workspace-layout-controller.test.ts`

The connective tissue (spec §3.2 "IPC surface"): the renderer↔main channels + main's in-memory loaded store that Tasks 9 / 11 / 15 depend on. These are Electron preload channels, **not** `electron/backend-methods.ts` (that allowlist is renderer→Rust).

- [ ] **Step 1: Failing tests** — (a) `pushWorkspaceShape` (renderer→main) updates the controller's latest shape DTO; (b) `loadWorkspaceForRestore` (renderer→main, carrying `projectId` + `workingDirectory`) calls the Rust `loadWorkspaceLayout` IPC (Task 5), **retains the repaired store in memory**, and returns the **shape** to the renderer while keeping tab/history main-side; (c) `requestFinalShape` (main→renderer→ack) for the close flush (Task 10); (d) `beginHydration` / `endHydration` (renderer→main) toggle the writer's `hydrating` flag (Task 9) so the renderer can bracket a restore — `endHydration` always fires (even on partial failure) so suppression can't stick.

- [ ] **Step 2: Run, fail** — `npx vitest run electron/workspace-layout-controller.test.ts`.

- [ ] **Step 3: Implement** — `WorkspaceLayoutController` holds `latestShapeDto` + `loadedStore` (populated by `loadWorkspaceForRestore`) and exposes the four preload channels (`pushWorkspaceShape`, `loadWorkspaceForRestore`, `requestFinalShape`, `beginHydration`/`endHydration`). It **defines the interfaces** the `WorkspaceLayoutWriter` (wired in Task 9) and the restore-tab serving to `createBrowserPane` (wired in Task 11) plug into; Task 6 ships the controller skeleton + `loadedStore` + channels with those two pieces stubbed behind interfaces, attached in their later tasks.

- [ ] **Step 4: Green** — `npx vitest run electron/workspace-layout-controller.test.ts`.

- [ ] **Step 5: Commit** — `feat(app): main-side workspace-layout controller + IPC`

---

### Task 7: Restartable placeholder — skip the stale-PTY kill on restart (spec §5)

**Files:**

- Modify: the restart path in `src/features/sessions/hooks/useSessionManager.ts` (the spawn-then-kill `restartSession` flow)
- Test: `src/features/sessions/hooks/useSessionManager.test.ts`

(A sessions-hook change, grouped here as a restore prerequisite — Phase C restore creates the placeholders this restarts.) A graceful-quit placeholder's seeded `ptyId` is already gone (`clear_all`), so the existing spawn-then-kill restart (which treats kill failure as fatal) must no-op the kill for an absent seed.

- [ ] **Step 1: Failing test** — restarting a placeholder shell whose seed `ptyId` is absent from `listSessions()` spawns fresh in `cwd` and **succeeds**; `service.kill` is **not** called for the absent old PTY.

- [ ] **Step 2: Run, fail** — `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t "restart placeholder"`.

- [ ] **Step 3: Implement** — in the restart path, skip the old-PTY `service.kill` when the seed `ptyId` is absent from the live set (treat as already-gone success), so a restored placeholder restarts cleanly.

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `fix(sessions): restart restored placeholder without stale-PTY kill`

---

### Task 8: Capture per-tab navigation history in main

**Files:**

- Modify: `electron/browser-pane.ts` (the tab-tracking that backs `emitTabsChanged`)
- Test: `electron/browser-pane.test.ts`

- [ ] **Step 1: Failing test** — after navigations in a fake `WebContents`, the per-pane tab record main holds includes each tab's `history` (`navigationHistory.getAllEntries()` mapped to `{url, title}`) + `historyIndex` (`getActiveIndex()`).

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — extend the main-side tab record so each tab carries `history`/`historyIndex` captured from `webContents.navigationHistory`. This is **not** added to the main→renderer `tabs-changed` event (spec §3.2 — that stays history-free); it feeds the assembler (Task 9).

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `feat(browser): capture per-tab nav history in main`

---

### Task 9: Main-side assembler + serialized generation-ordered writes (spec §3.2)

**Files:**

- Create: `electron/workspace-layout-writer.ts` (the assembler + write queue)
- Modify: `electron/browser-pane.ts` (tab open/close/active-switch hooks call the writer's `markStructural`; in-tab navigation calls `markVolatile`)
- Test: `electron/workspace-layout-writer.test.ts` + `electron/browser-pane.test.ts` (the event→writer wiring)

- [ ] **Step 1: Failing tests** — (a) assemble merges a shape DTO with main's per-pane `tabs[]` by `(sessionId, paneId)` into a `WorkspaceLayoutStore`; (b) writes are generation-ordered: a stale (lower-generation) snapshot submitted after a newer one is dropped (last-write-wins); (c) a structural change writes immediately while a navigation change debounces; (d) **hydration guard:** while `hydrating` is set, both cadences suppress all writes (no save IPC fires); (e) a browser tab open/close/active-tab switch calls `markStructural` (immediate), in-tab navigation calls `markVolatile`.

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — `WorkspaceLayoutWriter` holds the latest shape DTO + reads main's tab/history; `assemble()` joins by `(sessionId, paneId)`; a single in-order write queue stamps a monotonic generation and drops stale snapshots; `markStructural()` flushes immediately (awaited save IPC), `markVolatile()` debounces. **Hydration guard (spec §3.2/§5):** a `hydrating` flag suppresses all persistence — toggled via the controller's `beginHydration`/`endHydration` channels (Task 6), which the renderer brackets around restore (Task 15; `endHydration` always fires, even on partial failure, so suppression can't stick) — so restore-time pushes/events can't overwrite saved history with empty tabs. Browser-pane tab-lifecycle events (open/close/active-switch) call `markStructural`; in-tab navigation calls `markVolatile`. Persists via the Task 5 `saveWorkspaceLayout` IPC.

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `feat(browser): single-writer workspace-layout assembler`

---

### Task 10: Window-close flush lifecycle (spec §3.2 durability flush)

**Files:**

- Modify: `electron/main.ts` (window `close` + `before-quit` handlers; `browserPaneController` disposal order)
- Test: `electron/main.test.ts` (or the closest main-lifecycle test) with a fake window + controller

- [ ] **Step 1: Failing tests** — (a) on window `close`, the flush (assemble + awaited save) runs **before** `browserPaneController` disposal; (b) a `flushedOnce` guard scoped to one teardown makes a following `before-quit` **skip** persistence; (c) the guard resets when a new window opens / app keeps running, so a later teardown flushes again; (d) the close handler defers via `preventDefault()` then re-issues close (no loop).

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — per spec §3.2: window `close` handler runs the flush (drains a final renderer shape ack with ~1s timeout, captures live history, awaits the save) ahead of disposal; transaction-scoped `flushedOnce` shared with the reordered `before-quit`; reset on new-window/app-continues.

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `feat(app): durable workspace flush on window close`

---

### Task 11: Restore-mode browser-pane creation (spec §3.2 / §5)

**Files:**

- Modify: `electron/browser-pane.ts` (`createBrowserPane`; `BrowserPaneCreateRequest` gains `restore?: true`; **scope the `render-process-gone` handler — ~`browser-pane.ts:1866` — to genuine teardown so views survive reload/crash for reconnect**)
- Modify: `src/features/browser/types.ts` (`BrowserPaneCreateRequest.restore?: boolean`; `initialUrl` optional under restore)
- Test: `electron/browser-pane.test.ts`

- [ ] **Step 1: Failing tests** — (a) `createBrowserPane({restore:true})` (no `initialUrl`) creates one `WebContentsView` per persisted tab with fresh runtime tab ids and calls `navigationHistory.restore({index, entries})` (titles `null→''`) **before** any `loadURL`; (b) on `did-fail-load` the tab keeps its restored URL/history (no reset to `DEFAULT_BROWSER_URL`) and suppresses durable overwrite; a malformed payload defaults; (c) reload-reconnect: when a live view exists for `(sessionId, paneId)`, restore rebinds it (no new view, no `restore`); (d) a fresh `createBrowserPane({initialUrl})` still `loadURL`s; (e) on renderer reload/crash (`render-process-gone`) the browser view + owner record **survive** (not disposed), so (c) can rebind them.

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — discriminated request; restore branch reads repaired `tabs` from the in-memory loaded store (served by main), creates per-tab views + ids, restores history before load, marks active tab, seeds `nextTabIndex`; best-effort per-pane with a per-pane timeout; reconnect to live views; malformed-vs-load-failure handling. **Scope the `render-process-gone` handler so it does not dispose browser views/owner records on renderer reload/crash** — only on genuine pane teardown — so live tab state survives for reconnect.

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `feat(browser): restore-mode pane creation with history replay`

---

## Phase C — Renderer (base: #290 + browser-pane-redesign)

### Task 12: Decouple browser identity — `browserSessionIdForSession()` → `session.id` (spec §2.1)

**Files:**

- Modify: the `browserSessionIdForSession()` helper + `Session` type (`src/features/sessions/types/index.ts` — remove `browserSessionId`) + its assignment sites (session creation, `src/features/sessions/utils/sessionFromInfo.ts`)
- Modify: `src/features/browser/components/BrowserPane.tsx` + `SplitView` (use `session.id` as the browser IPC `sessionId`)
- Test: the affected siblings' `.test.ts`

Load-bearing prerequisite for browser-only restore + cookie continuity (spec §2.1): the partition/reconnect key must derive from `session.id`, not the first shell's stale ptyId.

- [ ] **Step 1: Failing tests** — (a) `browserSessionIdForSession(session)` returns `session.id` for shell-backed, mixed, and browser-only sessions; (b) `Session` no longer carries `browserSessionId` (type + creation + `sessionFromInfo`); (c) a browser pane's IPC `sessionId` == `session.id`, so the partition is `persist:vimeflow-browser:${projectId}:${session.id}`.

- [ ] **Step 2: Run, fail** — `npx vitest run src/features/sessions/utils/` (the helper + `sessionFromInfo` tests).

- [ ] **Step 3: Implement** — `browserSessionIdForSession()` returns `session.id` unconditionally; drop the `Session.browserSessionId` field + all assignments; update `BrowserPane.tsx`/`SplitView` to pass `session.id`. No user migration (spec §2.1 — browser panes are not in `main`).

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `refactor(browser): derive browser identity from session.id`

---

### Task 13: Shape-only DTO push (renderer → main) (spec §3.2)

**Files:**

- Modify: `src/features/sessions/hooks/usePushWorkspaceGrouping.ts` (extend #290's push; retarget renderer→main; add `kind` + browser pane existence, shell `ptyId`/`cwd`/`agentType`/`agentSessionId`)
- Test: `src/features/sessions/hooks/usePushWorkspaceGrouping.test.ts`

- [ ] **Step 1: Failing test** — a structural change (open/close pane, layout, activation) pushes the shape DTO **eagerly**; `cwd`/`agentType` drift pushes **debounced**; the DTO carries no browser tabs/urls/history.

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — extend the hook to emit the shape-only DTO (spec §3.2 renderer role) to main (the assembler), eager for structural, debounced for `cwd`/`agentType`.

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `feat(sessions): push shape-only workspace DTO to main`

---

### Task 14: `setActiveSessionId` browser-capable (spec §4)

**Files:**

- Modify: `src/features/sessions/hooks/useActiveSessionController.ts:35-76`
- Test: `src/features/sessions/hooks/useActiveSessionController.test.ts`

- [ ] **Step 1: Failing tests** — (a) a browser-only session sets React active state + calls `focusBrowserPane`, with **no** `service.setActiveSession`, and bumps `activeRequestIdRef` so a prior in-flight shell rollback can't revert it; (b) a session whose shells are all placeholders (no `running`/`paused`) takes the same skip-IPC branch; (c) a session with a live (`running`/`paused`) shell still calls `setActiveSession(ptyId)`; (d) the resolver searches **all** shell panes for a live PTY (not just `shellPanes[0]`).

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — per spec §4: resolve a live shell (`running`/`paused`) across all shell panes; if none, skip PTY IPC, bump generation, set React state, `focusBrowserPane` when the active pane is a browser; early-return only when the session is absent.

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `feat(sessions): browser-capable setActiveSessionId`

---

### Task 15: Store-driven restore reconstruction (spec §5 / §3.2)

**Files:**

- Modify: `src/features/sessions/utils/groupSessionsFromInfos.ts` (extend #290's reconstruction to be store-driven)
- Modify: `src/features/sessions/hooks/useSessionRestore.ts` (renderer-initiated load with project context; restore-pending set; signals main hydration start/complete)
- Test: both siblings' `.test.ts`

- [ ] **Step 1: Failing tests** — (a) store-driven reconstruction builds shell-only, mixed, and browser-only sessions; (b) a live PTY absent from the store is still reconstructed #290-style (never dropped); store absent → pure PTY fallback; (c) a shell pane's PTY alive → reattach, absent → restartable placeholder seeded with `cwd`/`agentType`; (d) the persisted `active` session is selected via the browser-capable `setActiveSessionId`; (e) restore is renderer-initiated with `projectId`/`workingDirectory`; (f) restore **signals main to begin hydration** at start and signals **completion** once every restore pane has settled (the write-suppression itself lives in main's writer, Task 9 — not here).

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — per spec §5: iterate the store as the shape source, overlay live PTYs by `ptyId` (union), trigger browser panes via the restore-pending set → `createBrowserPane({restore:true})`, activate the persisted-active session, and **signal main's hydration guard (Task 9)** at restore start + on settle (settle = resolved/rejected/timed-out). The write-suppression lives in the main writer, not the renderer.

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `feat(sessions): store-driven workspace restore`

---

### Task 16: `createBrowserSession()` (browser-only from scratch) (spec §6.2)

**Files:**

- Modify: `src/features/sessions/hooks/useSessionManager.ts` (add `createBrowserSession`)
- Modify: `src/features/command-palette/*` (a `:new-browser` command)
- Test: `src/features/sessions/hooks/useSessionManager.test.ts` + the command-palette command's sibling `.test.ts`

- [ ] **Step 1: Failing tests** — (a) `createBrowserSession()` builds a single-pane session with one runtime browser `Pane` (`kind:'browser'`, `ptyId:'browser:<uuid>'`, `agentType:'generic'`, `status:'running'`, active), **no `service.spawn`**, and invokes `createBrowserPane({initialUrl: DEFAULT_BROWSER_URL})`; the session is selectable. (b) **the `:new-browser` palette command is registered and, when invoked, calls `createBrowserSession()`** (proving the spec's primary entry point, not just the underlying function).

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — per spec §6.2: runtime-`Pane`-shaped browser session, no PTY, partition derives from `session.id`; wire the `:new-browser` palette command.

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `feat(sessions): create browser-only session from scratch`

---

### Task 17: Session status for mixed/browser-only (spec §5 "Restored session status")

**Files:**

- Modify: `src/features/sessions/utils/sessionStatus.ts` (`deriveShellSessionStatus`)
- Test: `src/features/sessions/utils/sessionStatus.test.ts`

- [ ] **Step 1: Failing test** — `[completed-placeholder shell, running browser]` → `running` (a live browser keeps the session active); `[completed shell]` (no browser) → `completed`; `[browser]` → `running` (preserved).

- [ ] **Step 2: Run, fail** (today it derives `completed` from the shell when any shell exists).

- [ ] **Step 3: Implement** — a live browser pane (or any `running`/`paused` shell) makes the session `running`, regardless of placeholder shells.

- [ ] **Step 4: Green.**

- [ ] **Step 5: Commit** — `fix(sessions): live browser keeps mixed session running`

---

### Task 18: Retire the legacy localStorage browser cache + migration gate (spec §3.4)

**Files:**

- Modify: `src/features/sessions/hooks/useSessionManager.ts` (delete `readStoredBrowserPanes` / `writeStoredBrowserPanesJson` / `storedBrowserPanesForSessions` / `restoreStoredBrowserPanes` / `BROWSER_PANE_STORE_KEY`)
- Test: `src/features/sessions/hooks/useSessionManager.test.ts`

- [ ] **Step 0: Preflight gate decision (record it)** — determine whether `feat/browser-pane-redesign` has reached users with the localStorage cache. **No →** remove outright (branch A). **Yes →** the read-migrate is **required** before deleting the key (branch B). Write the decision into the PR description; do not leave it to runtime guesswork.

- [ ] **Step 1: Failing/again-green test** — the unified store is the only browser persistence; `vimeflow:browser-panes:v1` is no longer written. **Branch B only:** a one-time renderer read of `vimeflow:browser-panes:v1` → main migration payload → clear key (the single shape-only-rule exception), with a test proving the migrate-then-clear order.

- [ ] **Step 2: Run, fail/observe.**

- [ ] **Step 3: Implement** — remove the localStorage cache code + key per the §3.4 gate (outright if shipped atomically; else the one-time read-migrate).

- [ ] **Step 4: Green** — full `npm run test`.

- [ ] **Step 5: Commit** — `refactor(sessions): retire localStorage browser cache for unified store`

---

## Phase D — Integration & verification

### Task 19: Round-trip integration + gates

**Files:**

- Test: `src/features/sessions/hooks/useSessionManager.test.ts` (or a dedicated integration test) + `electron/*.test.ts`

- [ ] **Step 1: Write integration tests** (spec §8 round-trip) — push → write → reload → reconstruct: browser tabs + history survive; a browser-only session survives reload **and** graceful quit; a mixed session's shell returns as a restartable placeholder (not auto-running); legacy localStorage key absent.

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Make green** — fix any seams surfaced across the phases.

- [ ] **Step 4: Full gates**

```bash
npm run lint && npm run type-check && npm run test
cargo test -p vimeflow
npm run format:check
```

Expected: all green.

- [ ] **Step 5: Commit** — `test: browser-only session restore round-trip`

---

## Manual verification (real Electron — out of scope for the loop; flag for the user)

- Open `[shell, browser]`, close the shell → browser-only session stays selectable; switch tabs away and back.
- `:new-browser` → a fresh browser-only session; navigate (build back/forward history).
- `Cmd+R` reload → tabs + history intact (reconnect to live views).
- **Graceful quit, relaunch** → browser-only session + tabs + history restored; shell panes return as restartable placeholders; restart one (no stale-PTY-kill failure).
- macOS: close window (app alive) then reopen → later quit still persists.

<!-- codex-reviewed: 2026-06-06T16:51:08Z -->
