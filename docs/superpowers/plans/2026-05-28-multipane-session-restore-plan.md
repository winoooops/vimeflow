<!-- cspell:ignore vsplit hsplit multipane -->

# Multi-Pane Session Restore — Implementation Plan

> Status: **active**. Phase A (observability) and the feasible reconstruction
> slice (Phases B–C) are being executed in branch
> `worktree-session-restore-multipane`. Phases D–E are deferred design.

**Goal:** Make a restored vimeflow session reopen as ONE workspace session with
its original layout and panes, instead of fragmenting each pane's PTY into its
own single-pane session. A quad-layout session with 3 coding agents + 1 shell
must come back as one quad session with four panes — not four tabs.

**Root cause (by design, not accident):** PR #55
([`2026-04-25-pty-reattach-on-reload`](2026-04-25-pty-reattach-on-reload.md))
built a **flat per-PTY** cache: one `CachedSession` per PTY, one entry in
`session_order`, no grouping. The multi-pane work (steps
[5a](2026-05-10-step-5a-pane-model-refactor.md) /
[5b](2026-05-11-step-5b-splitview-render.md) / 5c) added the **frontend**
grouping (`Session.layout` + `Session.panes[]`, each `pane.ptyId` == a PTY id)
but explicitly kept "Rust IPC unchanged" and "restore never mutates ids". So the
workspace grouping lives only in ephemeral React state and is lost on every
reload. On restore, `sessionFromInfo` wraps each PTY in its own
`layout:'single'` session → fragmentation.

**Key files in play:**

| Layer        | File                                                    | Role today                                           |
| ------------ | ------------------------------------------------------- | ---------------------------------------------------- |
| Cache schema | `crates/backend/src/terminal/cache.rs`                  | `CachedSession` per PTY; no grouping                 |
| IPC types    | `crates/backend/src/terminal/types.rs`                  | `SessionInfo` (id/cwd/status/activityPanelCollapsed) |
| Commands     | `crates/backend/src/terminal/commands.rs`               | `list_sessions_inner`, `spawn_pty_inner`, …          |
| Runtime/IPC  | `crates/backend/src/runtime/state.rs`, `runtime/ipc.rs` | command dispatch                                     |
| Restore      | `src/features/sessions/hooks/useSessionRestore.ts`      | maps PTY → session                                   |
| Restore util | `src/features/sessions/utils/sessionFromInfo.ts`        | hardcodes single-pane                                |
| Manager      | `src/features/sessions/hooks/useSessionManager.ts`      | owns sessions/panes/layout                           |
| Service      | `src/features/terminal/services/*TerminalService*`      | IPC client                                           |
| Bindings     | `src/bindings/`                                         | generated via `npm run generate:bindings`            |

---

## Two hard constraints (the reason "restore after a full quit" is not a small slice)

### C1 — Graceful exit wipes the cache

`electron/main.ts` `before-quit` → `sidecar.shutdown()` →
`BackendState::shutdown()` (`runtime/state.rs:76`) → `SessionCache::clear_all()`
**wipes `sessions.json` on every clean quit**, intentionally, so the next launch
does not show ghost "Restart" tabs (see the `clear_all` doc comment). Therefore:

- **Reload / crash** (HMR refresh, `Cmd+R`, SIGKILL, OOM): cache survives →
  restore runs → **fragmentation is observable here.** This is almost certainly
  what the user saw.
- **Graceful quit**: cache is empty → nothing restores at all.

**Consequence:** persisting grouping in the cache fixes fragmentation for the
reload/crash paths immediately. Making a session survive a _graceful quit_
requires **reversing or replacing the C1 wipe policy** — a separate UX decision
(how to present restored-but-dead sessions, restart-all affordance, opt-in).
That is **Phase D**, not the feasible slice.

### C2 — True history resume needs new capture

Agent (Claude Code / Codex) session ids are not persisted; the agent type is
re-detected at runtime from PTY output (`agent/adapter/base/watcher_runtime.rs`).
Resuming a prior conversation needs: capturing each agent's session id, storing
it with the pane grouping, and respawning the pane via the agent's
`--resume`/resume mechanism. That is **Phase E**.

---

## Decision: scope of the feasible slice (Phases B–C)

Fix the fragmentation for the **cache-intact** paths only:

1. Persist the pane→workspace grouping + layout + agent type in the Rust cache.
2. Reconstruct grouped multi-pane sessions on restore.
3. On a restored pane whose PTY is still **Alive** (reload), reattach to the
   live PTY (existing replay protocol) — the agent keeps running, no respawn.
4. On a restored pane whose PTY is **Exited** (crash), it shows as a `completed`
   pane in the correct slot, restartable in place (existing Restart UX).

Out of scope for B–C (→ Phases D/E): surviving a graceful quit, fresh-respawning
agents after a quit, and true conversation-history resume.

**Backwards compatibility:** every new field is optional (`#[serde(default)]` /
`?`). A `CachedSession` with no `grouping` restores exactly as today
(single-pane), so old `sessions.json` files and any PTY spawned before grouping
is pushed degrade gracefully.

---

## Phase A — Observability (DONE)

- `src/lib/log.ts`: namespaced structured logger (`[vimeflow:<ns>]`).
- `useSessionRestore`: logs PTY count in and workspace-session count out
  (the `N PTY → N workspace` fragmentation symptom).
- `list_sessions_inner`: per-call summary via `log::info!` + debug file log.
- Regression test pinning `4 PTY → 4 single-pane sessions`.

---

## Phase B — Persist pane grouping in the Rust cache (+ bindings)

**New type** (`cache.rs`, mirrored for IPC in `types.rs`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")] // IPC copy only; cache copy stays snake
pub struct PaneGrouping {
    pub workspace_session_id: String, // the frontend Session.id (UUID)
    pub layout: String,               // LayoutId: single|vsplit|hsplit|threeRight|quad
    pub pane_id: String,              // session-scoped pane id, e.g. "p0"
    pub pane_index: u32,              // stable order within the workspace
    pub agent_type: String,           // claude-code|codex|aider|generic
    pub active: bool,                 // is this the workspace's active pane
}
```

- Add `#[serde(default)] pub grouping: Option<PaneGrouping>` to `CachedSession`.
- Add `grouping: Option<PaneGrouping>` to `SessionInfo`; populate it from the
  cached value in `list_sessions_inner`.
- New command `set_workspace_sessions` (request:
  `Vec<WorkspaceSessionSnapshot>`, each `{ id, layout, panes: [{ ptyId,
paneId, paneIndex, agentType, active }] }`). Under one `cache.mutate`: for
  every pane whose `ptyId` exists in `sessions`, write its `PaneGrouping`;
  clear `grouping` on PTYs not present in the snapshot (closed panes). Wire
  through `runtime/state.rs` + `runtime/ipc.rs` like the other session commands.
- `layout` is stored per-pane (redundant but self-healing); reconstruction reads
  it from the active pane, falling back to any pane.

**Tests** (`cache.rs`, `commands.rs`): grouping round-trips through disk;
missing `grouping` loads as `None`; `set_workspace_sessions` writes/clears
grouping; `list_sessions` surfaces grouping.

**Then:** `npm run generate:bindings` (regenerates `src/bindings/`). Commit only
the intended binding files (cargo test dirties bindings — review before adding).

---

## Phase C — Reconstruct grouped sessions on restore (frontend)

1. **Service:** add `setWorkspaceSessions(snapshot)` to `ITerminalService`, the
   desktop impl, and the mock.
2. **Reconstruction** (`useSessionRestore` + a new `groupSessionsFromInfos`
   util): group `SessionInfo[]` by `grouping.workspaceSessionId`; within a
   group, order panes by `paneIndex`, set `Session.layout` from the grouping,
   mark the `active` pane, carry per-pane `agentType`. PTYs **without** grouping
   keep the current single-pane behavior (back-compat) and append after grouped
   sessions. Preserve the existing replay/restoreData wiring per pane.
3. **Push grouping:** in `useSessionManager`, a single `useEffect` watching
   `sessions` pushes the full snapshot via `service.setWorkspaceSessions(...)`
   (debounced). One integration point instead of threading 7 mutation sites
   (createSession/addPane/removePane/setSessionLayout/setSessionActivePane/
   reorderSessions/restartSession). Over-pushing is harmless — the write is
   idempotent.
4. **Tests:** flip the Phase-A fragmentation regression — 4 grouped PTYs →
   ONE quad session with 4 panes in order, correct active pane; ungrouped PTYs
   still become single-pane sessions; mixed grouped + ungrouped restores both.

**End-to-end evidence (substitute for headless GUI):** the reconstruction unit
tests + the restore log line flipping to `4 PTY → 1 workspace`. A manual
verification script (reload, not quit — see C1) is included for the operator.

---

## Phase D — Survive a graceful quit (deferred design)

**Decision (2026-05-28):** **D2 — sibling store, no wipe change.** Persist the
workspace shape (sessions list + per-session layout + per-pane cwd + agent
type) to a SEPARATE durable store that survives `clear_all()`. The live PTY
cache (`sessions.json`) keeps being wiped on graceful quit — the ghost-tab UX
that motivated the wipe stays untouched. On launch:

1. Load the sibling store -> reconstruct the workspace shell (tabs, layouts,
   pane positions) as `completed` panes seeded with cwd + agent type.
2. Either auto-respawn each pane fresh (preferred default) or render Restart
   affordances per pane (lower-friction fallback if respawn would slow launch).
3. Agents come up fresh — Phase E layers on top to additionally `--resume` the
   prior conversation when an agent session id is available.

**Storage shape (sketch):**

```jsonc
// app_data_dir/workspace-layouts.json — never cleared by clear_all
{
  "version": 1,
  "sessions": [
    {
      "id": "<workspace uuid>",
      "layout": "quad",
      "panes": [
        {
          "paneId": "p0",
          "paneIndex": 0,
          "cwd": "/repo",
          "agentType": "claude-code",
          "active": true,
        },
        // ...
      ],
    },
  ],
}
```

Rust side: a new `WorkspaceLayoutsCache` next to `SessionCache`, written by a
new IPC (`set_workspace_layouts(snapshot)`) on the same debounced trigger that
already pushes `set_workspace_sessions`. Read on launch BEFORE `list_sessions`:
seed React state with the durable layouts so the UI is rendered immediately as
`completed`/`pending`; once `list_sessions` returns, any pane whose `ptyId`
matches a live PTY (cache-intact reload) is upgraded in place to the live PTY
binding via the existing replay protocol. Mismatches (cache wiped on quit) keep
the `completed` shape and respawn / Restart wins.

Open questions to settle in the Phase D PR:

- Auto-respawn vs. explicit Restart by default.
- Eviction policy for the sibling store (keep the last N quits? all?).
- Migration: do we backfill the sibling store from live React state on first
  push after this lands, or wait for the user's next structural mutation?

Out of scope (intentional, retained as non-goals):

- Recreating the live PTY processes themselves across a quit (impossible).
- Persisting in-pane terminal scrollback across a quit (huge state, low value
  given the existing replay buffer is per-PTY-lifetime).

---

## Phase E — True conversation-history resume (deferred design)

1. **Capture** each pane's agent session id. Claude Code and Codex both write a
   session id; surface it from the agent adapters
   (`agent/adapter/{claude_code,codex}/…`) via an event, store it in the pane
   grouping (`agent_session_id: Option<String>`).
2. **Persist** it with the grouping (Phase B schema gains the field).
3. **Resume** on restore: when respawning a pane whose grouping has an agent
   session id, launch the agent with its resume mechanism (Claude Code
   `--resume <id>` / Codex resume) in the pane's cwd, instead of a bare shell.
4. **Fallbacks:** missing/expired id → fresh agent; non-agent pane → shell.

This composes with Phase D (you need the layout shell to survive the quit before
there is anything to resume into).

---

## Task order & commit discipline

1. Phase A — done (2 commits).
2. Phase B — cache schema + `set_workspace_sessions` + `list_sessions` surface
   - tests (commit), then bindings regen (separate commit).
3. Phase C — service method (commit) → reconstruction util + hook + tests
   (commit) → push-grouping effect + tests (commit).
4. Phases D/E — design only here; separate future plans/PRs.

One PR answers one question (`rules/common/pr-scope.md`): this branch's question
is "does a multi-pane session restore as one grouped session on reload?" Phases
D/E are explicitly separate questions.

## Verification

- `npm run lint && npm run type-check && npm run test`.
- `cargo test --manifest-path crates/backend/Cargo.toml` for touched modules
  (the ~11 macOS-only flaky tests that need `/bin/true` + `/proc` may stay red
  locally; note, do not chase — see memory `macos-rust-test-env-failures`).
- Reconstruction unit tests + the `N PTY → 1 workspace` restore log.
- Manual (operator): `npm run dev`, open a quad session with 3 agents + 1 shell,
  trigger a **window reload** (not a full quit — see C1), confirm one quad
  session with four panes in their cwds. Quit-survival is Phase D.
