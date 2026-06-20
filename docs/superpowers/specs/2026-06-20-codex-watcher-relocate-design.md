# Codex agent-status watcher relocation — design spec

**Date:** 2026-06-20 · **Issue:** [VIM-188](https://linear.app/vimeflow/issue/VIM-188) · **Status:** design
**Area:** `crates/backend/src/agent/` (Rust) + `src/features/agent-status/` (frontend)
**Visual explainer (zh):** `docs/decisions/2026-06-20-codex-agent-status-relocate.zh-CN.html`

## Problem

On a **codex** session, the agent-status sidebar permanently stops updating after a
session switch:

- After `/clear` (codex starts a new conversation) → the panel goes empty and never
  adds new activity.
- After an in-session `resume` to another conversation → the panel never updates again.

Claude Code is unaffected.

## Root cause (Claude + codex, unanimous)

The codex transcript watcher pins **one** rollout file at attach and never re-points it.
`/clear` / `resume` write to a **new** rollout file on the **same PID**, but the watcher
keeps filtering/reading the old file → no further events.

- Watcher pins `target_path` at attach (`session_lifecycle.rs:843/853` →
  `watcher_runtime.rs:772`); the notify callback filters to that exact path
  (`:888`) and reads only it (`:908`); the poll fallback reads only `poll_path`
  (`:1099/1161`).
- The frontend only restarts the watcher when the agent **PID** changes
  (`useAgentStatus.ts:299/340`); `/clear` and `resume` keep the same PID, so no
  restart fires.
- **Codex-specific:** codex exposes only a _static_ transcript hint
  (`codex/mod.rs:111`); Claude re-derives `transcript_path` from every statusline
  update (`claude_code/mod.rs:52`), so Claude self-heals.
- The frontend `/clear` latch (`useAgentStatus.ts:207/526`) is **downstream only**;
  `resume` reproduces with no `/clear`, proving the backend watcher is the cause.

## Rejected alternative — periodic re-location

A background supervisor polling `locate()` was the first plan but is rejected:

- A _correct_ re-locate must consult the per-PID **open rollout FD** (`lsof`) —
  sqlite-recency alone is insufficient (`choose_state_candidate` errors on ambiguous
  same-cwd rows; a stale `resume`-argv would win forever). `lsof` is a process spawn
  (~10–40ms).
- With ~8 concurrent codex sessions, per-session polling ≈ a constant CPU tax that
  **grows with session count** — the wrong cost profile for a control plane built to
  run many agents.
- Empirical timing in a multi-session environment is too noisy to tune an interval,
  and `state.sqlite` is written by every session (event-driven on it ≈ continuous).

→ **Run the expensive-but-correct re-locate only on demand.**

## Fix overview — manual / event-driven reattach (no polling)

**Reattach = re-invoke the existing `start_agent_watcher(ptyId)` IPC.** It already runs
`run_watch_sequence` (`session_lifecycle.rs:843`): `locate → spawn → atomic register`,
and is **rollback-safe** — spawn/setup failure leaves the old watcher intact, and the
old→new swap is atomic (`:811-842`). The restarted watcher replays the new rollout and
emits `agent-status` **before** transcript tailing (`watcher_runtime.rs:1040`), so the
frontend `/clear` latch self-clears on the first new event. **No new restart
machinery is needed.**

The fix is therefore: (1) make `locate()` resolve the **current** rollout, (2) make
that work on **macOS**, and (3) trigger the re-invoke from the UI / `/clear`.

## Design

### D1 · macOS open-FD provider (critical)

Open-FD discovery is currently **Linux-`/proc`-only and disabled on macOS**
(`config.rs:128` `default_proc_root()` → `None` off Linux; `open_rollout_paths_from_proc`
`locator.rs:513`). The open rollout FD is the only reliable signal for in-session
`resume`, so on macOS the fix is inert without it.

- Introduce an **`OpenRolloutFds` provider seam** (trait/fn) the locator consults:
  `fn open_rollout_paths(pid) -> HashSet<PathBuf>`.
- Implementations: existing `/proc` (Linux); **new `lsof`-based** (macOS/BSD) —
  `lsof -p <pid> -Fn`, parse `n…rollout-*.jsonl` lines. Bounded timeout; failures
  return empty (never panic / never block).
- The provider is **injectable** so the integration test can supply a fake set
  (platform-independent tests).

### D2 · Resolver Option A — open-FD authoritative

In `CompositeLocator::resolve_rollout` (`locator.rs:402`), make the per-PID open-FD the
**authoritative** signal, with `resume`-argv / sqlite-recency as fallback **only when no
open FD is observable**:

- In-session `resume` (same cmdline) → resolved via the open FD.
- `codex resume <id>` launch (FD not open yet) → still binds via argv fallback.
- Ambiguous same-cwd rows → already error safely via `choose_state_candidate`
  (`locator.rs:465`).
- **Attach-time behavior must not regress** — open-FD is ground truth for attach too;
  argv/sqlite remain the early-window fallback.

### D3 · Reattach triggers (frontend)

- **Manual button** in `AgentStatusPanelHeader` — the universal recovery; covers the
  _undetectable_ in-session `resume`.
- **`/clear` auto-reattach** — `/clear` is already detected (`WorkspaceView.tsx:557`).
  It fires **before** codex opens the new rollout, so the reattach is **deferred /
  bounded-retried** (retry the re-invoke a few times over ~1–2s until `locate()`
  resolves a _different_ rollout, then stop). Bounded, single-session — **not**
  continuous polling.
- **(Optional) reattach-on-focus** — reuse the existing visible-pane refresh
  (`useAgentStatusHotLoading.ts:45`) to re-invoke for codex panes on focus.

### D4 · Frontend reattach wiring

- The reattach action re-invokes `start_agent_watcher(ptyId)` and **must**: bypass the
  `watcherStartedRef` once-only gate, **reuse** the existing single-flight
  (`watcherStartInFlightRef`) + generation (`watcherStartGenerationRef`), and **not**
  stop-then-start (let the backend's atomic replace handle rollback).
- **UI state:** reuse the header's refreshing/loading machinery; add a **red
  "needs reattach"** state. Set it on `/clear` detection (until the deferred reattach
  succeeds) so the user gets a clear signal even when auto-reattach is mid-retry.

### D5 · Frontend latch — unchanged

`locallyResetRunScopedEventsRef` is downstream; it self-clears once the reattached
watcher emits a fresh `agent-status` with the new `agentSessionId` (`:526`). No change;
verify in manual test.

## Testing

- **RED integration test (backend):** fake codex_home (temp) + rollout A; start the
  watcher; assert A emits (baseline); switch the injected open-FD source to rollout B +
  write B; re-invoke `start_agent_watcher`; **assert B's events flow** — fails today
  (resolver doesn't prioritize the FD), passes after D2.
- **macOS lsof provider:** parse fixture `lsof -Fn` output → expected rollout set;
  empty/timeout → empty set.
- **Resolver:** open-FD beats stale `resume`-argv; argv fallback when no FD;
  ambiguous same-cwd errors; attach path unchanged.
- **Frontend:** reattach action re-invokes with single-flight (no double-call) +
  generation; `/clear` → deferred reattach with bounded retry-until-rollout-changes;
  red stale state set on `/clear` and cleared on success; button calls the action.
- Coverage 80%+; TDD throughout. Reuse `codex/locator.rs` test helpers
  (`insert_thread`, `write_rollout`, `make_db`) + the `t_lifecycle_2a/2b` patterns.

## PR breakdown (→ VIM-188 sub-issues)

| PR    | Scope                                                                                                                                          | Branch                      | Closes | Dep      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------ | -------- |
| **1** | Spec + Chinese note (already committed) + **RED** integration test + injectable open-FD seam                                                   | `fix/codex-status-relocate` | sub-1  | —        |
| **2** | macOS `lsof` open-FD provider + unit tests                                                                                                     | off `main`                  | sub-2  | —        |
| **3** | Resolver Option A (open-FD authoritative) → turns the RED test GREEN                                                                           | off `main`                  | sub-3  | PR1 (+2) |
| **4** | Frontend reattach: re-invoke wiring (single-flight/generation), **Reattach button**, red "stale" header state, `/clear` deferred auto-reattach | off `main`                  | sub-4  | PR3      |

Each sub-issue PR uses `Closes VIM-<sub>`; the umbrella **VIM-188 stays open** and is
referenced via `Part of VIM-188` (manual link). PR2 and PR1 are independent; PR3 makes
the RED test pass; PR4 delivers the user-facing recovery.

## Risks

- **macOS `lsof` reliability/cost** — only run on demand (reattach), bounded timeout,
  empty-on-failure. Never block the watcher start.
- **Reattach re-entrancy** — concurrent re-invoke vs a real re-attach: rely on the
  documented atomic-replace invariants + frontend single-flight/generation.
- **`/clear` timing** — bounded retry-until-rollout-changes avoids re-grabbing the old
  rollout; cap retries so a no-op `/clear` doesn't loop.
- **Resolver attach regression** — open-FD authoritative must keep attach + `codex
resume <id>` launch working (argv fallback when FD absent).

## Out of scope

How `status.toolCalls` / status events are produced upstream; the Tool Calls jar
(PR #576).

## Consensus

Claude parallel exploration + self-verification → codex review round 1 (root cause +
the rejected polling plan) → redesign to manual reattach (overhead) → codex review
round 2 (AGREE-WITH-CHANGES; surfaced the macOS open-FD gap). Both rounds unanimous.
