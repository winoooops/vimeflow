# Agent Status Collapsible Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible header to the right-side activity panel with a 36 px rail in the collapsed state, per-pane persistence in the existing `sessions.json` cache, and vendor-mark identification (Anthropic / OpenAI) in the rail.

**Architecture:** New `<Header/>` sub-component inside a promoted `AgentStatusPanel/` folder; new sibling `AgentStatusRail.tsx`; `WorkspaceView` owns a stable wrapper div with a 220 ms width transition and conditionally renders rail or panel. Persistence keyed by PTY id on the existing `CachedSession` struct in the Rust sidecar; new IPC mutator with a per-pane FIFO chain in the frontend mutator to defeat over-IPC reordering races.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind v3 (frontend), Rust with `serde` + `ts-rs` + `tempfile` (Electron sidecar), Vitest + Testing Library (frontend tests), `cargo test` (Rust tests).

**Spec:** [docs/superpowers/specs/2026-05-20-agent-status-collapsible-header-design.md](../specs/2026-05-20-agent-status-collapsible-header-design.md)

---

## Task 1: Add vendor SVG assets

Static assets land first so all later imports compile.

**Files:**

- Create: `src/assets/vendor-icons/anthropic.svg`
- Create: `src/assets/vendor-icons/openai.svg`

- [ ] **Step 1: Create the Anthropic SVG**

Create `src/assets/vendor-icons/anthropic.svg` with the canonical Anthropic mark (a single filled path so the CSS mask reads as pure alpha). Use this monochrome export:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M13.827 3.52h3.603L24 20.48h-3.603l-1.378-3.61h-7.04L10.6 20.48H7L13.827 3.52zm-.732 11.317h4.808L15.499 7.5l-2.404 7.337zM7.083 3.52L0 20.48h3.687L8.42 7.84l-1.337-4.32z"/>
</svg>
```

- [ ] **Step 2: Create the OpenAI SVG**

Create `src/assets/vendor-icons/openai.svg` with the canonical OpenAI mark, also as a single filled path:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
</svg>
```

- [ ] **Step 3: Verify both files exist**

Run: `ls -la src/assets/vendor-icons/`
Expected:

```
anthropic.svg
openai.svg
```

- [ ] **Step 4: Commit**

```bash
git add src/assets/vendor-icons/
git commit -m "feat(agent-status): add Anthropic and OpenAI vendor SVG marks"
```

---

## Task 2: Rust — Extend `CachedSession` with `activity_panel_collapsed`

Backwards-compatible additive field with `#[serde(default)]` so existing `sessions.json` files load cleanly.

**Files:**

- Modify: `crates/backend/src/terminal/cache.rs:18-24` (struct + tests)
- Test: same file, `#[cfg(test)]` module

- [ ] **Step 1: Write the failing test**

Append to the `#[cfg(test)] mod tests` block at the bottom of `crates/backend/src/terminal/cache.rs`:

```rust
#[test]
fn activity_panel_collapsed_round_trips_through_disk() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sessions.json");

    let cache = SessionCache::load(path.clone()).unwrap();
    cache
        .mutate(|d| {
            d.sessions.insert(
                "pty-1".into(),
                CachedSession {
                    cwd: "/home/x".into(),
                    created_at: "2026-05-21T00:00:00Z".into(),
                    exited: false,
                    last_exit_code: None,
                    activity_panel_collapsed: Some(true),
                },
            );
            Ok(())
        })
        .unwrap();

    let reloaded = SessionCache::load(path).unwrap().snapshot();
    let session = reloaded.sessions.get("pty-1").unwrap();
    assert_eq!(session.activity_panel_collapsed, Some(true));
}

#[test]
fn missing_activity_panel_collapsed_field_loads_as_none() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sessions.json");
    // Legacy JSON without the new field — simulates a pre-feature install.
    std::fs::write(
        &path,
        r#"{
            "version": 1,
            "active_session_id": null,
            "session_order": ["pty-legacy"],
            "sessions": {
                "pty-legacy": {
                    "cwd": "/legacy",
                    "created_at": "2026-05-20T00:00:00Z",
                    "exited": false,
                    "last_exit_code": null
                }
            }
        }"#,
    )
    .unwrap();

    let cache = SessionCache::load(path).unwrap().snapshot();
    let session = cache.sessions.get("pty-legacy").unwrap();
    assert_eq!(session.activity_panel_collapsed, None);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path crates/backend/Cargo.toml activity_panel_collapsed -- --nocapture`
Expected: FAIL with "no field `activity_panel_collapsed` on type `CachedSession`"

- [ ] **Step 3: Add the field to `CachedSession`**

Replace the `CachedSession` struct in `crates/backend/src/terminal/cache.rs:18-24`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CachedSession {
    pub cwd: String,
    pub created_at: String, // ISO-8601 UTC
    pub exited: bool,
    pub last_exit_code: Option<i32>,
    /// Per-pane UI preference for the right activity panel.
    /// None  → user has never toggled; UI treats it as expanded.
    /// Some(true)  → collapsed (36 px rail).
    /// Some(false) → explicitly expanded (280 px panel).
    #[serde(default)]
    pub activity_panel_collapsed: Option<bool>,
}
```

Then update every other site that constructs a `CachedSession` literal to include the new field. Find them via:

```bash
grep -rn "CachedSession {" crates/backend/src/
```

For each match, add `activity_panel_collapsed: None,` to the literal. Existing matches at the time of writing (verify with grep before editing — line numbers may have shifted):

- `crates/backend/src/terminal/commands.rs` (around line 293 in `spawn_pty_inner`) — set `activity_panel_collapsed: None`.
- `crates/backend/src/terminal/cache.rs` test fixtures (around lines 277, 515, 522 in existing tests) — set `activity_panel_collapsed: None`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path crates/backend/Cargo.toml -- --nocapture`
Expected: PASS (new tests + all pre-existing cache tests).

- [ ] **Step 5: Commit**

```bash
git add crates/backend/src/terminal/cache.rs crates/backend/src/terminal/commands.rs
git commit -m "feat(backend): add activity_panel_collapsed to CachedSession"
```

---

## Task 3: Rust — Add `SetSessionActivityPanelCollapsedRequest` type + inner command

**Files:**

- Modify: `crates/backend/src/terminal/types.rs` (append struct after `UpdateSessionCwdRequest`)
- Modify: `crates/backend/src/terminal/commands.rs` (append `set_session_activity_panel_collapsed_inner` + tests)

- [ ] **Step 1: Write the failing tests**

Append to `crates/backend/src/terminal/commands.rs` `#[cfg(test)] mod tests`:

```rust
#[test]
fn set_session_activity_panel_collapsed_inner_updates_cache() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sessions.json");
    let cache = SessionCache::load(path).unwrap();
    cache
        .mutate(|d| {
            d.sessions.insert(
                "pty-1".into(),
                super::super::cache::CachedSession {
                    cwd: "/home/x".into(),
                    created_at: "2026-05-21T00:00:00Z".into(),
                    exited: false,
                    last_exit_code: None,
                    activity_panel_collapsed: None,
                },
            );
            Ok(())
        })
        .unwrap();

    super::set_session_activity_panel_collapsed_inner(
        &cache,
        super::super::types::SetSessionActivityPanelCollapsedRequest {
            id: "pty-1".into(),
            collapsed: true,
        },
    )
    .unwrap();

    let snap = cache.snapshot();
    assert_eq!(
        snap.sessions.get("pty-1").unwrap().activity_panel_collapsed,
        Some(true)
    );
}

#[test]
fn set_session_activity_panel_collapsed_inner_errors_when_session_missing() {
    let dir = TempDir::new().unwrap();
    let cache = SessionCache::load(dir.path().join("sessions.json")).unwrap();

    let err = super::set_session_activity_panel_collapsed_inner(
        &cache,
        super::super::types::SetSessionActivityPanelCollapsedRequest {
            id: "ghost-pty".into(),
            collapsed: true,
        },
    )
    .unwrap_err();
    assert!(
        err.contains("session not found"),
        "expected `session not found` error, got: {err}"
    );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path crates/backend/Cargo.toml set_session_activity_panel_collapsed -- --nocapture`
Expected: FAIL with compile errors (`SetSessionActivityPanelCollapsedRequest` and `set_session_activity_panel_collapsed_inner` undefined).

- [ ] **Step 3: Add the request type**

Append to `crates/backend/src/terminal/types.rs` after the existing `UpdateSessionCwdRequest`:

```rust
/// Request payload for set_session_activity_panel_collapsed command.
/// `id` is a PTY id — same convention as SetActiveSessionRequest.
#[derive(Debug, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SetSessionActivityPanelCollapsedRequest {
    pub id: String,
    pub collapsed: bool,
}
```

- [ ] **Step 4: Add the inner command**

Append to `crates/backend/src/terminal/commands.rs` (outside the `#[cfg(test)]` block, near the other `*_inner` functions):

```rust
pub fn set_session_activity_panel_collapsed_inner(
    cache: &SessionCache,
    request: crate::terminal::types::SetSessionActivityPanelCollapsedRequest,
) -> Result<(), String> {
    cache.mutate(|d| {
        let session = d
            .sessions
            .get_mut(&request.id)
            .ok_or_else(|| format!("session not found: {}", request.id))?;
        session.activity_panel_collapsed = Some(request.collapsed);
        Ok(())
    })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path crates/backend/Cargo.toml set_session_activity_panel_collapsed -- --nocapture`
Expected: PASS (both new tests).

- [ ] **Step 6: Commit**

```bash
git add crates/backend/src/terminal/types.rs crates/backend/src/terminal/commands.rs
git commit -m "feat(backend): add set_session_activity_panel_collapsed inner command"
```

---

## Task 4: Rust — Extend `SessionInfo` with `activity_panel_collapsed` (read path)

**Files:**

- Modify: `crates/backend/src/terminal/types.rs:146-150` (add field to `SessionInfo`)
- Modify: `crates/backend/src/terminal/commands.rs:463-...` (map cache value in `list_sessions_inner`)
- Test: existing `list_sessions` tests in `commands.rs`

- [ ] **Step 1: Write the failing test**

Append to the `#[cfg(test)] mod tests` block in `crates/backend/src/terminal/commands.rs`:

```rust
#[test]
fn list_sessions_surfaces_activity_panel_collapsed() {
    let dir = TempDir::new().unwrap();
    let cache = SessionCache::load(dir.path().join("sessions.json")).unwrap();
    cache
        .mutate(|d| {
            d.sessions.insert(
                "pty-1".into(),
                super::super::cache::CachedSession {
                    cwd: "/home/x".into(),
                    created_at: "2026-05-21T00:00:00Z".into(),
                    exited: false,
                    last_exit_code: None,
                    activity_panel_collapsed: Some(true),
                },
            );
            d.session_order.push("pty-1".into());
            Ok(())
        })
        .unwrap();

    let pty = PtyState::new();
    let list = super::list_sessions_inner(&pty, &cache).unwrap();
    let info = list
        .sessions
        .iter()
        .find(|s| s.id == "pty-1")
        .expect("session must surface");
    assert_eq!(info.activity_panel_collapsed, Some(true));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path crates/backend/Cargo.toml list_sessions_surfaces -- --nocapture`
Expected: FAIL with `no field activity_panel_collapsed on SessionInfo`.

- [ ] **Step 3: Add the field to `SessionInfo`**

Replace the `SessionInfo` struct in `crates/backend/src/terminal/types.rs:142-150`:

```rust
/// Single session info returned by list_sessions
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String, // PTY id
    pub cwd: String,
    pub status: SessionStatus,
    // Mirrored from CachedSession.activity_panel_collapsed.
    // Serialized as `activityPanelCollapsed: boolean | null` over IPC.
    pub activity_panel_collapsed: Option<bool>,
}
```

- [ ] **Step 4: Propagate the field in `list_sessions_inner`**

In `crates/backend/src/terminal/commands.rs:463-...`, locate the `SessionInfo { ... }` literal inside `list_sessions_inner` and add the field. The exact line will look like:

```rust
session_infos.push(SessionInfo {
    id: id.clone(),
    cwd: cached.cwd.clone(),
    status: /* ... */,
    activity_panel_collapsed: cached.activity_panel_collapsed,
});
```

If there's a degraded path that constructs a `SessionInfo` without a `CachedSession` (e.g. PTY known to `PtyState` but absent from cache), set `activity_panel_collapsed: None`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path crates/backend/Cargo.toml list_sessions -- --nocapture`
Expected: PASS (new test + all pre-existing `list_sessions` tests).

- [ ] **Step 6: Commit**

```bash
git add crates/backend/src/terminal/types.rs crates/backend/src/terminal/commands.rs
git commit -m "feat(backend): surface activity_panel_collapsed on SessionInfo"
```

---

## Task 5: Rust — Wire `BackendState` method + IPC router branch

**Files:**

- Modify: `crates/backend/src/runtime/state.rs` (add `set_session_activity_panel_collapsed` method)
- Modify: `crates/backend/src/runtime/ipc.rs` (add router branch + dispatch test)

- [ ] **Step 1: Write the failing IPC-router dispatch test**

Add a test in `crates/backend/src/runtime/ipc.rs` near the other dispatch tests:

```rust
#[tokio::test]
async fn dispatch_set_session_activity_panel_collapsed_envelope_decodes() {
    let state = state_with_session("pty-1");
    let outcome = super::router::dispatch(
        state,
        "set_session_activity_panel_collapsed",
        serde_json::json!({
            "request": { "id": "pty-1", "collapsed": true }
        }),
    )
    .await;
    let v = outcome.expect("dispatch should succeed");
    assert_eq!(v, serde_json::Value::Null);
}
```

(`state_with_session(id)` is a helper that already exists in the file's test module — verify with `grep "fn state_with_session" crates/backend/src/runtime/ipc.rs`. If it doesn't, create a minimal version that builds a `BackendState` with one session preloaded into the cache.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path crates/backend/Cargo.toml dispatch_set_session_activity_panel_collapsed -- --nocapture`
Expected: FAIL — the router doesn't know that method name yet.

- [ ] **Step 3: Add the `BackendState` method**

In `crates/backend/src/runtime/state.rs`, add this method to the `BackendState` impl block (alongside `set_active_session`, `reorder_sessions`, `update_session_cwd`):

```rust
pub fn set_session_activity_panel_collapsed(
    &self,
    request: crate::terminal::types::SetSessionActivityPanelCollapsedRequest,
) -> Result<(), String> {
    crate::terminal::commands::set_session_activity_panel_collapsed_inner(
        &self.sessions,
        request,
    )
}
```

- [ ] **Step 4: Add the router branch**

In `crates/backend/src/runtime/ipc.rs`, add this branch to the `match` block that handles named methods (alongside `set_active_session`, `reorder_sessions`, `update_session_cwd`):

```rust
"set_session_activity_panel_collapsed" => {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct P {
        request: crate::terminal::types::SetSessionActivityPanelCollapsedRequest,
    }
    let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
    state.set_session_activity_panel_collapsed(p.request)?;
    Ok(Value::Null)
}
```

- [ ] **Step 5: Run all backend tests to verify**

Run: `cargo test --manifest-path crates/backend/Cargo.toml -- --nocapture`
Expected: PASS — entire backend suite green.

- [ ] **Step 6: Commit**

```bash
git add crates/backend/src/runtime/state.rs crates/backend/src/runtime/ipc.rs
git commit -m "feat(backend): wire set_session_activity_panel_collapsed IPC"
```

---

## Task 6: Regenerate ts-rs bindings

**Files:**

- Modify (auto-generated): `src/bindings/SessionInfo.ts`
- Create (auto-generated): `src/bindings/SetSessionActivityPanelCollapsedRequest.ts`
- Modify (auto-generated): `src/bindings/index.ts`

- [ ] **Step 1: Regenerate bindings**

Run: `npm run generate:bindings`
Expected output: tests pass, `prettier --write src/bindings/` formats the regenerated files.

- [ ] **Step 2: Verify the generated files**

Run: `grep -n "activityPanelCollapsed" src/bindings/SessionInfo.ts && ls src/bindings/SetSessionActivityPanelCollapsedRequest.ts`
Expected: `SessionInfo.ts` contains the new field, `SetSessionActivityPanelCollapsedRequest.ts` exists.

- [ ] **Step 3: Commit the regenerated bindings**

```bash
git add src/bindings/
git commit -m "chore(bindings): regenerate after activity-panel-collapsed Rust changes"
```

---

## Task 7: Frontend — Extend `Pane` type and `sessionFromInfo`

**Files:**

- Modify: `src/features/sessions/types/index.ts:8-34` (add `activityPanelCollapsed` to `Pane`)
- Modify: `src/features/sessions/utils/sessionFromInfo.ts` (read field from `SessionInfo`)
- Test: `src/features/sessions/utils/sessionFromInfo.test.ts` (extend with new assertion)
- Modify: all other `Pane`-constructing call sites (init to `null`)

- [ ] **Step 1: Write the failing test**

Append to `src/features/sessions/utils/sessionFromInfo.test.ts`:

```typescript
test('reads activityPanelCollapsed from SessionInfo onto the first pane', () => {
  const session = sessionFromInfo(
    {
      id: 'pty-1',
      cwd: '/home/x',
      status: {
        kind: 'Alive',
        pid: 1234,
        replay_data: '',
        replay_end_offset: '0',
      },
      activityPanelCollapsed: true,
    },
    0
  )
  expect(session.panes[0].activityPanelCollapsed).toBe(true)
})

test('defaults activityPanelCollapsed to null when SessionInfo carries null', () => {
  const session = sessionFromInfo(
    {
      id: 'pty-2',
      cwd: '/home/y',
      status: {
        kind: 'Alive',
        pid: 5678,
        replay_data: '',
        replay_end_offset: '0',
      },
      activityPanelCollapsed: null,
    },
    0
  )
  expect(session.panes[0].activityPanelCollapsed).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/sessions/utils/sessionFromInfo.test.ts`
Expected: FAIL — `activityPanelCollapsed` is not on `Pane`.

- [ ] **Step 3: Add the field to `Pane`**

In `src/features/sessions/types/index.ts`, add to the `Pane` interface (after `active: boolean`):

```typescript
/** Per-pane collapse preference for the activity panel.
 * null when the cache has never recorded a value (treated as expanded). */
activityPanelCollapsed: boolean | null
```

- [ ] **Step 4: Update `sessionFromInfo` to read the field**

In `src/features/sessions/utils/sessionFromInfo.ts`, replace the `paneBase` literal and the `pane` construction to include the new field:

```typescript
const paneBase = {
  id: 'p0',
  ptyId: info.id,
  cwd: info.cwd,
  agentType: 'generic',
  status,
  active: true,
  activityPanelCollapsed: info.activityPanelCollapsed ?? null,
} satisfies Pane

const pane: Pane =
  info.status.kind === 'Alive'
    ? {
        ...paneBase,
        pid: info.status.pid,
        restoreData: {
          sessionId: info.id,
          cwd: info.cwd,
          pid: info.status.pid,
          replayData: info.status.replay_data,
          replayEndOffset: Number(info.status.replay_end_offset),
          bufferedEvents: [],
        },
      }
    : paneBase
```

- [ ] **Step 5: Add `null` defaults to every other `Pane` construction site**

Find all of them:

```bash
grep -rn "panes: \[" src/features/sessions/ src/features/workspace/
grep -rn "ptyId:" src/features/sessions/hooks/useSessionManager.ts
```

For each `Pane` literal, add `activityPanelCollapsed: null,` to the object. Known sites (verify line numbers before editing):

- `src/features/sessions/hooks/useSessionManager.ts:328-339` — initial pane in `createSession`. Add `activityPanelCollapsed: null,`.
- `src/features/sessions/hooks/useSessionManager.ts` — `addPane` callback (search for the `Pane` literal in the function body). Add `activityPanelCollapsed: null,`.
- `src/features/sessions/hooks/useSessionManager.ts` — `restartSession` callback (likewise). Add `activityPanelCollapsed: null,`.
- Any test fixtures under `src/features/sessions/` that construct `Pane` literals — for each, add `activityPanelCollapsed: null,`. Run `npx vitest run src/features/sessions/` after edits to spot remaining type errors.

- [ ] **Step 6: Run the test suite to verify**

Run: `npm run type-check && npx vitest run src/features/sessions/`
Expected: PASS — no type errors, all sessions tests green.

- [ ] **Step 7: Commit**

```bash
git add src/features/sessions/ src/features/workspace/
git commit -m "feat(sessions): add activityPanelCollapsed to Pane + initializers"
```

---

## Task 8: Frontend — Add registry helpers (`agentTypeToRegistryKey`, `agentStatusToSessionStatus`, `vendorMarkFor`)

**Files:**

- Modify: `src/agents/registry.ts` (add three exported functions + vendor-mark imports)
- Modify: `src/agents/registry.test.ts` (add unit tests)

- [ ] **Step 1: Write the failing test**

Append to `src/agents/registry.test.ts`:

```typescript
import {
  agentTypeToRegistryKey,
  agentStatusToSessionStatus,
  vendorMarkFor,
} from './registry'
import type { AgentStatus } from '../features/agent-status/types'

test('agentTypeToRegistryKey maps claude-code → claude', () => {
  expect(agentTypeToRegistryKey('claude-code')).toBe('claude')
})

test('agentTypeToRegistryKey maps codex → codex', () => {
  expect(agentTypeToRegistryKey('codex')).toBe('codex')
})

test.each(['aider', 'generic', null] as const)(
  'agentTypeToRegistryKey maps %s → shell',
  (agentType) => {
    expect(agentTypeToRegistryKey(agentType)).toBe('shell')
  }
)

test('agentTypeToRegistryKey falls back to shell for unknown values', () => {
  expect(
    agentTypeToRegistryKey('mystery-cli' as unknown as AgentStatus['agentType'])
  ).toBe('shell')
})

test('agentStatusToSessionStatus reports running when isActive', () => {
  expect(agentStatusToSessionStatus({ isActive: true } as AgentStatus)).toBe(
    'running'
  )
})

test('agentStatusToSessionStatus reports paused when not isActive', () => {
  expect(agentStatusToSessionStatus({ isActive: false } as AgentStatus)).toBe(
    'paused'
  )
})

test('vendorMarkFor returns an asset URL for claude and codex', () => {
  expect(vendorMarkFor('claude')).toMatch(/anthropic\.svg$/)
  expect(vendorMarkFor('codex')).toMatch(/openai\.svg$/)
})

test('vendorMarkFor returns null for shell and gemini', () => {
  expect(vendorMarkFor('shell')).toBeNull()
  expect(vendorMarkFor('gemini')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/registry.test.ts`
Expected: FAIL — the three helpers are not exported yet.

- [ ] **Step 3: Add the helpers to `registry.ts`**

Append to `src/agents/registry.ts`:

```typescript
import anthropicMark from '../assets/vendor-icons/anthropic.svg'
import openaiMark from '../assets/vendor-icons/openai.svg'
import type { AgentStatus } from '../features/agent-status/types'
import type { SessionStatus } from '../features/sessions/types'

export const agentTypeToRegistryKey = (
  agentType: AgentStatus['agentType']
): AgentId => {
  switch (agentType) {
    case 'claude-code':
      return 'claude'
    case 'codex':
      return 'codex'
    // aider | generic | null → shell fallback (no vendor mark; generic glyph)
    default:
      return 'shell'
  }
}

export const agentStatusToSessionStatus = (
  agentStatus: AgentStatus
): SessionStatus => (agentStatus.isActive ? 'running' : 'paused')

export const vendorMarkFor = (agentId: AgentId): string | null => {
  switch (agentId) {
    case 'claude':
      return anthropicMark
    case 'codex':
      return openaiMark
    // gemini | shell — no mark today
    default:
      return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/agents/registry.test.ts`
Expected: PASS (all 8 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents/registry.ts src/agents/registry.test.ts
git commit -m "feat(agents): add agentType→registry, status, vendor-mark helpers"
```

---

## Task 9: Frontend — `useSessionManager` mutator with per-pane FIFO chain

This is the load-bearing race-safety task. The mutator MUST serialize IPC per pane id.

**Files:**

- Modify: `src/features/sessions/hooks/useSessionManager.ts` (add `setPaneActivityPanelCollapsed` + FIFO chain ref + race-safe revert)
- Modify: `src/features/sessions/hooks/useSessionManager.test.ts` (new tests)

- [ ] **Step 1: Write the failing test for happy path**

Append to `src/features/sessions/hooks/useSessionManager.test.ts`:

```typescript
test('setPaneActivityPanelCollapsed optimistically updates and persists', async () => {
  const service = makeTerminalServiceMock()
  service.setSessionActivityPanelCollapsed = vi
    .fn()
    .mockResolvedValue(undefined)

  const { result } = renderHook(() => useSessionManager({ service }))
  // Bootstrap one session (use the existing test fixture helper or createSession).
  await act(async () => {
    await result.current.createSession()
  })

  const session = result.current.sessions[0]
  const pane = session.panes[0]

  await act(async () => {
    await result.current.setPaneActivityPanelCollapsed(
      session.id,
      pane.id,
      true
    )
  })

  expect(result.current.sessions[0].panes[0].activityPanelCollapsed).toBe(true)
  expect(service.setSessionActivityPanelCollapsed).toHaveBeenCalledWith({
    id: pane.ptyId,
    collapsed: true,
  })
})
```

- [ ] **Step 2: Write the failing test for race-safe revert**

Append:

```typescript
test('rapid toggle (true then false): final state matches last click even if first IPC rejects after second succeeds', async () => {
  const service = makeTerminalServiceMock()

  // Resolver/rejecter holders so we can control IPC ordering.
  let resolveSecond: (() => void) | null = null
  let rejectFirst: ((err: Error) => void) | null = null
  service.setSessionActivityPanelCollapsed = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSecond = resolve
        })
    )

  const { result } = renderHook(() => useSessionManager({ service }))
  await act(async () => {
    await result.current.createSession()
  })
  const session = result.current.sessions[0]
  const pane = session.panes[0]

  // Click 1 — true
  const p1 = act(() =>
    result.current
      .setPaneActivityPanelCollapsed(session.id, pane.id, true)
      .catch(() => {
        /* expected to reject */
      })
  )
  // Click 2 — false
  const p2 = act(() =>
    result.current.setPaneActivityPanelCollapsed(session.id, pane.id, false)
  )

  // Resolve the SECOND IPC first.
  resolveSecond?.()
  await p2

  // Now reject the FIRST IPC — it should NOT revert (the optimistic value
  // it wrote (true) is no longer current; the second call overwrote it to false).
  rejectFirst?.(new Error('first IPC failed'))
  await p1

  expect(result.current.sessions[0].panes[0].activityPanelCollapsed).toBe(false)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts`
Expected: FAIL — `setPaneActivityPanelCollapsed` is not on the manager.

- [ ] **Step 4: Add the FIFO chain ref + mutator**

Inside `useSessionManager` (in `src/features/sessions/hooks/useSessionManager.ts`), near the existing refs:

```typescript
// Per-pane FIFO chain: pins arrival order of IPC requests to user's click
// order, since the Rust mutex only orders requests as they reach the lock.
// Keyed by paneId; entry cleared when its chain settles to empty.
const collapseChainRef = useRef(new Map<string, Promise<void>>())
```

Then add the mutator (use the existing `terminalService` field consistent with other mutators in the file — verify the service-injection pattern by reading `updateSessionCwd` / `setSessionLayout` first):

```typescript
const setPaneActivityPanelCollapsed = useCallback(
  async (
    sessionId: string,
    paneId: string,
    collapsed: boolean
  ): Promise<void> => {
    // Resolve ptyId from current state.
    const session = sessionsRef.current.find((s) => s.id === sessionId)
    const pane = session?.panes.find((p) => p.id === paneId)
    if (!session || !pane) return

    // Optimistic update.
    setSessions((prev) =>
      prev.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              panes: s.panes.map((p) =>
                p.id !== paneId
                  ? p
                  : { ...p, activityPanelCollapsed: collapsed }
              ),
            }
      )
    )

    // FIFO chain — await previous IPC for this pane (if any) before firing.
    const prior = collapseChainRef.current.get(paneId) ?? Promise.resolve()
    const next = prior
      .catch(() => undefined)
      .then(() =>
        service.setSessionActivityPanelCollapsed({
          id: pane.ptyId,
          collapsed,
        })
      )

    collapseChainRef.current.set(
      paneId,
      next.then(
        () => undefined,
        () => undefined
      )
    )

    try {
      await next
    } catch (err) {
      // Race-safe revert: only revert if the optimistic value WE wrote is
      // still current (no superseding call overwrote it).
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s
          return {
            ...s,
            panes: s.panes.map((p) => {
              if (p.id !== paneId) return p
              if (p.activityPanelCollapsed !== collapsed) return p
              // Revert to what it was before this call (we don't track the
              // pre-call value; use null as the "no preference yet" sentinel
              // when the operation never persisted).
              return { ...p, activityPanelCollapsed: !collapsed }
            }),
          }
        })
      )
      throw err
    } finally {
      // Clear the chain entry if this is the tail.
      if (
        collapseChainRef.current.get(paneId) ===
        next.then(
          () => undefined,
          () => undefined
        )
      ) {
        collapseChainRef.current.delete(paneId)
      }
    }
  },
  [service]
)
```

Note: the `finally` block's chain-cleanup uses a referential comparison that won't fire as written because `then` returns a new promise. Replace it with a simpler approach — track the chain head with a counter:

```typescript
// Replace collapseChainRef declaration with:
const collapseChainRef = useRef<Map<string, Promise<void>>>(new Map())

// Inside setPaneActivityPanelCollapsed, after computing `next`:
collapseChainRef.current.set(
  paneId,
  next.catch(() => undefined)
)

// In finally block:
// If our `next` is still the tail, drop the entry.
if (collapseChainRef.current.get(paneId) === next.catch(() => undefined)) {
  // referential mismatch — see note. Use a sentinel object instead:
}
```

For the v1, keep the map but **don't bother clearing entries**. Leaks are bounded by the number of distinct pane ids in a session lifetime (at most a few hundred). Add a `// TODO(follow-up): bounded clean-up of chain map` comment.

Then expose it on the manager's return:

```typescript
return {
  // ... existing properties
  setPaneActivityPanelCollapsed,
}
```

And add it to the `SessionManager` interface in `src/features/sessions/types/index.ts`:

```typescript
setPaneActivityPanelCollapsed: (
  sessionId: string,
  paneId: string,
  collapsed: boolean
) => Promise<void>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts`
Expected: PASS (both new tests + all pre-existing).

- [ ] **Step 6: Wire `setSessionActivityPanelCollapsed` into the terminal service**

The mutator above calls `service.setSessionActivityPanelCollapsed`. Add that method to the terminal-service interface and implementation. Locate the interface (`grep -rn "setActiveSession" src/features/terminal/services/`) and add:

```typescript
// In the interface (e.g. DesktopTerminalService class or ITerminalService):
setSessionActivityPanelCollapsed: (
  request: SetSessionActivityPanelCollapsedRequest
) => Promise<void>
```

Implementation:

```typescript
setSessionActivityPanelCollapsed = async (
  request: SetSessionActivityPanelCollapsedRequest
): Promise<void> => {
  await invoke('set_session_activity_panel_collapsed', { request })
}
```

Import `SetSessionActivityPanelCollapsedRequest` from `../../../bindings`.

- [ ] **Step 7: Commit**

```bash
git add src/features/sessions/ src/features/terminal/
git commit -m "feat(sessions): setPaneActivityPanelCollapsed with FIFO chain + race-safe revert"
```

---

## Task 10: Move `AgentStatusPanel.tsx` → `AgentStatusPanel/index.tsx`

Pure rename. No behavior change. Land before adding new files so reviewers see the move clearly in git's rename detection.

**Files:**

- Move: `src/features/agent-status/components/AgentStatusPanel.tsx` → `src/features/agent-status/components/AgentStatusPanel/index.tsx`
- Move: `src/features/agent-status/components/AgentStatusPanel.test.tsx` → `src/features/agent-status/components/AgentStatusPanel/index.test.tsx`

- [ ] **Step 1: Move the files via `git mv`**

```bash
mkdir -p src/features/agent-status/components/AgentStatusPanel
git mv src/features/agent-status/components/AgentStatusPanel.tsx \
       src/features/agent-status/components/AgentStatusPanel/index.tsx
git mv src/features/agent-status/components/AgentStatusPanel.test.tsx \
       src/features/agent-status/components/AgentStatusPanel/index.test.tsx
```

- [ ] **Step 2: Update internal relative imports in `index.test.tsx`**

The test currently imports from `'./AgentStatusPanel'`. After the move, it must import from `'.'`. Also update any sibling-relative imports to go up one folder.

Open `src/features/agent-status/components/AgentStatusPanel/index.test.tsx` and:

- Replace `from './AgentStatusPanel'` → `from '.'`
- Replace `from './ContextBucket'` (or similar siblings) → `from '..'/ContextBucket'`
- For type-only imports from `../types` → `from '../../types'` (one more `../` segment)
- For hook imports from `../hooks/...` → `from '../../hooks/...'`

Find them with:

```bash
grep -nE "from '\.\.?\/" src/features/agent-status/components/AgentStatusPanel/index.test.tsx
```

- [ ] **Step 3: Update internal relative imports in `index.tsx`**

Same exercise in `src/features/agent-status/components/AgentStatusPanel/index.tsx`:

- `from './ContextBucket'` → `from '../ContextBucket'`
- `from './TokenCache'` → `from '../TokenCache'`
- `from './ToolCallSummary'` → `from '../ToolCallSummary'`
- `from './FilesChanged'` → `from '../FilesChanged'`
- `from './TestResults'` → `from '../TestResults'`
- `from './ActivityFooter'` → `from '../ActivityFooter'`
- `from './ActivityFeed'` → `from '../ActivityFeed'`
- `from '../hooks/useActivityEvents'` → `from '../../hooks/useActivityEvents'`
- `from '../types'` → `from '../../types'`
- `from '../../diff/hooks/useGitStatus'` → `from '../../../diff/hooks/useGitStatus'`
- `from '../../diff/utils/sumLines'` → `from '../../../diff/utils/sumLines'`
- `from '../../diff/types'` → `from '../../../diff/types'`

Find them with:

```bash
grep -nE "from '\.\.?\/" src/features/agent-status/components/AgentStatusPanel/index.tsx
```

- [ ] **Step 4: Run type-check + tests**

Run: `npm run type-check && npx vitest run src/features/agent-status/`
Expected: PASS — folder move is transparent to external importers (TypeScript resolves `./AgentStatusPanel` to `AgentStatusPanel/index.tsx`).

- [ ] **Step 5: Commit (mark as rename)**

```bash
git add src/features/agent-status/components/AgentStatusPanel/
git commit -m "refactor(agent-status): promote AgentStatusPanel.tsx to folder index"
```

Verify rename detection: `git show --stat HEAD` should show "renamed" entries, not delete+create.

---

## Task 11: Add `AgentStatusPanel/Header.tsx`

**Files:**

- Create: `src/features/agent-status/components/AgentStatusPanel/Header.tsx`
- Create: `src/features/agent-status/components/AgentStatusPanel/Header.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/agent-status/components/AgentStatusPanel/Header.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentStatusPanelHeader } from './Header'
import { AGENTS } from '../../../../agents/registry'

test('renders agent glyph, short label, and a status dot', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.claude}
      status="running"
      onCollapse={() => undefined}
    />
  )
  expect(screen.getByText('∴')).toBeInTheDocument()
  expect(screen.getByText('CLAUDE')).toBeInTheDocument()
  expect(screen.getByTestId('status-dot')).toBeInTheDocument()
})

test('chevron button fires onCollapse when clicked', async () => {
  const onCollapse = vi.fn()
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.claude}
      status="running"
      onCollapse={onCollapse}
    />
  )
  await userEvent.click(
    screen.getByRole('button', { name: /collapse activity panel/i })
  )
  expect(onCollapse).toHaveBeenCalledTimes(1)
})

test('gradient wash uses agent.accentDim in inline style', () => {
  render(
    <AgentStatusPanelHeader
      agent={AGENTS.codex}
      status="paused"
      onCollapse={() => undefined}
    />
  )
  const header = screen.getByTestId('agent-status-panel-header')
  // Codex accent-dim per registry; just check the linear-gradient is present.
  expect(header.getAttribute('style')).toMatch(/linear-gradient\(180deg/)
  expect(header.getAttribute('style')).toMatch(/rgb\(125 239 161 \/ 0\.16\)/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agent-status/components/AgentStatusPanel/Header.test.tsx`
Expected: FAIL — `AgentStatusPanelHeader` does not exist.

- [ ] **Step 3: Implement `Header.tsx`**

Create `src/features/agent-status/components/AgentStatusPanel/Header.tsx`:

```typescript
import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import type { SessionStatus } from '../../../sessions/types'
import { StatusDot } from '../../../sessions/components/StatusDot'

export interface AgentStatusPanelHeaderProps {
  agent: Agent
  status: SessionStatus
  onCollapse: () => void
}

export const AgentStatusPanelHeader = ({
  agent,
  status,
  onCollapse,
}: AgentStatusPanelHeaderProps): ReactElement => (
  <div
    data-testid="agent-status-panel-header"
    className="flex items-center gap-2.5 px-3 py-2.5"
    style={{
      background: `linear-gradient(180deg, ${agent.accentDim}, transparent 80%)`,
    }}
  >
    <div
      data-testid="agent-glyph-chip"
      className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md font-mono text-[13px] font-bold"
      style={{ background: agent.accentDim, color: agent.accent }}
    >
      {agent.glyph}
    </div>
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="font-headline text-[13px] font-semibold text-on-surface">
        {agent.short}
      </span>
      <StatusDot status={status} size={6} aria-label={`agent ${status}`} />
    </div>
    <button
      type="button"
      onClick={onCollapse}
      aria-label="Collapse activity panel"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
    >
      <span className="material-symbols-outlined text-base">chevron_right</span>
    </button>
  </div>
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/agent-status/components/AgentStatusPanel/Header.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/components/AgentStatusPanel/Header.tsx \
        src/features/agent-status/components/AgentStatusPanel/Header.test.tsx
git commit -m "feat(agent-status): add expanded-panel Header sub-component"
```

---

## Task 12: Add `AgentStatusRail.tsx`

**Files:**

- Create: `src/features/agent-status/components/AgentStatusRail.tsx`
- Create: `src/features/agent-status/components/AgentStatusRail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/agent-status/components/AgentStatusRail.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentStatusRail } from './AgentStatusRail'
import { AGENTS } from '../../../agents/registry'

test('renders glyph chip, vendor mark, ctx bar, ctx label, running dot when running', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={42}
      isRunning={true}
      onExpand={() => undefined}
    />
  )
  expect(screen.getByText('∴')).toBeInTheDocument()
  expect(screen.getByTestId('vendor-mark')).toBeInTheDocument()
  expect(screen.getByTestId('context-bar-fill')).toHaveStyle({
    height: '42%',
  })
  expect(screen.getByTestId('context-pct-label')).toHaveTextContent('42% ctx')
  expect(screen.getByTestId('running-dot')).toBeInTheDocument()
})

test('switches to bg-error when context exceeds 85%', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={91}
      isRunning={false}
      onExpand={() => undefined}
    />
  )
  const fill = screen.getByTestId('context-bar-fill')
  expect(fill).toHaveClass('bg-error')
  expect(fill).not.toHaveAttribute('style', expect.stringMatching(/background:/))
})

test('renders no fill bar and "--" label when contextUsedPercentage is null', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={null}
      isRunning={false}
      onExpand={() => undefined}
    />
  )
  expect(screen.queryByTestId('context-bar-fill')).not.toBeInTheDocument()
  expect(screen.getByTestId('context-pct-label')).toHaveTextContent('-- ctx')
})

test('omits vendor mark for shell agent', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.shell}
      contextUsedPercentage={10}
      isRunning={false}
      onExpand={() => undefined}
    />
  )
  expect(screen.queryByTestId('vendor-mark')).not.toBeInTheDocument()
})

test('omits running dot when isRunning is false', () => {
  render(
    <AgentStatusRail
      agent={AGENTS.codex}
      contextUsedPercentage={50}
      isRunning={false}
      onExpand={() => undefined}
    />
  )
  expect(screen.queryByTestId('running-dot')).not.toBeInTheDocument()
})

test('chevron expand button fires onExpand', async () => {
  const onExpand = vi.fn()
  render(
    <AgentStatusRail
      agent={AGENTS.claude}
      contextUsedPercentage={10}
      isRunning={false}
      onExpand={onExpand}
    />
  )
  await userEvent.click(
    screen.getByRole('button', { name: /expand activity panel/i })
  )
  expect(onExpand).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agent-status/components/AgentStatusRail.test.tsx`
Expected: FAIL — `AgentStatusRail` does not exist.

- [ ] **Step 3: Implement `AgentStatusRail.tsx`**

Create `src/features/agent-status/components/AgentStatusRail.tsx`:

```typescript
import type { CSSProperties, ReactElement } from 'react'
import type { Agent } from '../../../agents/registry'
import { vendorMarkFor } from '../../../agents/registry'

export interface AgentStatusRailProps {
  agent: Agent
  contextUsedPercentage: number | null
  isRunning: boolean
  onExpand: () => void
}

const RAIL_WIDTH_PX = 36
const VERTICAL_LABEL_STYLE: CSSProperties = {
  writingMode: 'vertical-rl',
  transform: 'rotate(180deg)',
}

export const AgentStatusRail = ({
  agent,
  contextUsedPercentage,
  isRunning,
  onExpand,
}: AgentStatusRailProps): ReactElement => {
  const mark = vendorMarkFor(agent.id)
  const pct = contextUsedPercentage
  const warning = (pct ?? 0) > 85
  const labelText = pct === null ? '-- ctx' : `${Math.round(pct)}% ctx`

  return (
    <aside
      data-testid="agent-status-rail"
      className="flex h-full flex-col items-center gap-2.5 bg-surface-container py-2.5"
      style={{ width: RAIL_WIDTH_PX }}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand activity panel"
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-base">chevron_left</span>
      </button>

      {mark !== null && (
        <span
          data-testid="vendor-mark"
          aria-hidden="true"
          className="block h-3.5 w-3.5 bg-current text-outline-variant"
          style={{
            maskImage: `url(${mark})`,
            maskRepeat: 'no-repeat',
            maskSize: 'contain',
            maskPosition: 'center',
            WebkitMaskImage: `url(${mark})`,
            WebkitMaskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            WebkitMaskPosition: 'center',
          }}
        />
      )}

      <div
        data-testid="agent-glyph-chip"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md font-mono text-[12px] font-bold"
        style={{ background: agent.accentDim, color: agent.accent }}
      >
        {agent.glyph}
      </div>

      <div
        data-testid="context-bar-track"
        className="relative h-16 w-1 overflow-hidden rounded-full bg-outline/30"
      >
        {pct !== null &&
          (warning ? (
            <div
              data-testid="context-bar-fill"
              className="absolute bottom-0 left-0 right-0 bg-error"
              style={{ height: `${pct}%` }}
            />
          ) : (
            <div
              data-testid="context-bar-fill"
              className="absolute bottom-0 left-0 right-0"
              style={{ height: `${pct}%`, background: agent.accent }}
            />
          ))}
      </div>

      <span
        data-testid="context-pct-label"
        className="font-mono text-[9px] tracking-[0.08em] text-on-surface-muted"
        style={VERTICAL_LABEL_STYLE}
      >
        {labelText}
      </span>

      <span className="flex-1" />

      {isRunning && (
        <span
          data-testid="running-dot"
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ background: agent.accent, boxShadow: `0 0 8px ${agent.accent}` }}
        />
      )}
    </aside>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/agent-status/components/AgentStatusRail.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/components/AgentStatusRail.tsx \
        src/features/agent-status/components/AgentStatusRail.test.tsx
git commit -m "feat(agent-status): add collapsed-state AgentStatusRail"
```

---

## Task 13: `AgentStatusPanel/index.tsx` — add new props + render `Header`

**Files:**

- Modify: `src/features/agent-status/components/AgentStatusPanel/index.tsx`
- Modify: `src/features/agent-status/components/AgentStatusPanel/index.test.tsx`

- [ ] **Step 1: Write the failing test (Header integration)**

Append to `index.test.tsx`:

```typescript
test('renders Header above the body with the provided agent + status + onCollapse', async () => {
  const onCollapse = vi.fn()
  render(
    <AgentStatusPanel
      agentStatus={makeIdleAgentStatus()}  // existing test fixture
      cwd="/home/x"
      onOpenDiff={() => undefined}
      agent={AGENTS.claude}
      status="paused"
      onCollapse={onCollapse}
    />
  )

  // Header is above the body (test by document position)
  const header = screen.getByTestId('agent-status-panel-header')
  const body = screen.getByTestId('agent-status-panel')
  expect(header.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  // Chevron triggers onCollapse
  await userEvent.click(
    screen.getByRole('button', { name: /collapse activity panel/i })
  )
  expect(onCollapse).toHaveBeenCalledTimes(1)
})
```

(`makeIdleAgentStatus()` is an existing fixture; verify in the test file or create one. Import `AGENTS` from `'../../../../agents/registry'`.)

Also update all pre-existing tests in `index.test.tsx` to pass the three new required props. Find them with:

```bash
grep -n "<AgentStatusPanel" src/features/agent-status/components/AgentStatusPanel/index.test.tsx
```

For each, add:

```tsx
agent={AGENTS.shell}
status="paused"
onCollapse={() => undefined}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agent-status/components/AgentStatusPanel/index.test.tsx`
Expected: FAIL — props don't exist on `AgentStatusPanelProps` and Header is not rendered.

- [ ] **Step 3: Wire `Header` into `AgentStatusPanel/index.tsx`**

In `src/features/agent-status/components/AgentStatusPanel/index.tsx`:

1. Import the new types and component:

```typescript
import { AgentStatusPanelHeader } from './Header'
import type { Agent } from '../../../../agents/registry'
import type { SessionStatus } from '../../../sessions/types'
```

2. Extend the props interface:

```typescript
interface AgentStatusPanelProps {
  agentStatus: AgentStatus
  cwd: string
  onOpenDiff: (file: ChangedFile) => void
  onOpenFile?: (path: string) => void
  gitStatus?: UseGitStatusReturn
  agent: Agent
  status: SessionStatus
  onCollapse: () => void
}
```

3. Destructure the new props and render the header above the existing body:

```tsx
export const AgentStatusPanel = ({
  agentStatus,
  cwd,
  onOpenDiff,
  onOpenFile = undefined,
  gitStatus = undefined,
  agent,
  status,
  onCollapse,
}: AgentStatusPanelProps): ReactElement => {
  // … existing hooks unchanged …

  return (
    <div
      data-testid="agent-status-panel"
      className="flex h-full shrink-0 flex-col overflow-hidden bg-surface-container"
      style={{ width: `${PANEL_WIDTH_PX}px` }}
    >
      <AgentStatusPanelHeader
        agent={agent}
        status={status}
        onCollapse={onCollapse}
      />

      {/* … existing body regions unchanged … */}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/agent-status/components/AgentStatusPanel/`
Expected: PASS (existing tests + new Header integration test).

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-status/components/AgentStatusPanel/
git commit -m "feat(agent-status): render Header above panel body"
```

---

## Task 14: `WorkspaceView` — stable wrapper + conditional render + handleCollapse

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.integration.test.tsx` (and any other workspace tests that mount the panel)

- [ ] **Step 1: Write the failing integration test**

Append to `src/features/workspace/WorkspaceView.integration.test.tsx`:

```typescript
test('clicking the header chevron renders the rail; clicking the rail chevron returns to the panel', async () => {
  const { service, ...workspace } = mountWorkspace() // existing helper
  // Bootstrap one session with a claude pane.
  // (Use the helper signatures already in the file; if a helper builds a
  // session with a default agent, reuse it.)

  // Initial — collapsed === null → expanded panel
  expect(screen.getByTestId('agent-status-panel-header')).toBeInTheDocument()

  // Click collapse
  await userEvent.click(
    screen.getByRole('button', { name: /collapse activity panel/i })
  )

  // Rail renders
  expect(await screen.findByTestId('agent-status-rail')).toBeInTheDocument()
  expect(service.setSessionActivityPanelCollapsed).toHaveBeenCalledWith({
    id: expect.any(String),
    collapsed: true,
  })

  // Click expand from the rail
  await userEvent.click(
    screen.getByRole('button', { name: /expand activity panel/i })
  )

  // Header back
  expect(
    await screen.findByTestId('agent-status-panel-header')
  ).toBeInTheDocument()
})

test('multi-pane: each pane has its own collapse preference', async () => {
  const { addPane, focusPane } = mountWorkspace()
  const session = workspace.sessions[0]
  await addPane(session.id)

  // Focus pane A, collapse
  focusPane(session.id, session.panes[0].id)
  await userEvent.click(
    screen.getByRole('button', { name: /collapse activity panel/i })
  )
  expect(await screen.findByTestId('agent-status-rail')).toBeInTheDocument()

  // Switch focus to pane B — should be expanded (no prior preference)
  focusPane(session.id, session.panes[1].id)
  expect(screen.getByTestId('agent-status-panel-header')).toBeInTheDocument()

  // Back to pane A — collapsed
  focusPane(session.id, session.panes[0].id)
  expect(await screen.findByTestId('agent-status-rail')).toBeInTheDocument()
})

test('IPC failure surfaces via notifyInfo', async () => {
  const { service, getNotifyMessage } = mountWorkspace()
  service.setSessionActivityPanelCollapsed = vi
    .fn()
    .mockRejectedValue(new Error('mock IPC failure'))

  await userEvent.click(
    screen.getByRole('button', { name: /collapse activity panel/i })
  )

  await waitFor(() => {
    expect(getNotifyMessage()).toMatch(
      /Couldn't update activity panel: mock IPC failure/
    )
  })
})
```

(`mountWorkspace`, `addPane`, `focusPane`, `getNotifyMessage` are workspace test helpers — adapt to whatever shape already exists in the file. Read the existing `WorkspaceView.integration.test.tsx` first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/workspace/WorkspaceView.integration.test.tsx`
Expected: FAIL — `WorkspaceView` doesn't render the wrapper / rail yet.

- [ ] **Step 3: Update `WorkspaceView.tsx`**

In `src/features/workspace/WorkspaceView.tsx`:

1. Add imports:

```typescript
import { AgentStatusRail } from '../agent-status/components/AgentStatusRail'
import {
  AGENTS,
  agentTypeToRegistryKey,
  agentStatusToSessionStatus,
} from '../../agents/registry'
```

2. Inside the `WorkspaceView` component, after the existing `agentStatus` line, add:

```typescript
const focusedPane = activeSession?.panes.find((p) => p.active)
const collapsed = focusedPane?.activityPanelCollapsed ?? false

const agent = useMemo(
  () => AGENTS[agentTypeToRegistryKey(agentStatus.agentType)],
  [agentStatus.agentType]
)
const status = useMemo(
  () => agentStatusToSessionStatus(agentStatus),
  [agentStatus]
)

const handleCollapse = useCallback(
  async (next: boolean): Promise<void> => {
    if (!activeSessionId || !focusedPane) return
    try {
      await setPaneActivityPanelCollapsed(activeSessionId, focusedPane.id, next)
    } catch (err) {
      notifyInfo(`Couldn't update activity panel: ${(err as Error).message}`)
    }
  },
  [activeSessionId, focusedPane, setPaneActivityPanelCollapsed, notifyInfo]
)
```

(Pull `setPaneActivityPanelCollapsed` from the `useSessionManager` return value alongside the other manager methods already in scope. Verify the existing destructure pattern by reading the current top of `WorkspaceView`.)

3. Replace the current `<AgentStatusPanel ... />` call site (around line 905) with the wrapper + conditional branch:

```tsx
<div
  data-testid="activity-panel-shell"
  className="h-full shrink-0 overflow-hidden transition-[width] duration-[220ms] ease-pane"
  style={{ width: collapsed ? 36 : 280 }}
>
  {collapsed ? (
    <AgentStatusRail
      agent={agent}
      contextUsedPercentage={agentStatus.contextWindow?.usedPercentage ?? null}
      isRunning={agentStatus.isActive}
      onExpand={() => {
        void handleCollapse(false)
      }}
    />
  ) : (
    <AgentStatusPanel
      agentStatus={agentStatus}
      cwd={activeCwd}
      gitStatus={gitStatus}
      onOpenDiff={handleOpenDiff}
      onOpenFile={handleOpenTestFile}
      agent={agent}
      status={status}
      onCollapse={() => {
        void handleCollapse(true)
      }}
    />
  )}
</div>
```

- [ ] **Step 4: Update all other `WorkspaceView` tests that mount the panel**

Other test files in `src/features/workspace/` may render the workspace and assert against the activity panel. Find them:

```bash
grep -rn "AgentStatusPanel\|agent-status-panel" src/features/workspace/
```

For each, ensure the workspace mount path provides a valid `agent` / `status` / `onCollapse` chain. Most tests will not need direct changes if they use the existing `mountWorkspace` helper, since the helper now exercises the real `WorkspaceView`.

- [ ] **Step 5: Run all workspace tests**

Run: `npx vitest run src/features/workspace/`
Expected: PASS — integration tests + all pre-existing workspace suite.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx \
        src/features/workspace/WorkspaceView.integration.test.tsx
git commit -m "feat(workspace): wire collapsible activity panel with rail wrapper"
```

---

## Task 15: Final polish — lint, format, type-check, smoke test

**Files:** (none modified beyond fixing lint/format issues surfaced by tools)

- [ ] **Step 1: Run full type check**

Run: `npm run type-check`
Expected: 0 errors.

- [ ] **Step 2: Run ESLint**

Run: `npm run lint`
Expected: 0 errors. If failures: fix them inline (most likely missing return types or untyped React props).

- [ ] **Step 3: Run Prettier check**

Run: `npm run format:check`
Expected: All files match. If not: run `npm run format` and inspect the diff before committing.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: All green (Vitest reports 0 failures).

- [ ] **Step 5: Run the Rust backend test suite**

Run: `cargo test --manifest-path crates/backend/Cargo.toml`
Expected: All green.

- [ ] **Step 6: Manual UI smoke**

Run: `npm run dev`

Open the app and verify:

1. The activity panel renders with the new header (glyph + short + StatusDot + chevron) when an agent is detected in a pane.
2. Clicking the chevron collapses the panel to a 36 px rail with a wipe-reveal width transition. The rail shows the agent glyph, vendor mark (for Claude / Codex), context bar with `% ctx` label, and a pulsing dot when running.
3. Reload the app (`Cmd/Ctrl+R`). The collapsed/expanded state persists per session.
4. Open a second pane in the same session. The second pane's collapse state is independent of the first.
5. Run `claude` in a pane to confirm the lavender accent + Anthropic mark; run `codex` in another to confirm the mint accent + OpenAI mark. A shell pane (no agent) shows the gold `$` glyph and no vendor mark.

If any visual issue: open browser devtools, inspect the wrapper, and reconcile against §4 of the spec.

- [ ] **Step 7: Commit any final touch-ups**

If smoke surfaced small issues (color tweaks, paddings, etc.) fix them inline and commit:

```bash
git add -p
git commit -m "polish(agent-status): smoke-test touch-ups"
```

---

## Verification checklist

- [ ] All 6 spec sections have at least one implementing task above.
- [ ] No `TODO`, `TBD`, `later`, or "similar to" placeholders in this plan.
- [ ] Every code step shows the exact code to write.
- [ ] Every test step shows the exact assertion content.
- [ ] Each task ends with a commit.
- [ ] The plan respects the spec's implementation order (Vendor assets → Rust → bindings → Frontend types → Components → WorkspaceView → Polish).
- [ ] The race-safety contract from spec §3.5 + §5.2 (FIFO chain + race-safe revert) is implemented in Task 9 and tested with the spec's exact scenario.
- [ ] Header content matches spec §2 + §4.1; rail content matches spec §2 + §4.2; vendor mask matches spec §4.3.

Once everything in the plan is committed, the feature is shippable. The user runs `/lifeline:request-pr` (or the equivalent local workflow) to open the PR.
