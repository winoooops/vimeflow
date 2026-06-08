# Session Pane Status — design spec

**Linear:** VIM-93 · follow-up VIM-93b (reliable `awaiting` detection)
**Branch / worktree:** `feat/vim-93-pane-status` on `worktrees/vim-93` (off `feat/vim-66-sidebar`)
**Status:** draft

## §1 — Overview, Approach & Scope

### Problem

A session's status (`running` / `awaiting` / …) does not reflect the state of its panes. Today `pane.status` is **PTY-driven only**: set to `running` at spawn and `completed` on PTY exit (the `useSessionManager` exit handler), regardless of what the agent is actually doing. Consequences:

- The agent's activity — actively working vs finished-its-turn-and-idle — never reaches `pane.status`.
- A genuine `awaiting` state — agent blocked, truly waiting on the user — is **never assigned** anywhere. The `paused` enum value _is_ produced (by PTY-liveness heuristics — see §2), but only ever means "alive, not running"; the `deriveSessionStatus` fall-through that returns it is a catch-all, never a real "waiting on you" signal.
- `errored` is **never assigned** either — PTY exit always yields `completed`, ignoring the exit code, so a crashed agent reads identically to a clean one.
- There is no `idle` state at all.

A quad session with one busy pane and three finished-and-waiting panes reads a flat "running"; a session whose agent crashed reads "completed".

### Approach

1. **Data model** — `SessionStatus = running | awaiting | idle | completed | errored` (rename `paused` → `awaiting`; add `idle`). See §2.
2. **Detection (per pane)** — derive a lifecycle from signals the app already has:

   | State       | Signal                                                            | Status today                                         |
   | ----------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
   | `running`   | transcript `stop_reason: tool_use` / mid-stream assistant message | new lifecycle signal (§3)                            |
   | `idle`      | transcript `stop_reason: end_turn` (turn finished)                | new lifecycle signal (§3)                            |
   | `completed` | PTY exit, captured code `0` (or `null` = status unavailable)      | already wired; refined in §1 scope + §4 bridge       |
   | `errored`   | PTY exit, captured **non-zero** code                              | new — **backend exit-code capture** (§1) + §4 bridge |
   | `awaiting`  | _no reliable signal exists_                                       | **deferred** → VIM-93b                               |

3. **Bridge** — the frontend writes the derived per-pane lifecycle into `pane.status` (the missing agent→pane link). See §4.
4. **Aggregation** — `deriveSessionStatus(panes)` rolls panes up with precedence **`errored > awaiting > running > idle > completed`**. See §5.

### Scope (phased)

**In scope:**

- The `SessionStatus` data-model change (§2).
- Transcript-driven `running` / `idle` detection + a new agent-lifecycle event (§3).
- `errored` detection on **both the live and the hydration path**:
  - **Backend capture** — populate `last_exit_code` in the PTY read-loop (`child.try_wait()` + locking; pulls the deferred `commands.rs:856` follow-up into scope). The `Exited { last_exit_code }` status variant is **already on the wire** end-to-end (`bindings/SessionStatus.ts`, `commands.rs:606`); today it is always `null` only because the read-loop never captures it.
  - **Live path** — thread the code through `usePtyExitListener` (today it drops `code`): non-zero → `errored`, `0` → `completed`.
  - **Hydration path** — `sessionFromInfo.ts:9` currently maps every `Exited` session to `completed` unconditionally; change it to read `last_exit_code` (non-zero → `errored`) so a crashed pane stays `errored` across reload / `list_sessions` rehydration instead of silently reverting to `completed`.
  - **Read-error path** — the read-loop's `pty-error` arm (`commands.rs`, distinct from `pty-exit`: it emits `PtyErrorEvent` and breaks **without** touching `last_exit_code`) must also yield `errored`. Frontend: a `service.onError` handler sets the pane `errored` (today `onError` exists on the service but is unconsumed by session state). Backend: the `pty-error` arm marks the cache `exited` with a **sentinel non-zero** `last_exit_code`, so hydration reads `errored` too rather than `completed` — a read error is a failure, not a clean exit.
  - `null` = exit status genuinely unavailable (rare once capture lands) → `completed`; only a captured non-zero (or the read-error sentinel) yields `errored`, so a known crash is never masked and an unknown exit never spuriously errors.
- The agent→`pane.status` bridge (§4).
- The `deriveSessionStatus` precedence update (§5).
- The session card display of the new states (§5). (`statePill.ts` is dead since #383 and gets **deleted**, not migrated — see §2.)

**Deferred — VIM-93b (its own follow-up):**

- _Reliable_ `awaiting` detection. The transcript carries no permission/approval event (a permission-blocked `tool_use` is indistinguishable from a running one), and the documented clean signals (Claude `Notification` hook, Codex app-server `waitingOnApproval`) require agent-side hook config or app-server launch mode the project does not use. The `awaiting` **value and precedence ship wired and ready**, but no session reads `awaiting` until that follow-up lands. This spec ships **no fragile timing heuristic** for awaiting.
- _Teardown_ `idle` — flipping a pane out of `running` when its agent **crashes mid-turn while the PTY stays alive** (no closing `end_turn`). Needs a reliable per-pane "agent gone" backend signal the project doesn't push today (detection is frontend-poll-driven; `agentExited` is panel-scoped). Until VIM-93b, such a pane reads `running` until its PTY exits — see §3's _Limitation_ and §4's edge cases. Transcript-driven `idle` (the common turn-end case) ships now.

### Success criteria

- A multi-pane session reads `running` while any pane is mid-turn, `idle` once all panes finish their turns, `completed` when all panes exit cleanly, and `errored` if any pane exits non-zero — verified by unit tests on `deriveSessionStatus` and the bridge, plus a manual multi-pane check.
- Renaming `paused → awaiting` + adding `idle` leaves the existing card / tab-strip / aggregation green (tests updated).

### Non-goals

- Per-pane status indicators in the card (aggregate session status only).
- Changes to the agent observability panel (`AgentStatusPanel`).
- The deferred reliable-`awaiting` detection (VIM-93b).
- A timing / heuristic approximation of `awaiting`.

## §2 — Data model

### The type

`SessionStatus = 'running' | 'awaiting' | 'idle' | 'completed' | 'errored'` (`src/features/sessions/types/index.ts`). Rename `paused` → `awaiting`, add `idle`. `Pane.status` and `Session.status` both reference the type unchanged.

### `paused` is overloaded today — the rename must disambiguate

The current `paused` value carries **two** distinct meanings — a latent bug this spec fixes:

- **Displayed as "awaiting"** — `statePill` maps `paused → 'awaiting'`; the old card labeled it "Awaiting you".
- **Produced to mean "alive but not running"** — `agents/registry.ts:87` (`agentStatusToSessionStatus`: `!isActive → 'paused'`) and `terminal/components/TerminalPane/ptyStatusToSessionStatus.ts` (`PtyStatus 'idle' → 'paused'`, consumed by `TerminalPane/index.tsx`) emit `paused` for an idle-at-prompt agent. That is semantically **idle**, not awaiting. (`TerminalPane/Footer.tsx` is **not** a producer — it renders a pip placeholder string, unrelated to `SessionStatus`.)

So the migration is **not** a blind `paused → awaiting` replace:

- Producers meaning "alive, not working" → **`idle`** (and §3's transcript-driven detection supersedes these PTY-liveness heuristics).
- The genuine-awaiting display label → **`awaiting`** (kept, wired but dormant per §1 until VIM-93b).

This split also fixes the existing mislabel: a finished-and-idle agent currently reads "Awaiting you" when nothing is actually waiting on the user.

### Consumer maps (`tsc` enforces exhaustiveness)

Renaming `paused` + adding `idle` makes `tsc -b` flag every now-non-exhaustive `Record<SessionStatus, …>` / `Record<Session['status'], …>`:

- `Card.tsx` `STATUS_TEXT` — add `awaiting` (keep `#ff94a5`, "Awaiting you") + `idle` (dim `#8a8299`, "Idle").
- `StatusDot.tsx` `TONE_CLASS` / `DIM_TONE_CLASS` — `awaiting` = warning/pink (pulse); `idle` = a quiet neutral dot, **no** pulse.

### Delete dead `statePill.ts`

`src/features/sessions/utils/statePill.ts` (`STATE_PILL_LABEL` / `STATE_PILL_TONE` / `STATE_PILL_TONE_DIM`) is **unused since the #383 card redesign** — nothing imports `STATE_PILL_*` (the card now inlines `STATUS_TEXT`). Delete it and its co-located test rather than migrate three more exhaustive maps.

### Grouping: `idle` is "open / active"

`sessions/utils/pickNextVisibleSessionId.ts` currently gates on a hand-written `OPEN_STATUSES = {running, paused}` set. **Replace it with `isLiveStatus`** — do not hand-write `{running, awaiting, idle}`, since that set silently goes stale when a status is added (the same trap as the bare predicates). The sidebar split is then **Active** = `isLiveStatus` (non-terminal `{running, awaiting, idle}`), **Recent** = terminal `{completed, errored}`.

**Centralize the liveness predicate.** Renaming/adding values is only partly `tsc`-protected: the exhaustive `Record` maps fail to compile, but **bare equality gates do not**. A check written as `pane.status === 'running'` keeps compiling and silently treats an all-`idle` live workspace as dead. So add one typed helper in `sessionStatus.ts` — `isTerminalStatus(s): s is 'completed' | 'errored'` (plus its negation `isLiveStatus`) — and route every liveness gate through it. **The helper must be backed by an exhaustive `const TERMINAL: Record<SessionStatus, boolean>` map (or a `switch` with a `never`-typed default) — not a hand-written `s === 'completed' || s === 'errored'`.** Only the `Record` / `never` form makes `tsc` fail when a future `SessionStatus` value is added; a plain predicate body would silently mis-classify the new value, defeating the centralization.

Then **audit every bare `status === 'running'` / `=== 'paused'` pane/session gate** and reclassify each as either _actively working_ (keep `=== 'running'`) or _live / non-terminal_ (use `isLiveStatus` = `running | awaiting | idle`):

- `useSessionManager.ts:793` (`hasLiveSession`) — **live**: must count `idle` / `awaiting` panes, else a finished-but-open workspace wrongly reads "no live session" and seeds a fresh tab.
- `WorkspaceView.tsx:338` (active-backend-pane pick), `findBackendPane.ts:17` (`find(p.status === 'running') ?? shellPanes[0]`) — **live**: an idle backend pane is still the backend pane.
- `Tab.tsx:110`, `WorkspaceView.tsx:390` (`running || paused`), and `pickNextVisibleSessionId` (above) — **live**: route through `isLiveStatus`, never a hand-written status set.
- `Body.tsx:482`, `useTerminal.ts:644` / `:667`, `activePanePicker.ts:53` — judge per-site; a gate that genuinely means "agent is mid-work" legitimately stays `=== 'running'`.

Out of audit scope: the `agent-status` `event.status === 'running'` sites (`ActivityFeed`, `ActivityEvent`, `useAgentStatus`) — those are `ToolCallStatus`, a different enum, untouched by this migration.

### Test data

`workspace/data/mockSessions.ts` and co-located tests: replace each `paused` with `awaiting` or `idle` per the same semantic split — `idle` for finished-at-prompt fixtures, `awaiting` only where a fixture genuinely models a blocked agent.

## §3 — Detection (per-pane lifecycle)

### What signal — and why not the existing ones

- **`isActive` is process-liveness, not work-state.** It flips `true` when the 500 ms process-tree poll sees a `claude`/`codex` process and stays `true` the whole time the agent sits idle at its prompt. `registry.ts:87` (`isActive ? 'running' : 'paused'`) thus reads `running` until exit — it cannot tell _working_ from _idle-at-prompt_. Dead end.
- **A frontend timeout ("no tool activity for N s → idle") is exactly the heuristic §1 rules out.** Idle must come from a real turn-boundary in the data.

That boundary already lives in each transcript; the parsers just don't act on it for lifecycle. Verified against a live Claude transcript: assistant lines carry `message.stop_reason` — `tool_use` on every tool-calling message, `end_turn` once the turn settles (91× vs 5× in one session). Codex carries the equivalent as `event_msg` records (`task_started` / `task_complete`), already documented in the adapter README's `CodexEventMsg` schema.

### The base interface vs. the per-adapter detail

The `agent::adapter` module is the translation layer from vendor telemetry to Vimeflow's unified event stream — the runtime and frontend speak only unified events (`agent-status` / `agent-tool-call` / `agent-turn` / `agent-cwd` / `test-run`). Lifecycle follows that contract exactly; it does **not** leak `stop_reason` or `task_complete` past the adapter boundary. The post-#246 trait split puts event emission in `TranscriptStreamer::tail`, so that is where the lifecycle phase is derived and emitted — never above it.

**Base / shared (`agent/types.rs` + `agent/events.rs`)** — the uniform interface, provider-neutral, mirroring the existing `AgentTurnEvent` / `emit_agent_turn` precedent:

```rust
// agent/types.rs — identical derive/serde/ts-rs pattern to AgentTurnEvent
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub enum AgentPhase {
    Running,
    Idle,
    Awaiting, // reserved — never emitted until VIM-93b
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentLifecycleEvent {
    pub session_id: String,
    /// The agent's OWN session identity (Claude: transcript `.jsonl`
    /// stem; Codex: `session_meta.id`). Lets the bridge drop a stale
    /// event from a superseded tail across an agent restart — see
    /// *Restart identity*. State events need this; counters don't.
    pub agent_session_id: String,
    pub phase: AgentPhase,
}

// agent/events.rs — mirrors emit_agent_turn
pub(crate) fn emit_agent_lifecycle(
    events: &dyn EventSink,
    payload: &AgentLifecycleEvent,
) -> Result<(), String> {
    events.emit_json("agent-lifecycle", serialize_event(payload)?)
}

// live-mode edge-trigger helper — emits only on a phase change, then updates `last`.
pub(crate) fn emit_lifecycle_on_change(
    events: &dyn EventSink,
    session_id: &str,
    agent_session_id: &str,
    last: &mut Option<AgentPhase>,
    phase: AgentPhase,
) {
    if *last == Some(phase) {
        return;
    }
    *last = Some(phase);
    let payload = AgentLifecycleEvent {
        session_id: session_id.to_string(),
        agent_session_id: agent_session_id.to_string(),
        phase,
    };
    if let Err(e) = emit_agent_lifecycle(events, &payload) {
        log::warn!("Failed to emit agent-lifecycle event: {}", e);
    }
}
```

**Per-adapter (inside each `TranscriptStreamer::tail`)** — each adapter maps _its own_ signal to an `AgentPhase` and feeds the shared helper; the provider-specific field stays sealed inside the adapter:

| Adapter                                      | Where                                        | Provider signal → phase                                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude (`adapter/claude_code/transcript.rs`) | `process_line`, beside the `agent-turn` emit | assistant `stop_reason`: `tool_use` → `Running`; `end_turn` / `stop_sequence` / `max_tokens` → `Idle`. User prompt → `Running`. (`stop_reason` added to `ClaudeMessageDto`, lenient — absent/`null` = no transition.) |
| Codex (`adapter/codex/transcript.rs`)        | `process_line`, beside the `agent-turn` emit | `event_msg` `task_started` → `Running`, `task_complete` → `Idle`; `user_message` → `Running`. (Tags per README `CodexEventMsg`; locked by a fixture test against a real rollout.)                                     |

Each adapter already threads a per-stream `State` (`num_turns`, `last_cwd`); add the three lifecycle fields (`last_phase` + `replay_phase` + `replay_done`, see _Edge-triggering_ below) alongside, and that is the entire integration surface. **No new trait** — lifecycle rides the same `TranscriptStreamer::tail` seam that already emits `agent-turn` / `agent-tool-call`, keeping the abstraction consistent with how tool-calls and turns are already translated per adapter.

### Limitation: agent crash without `end_turn` (deferred → VIM-93b)

The transcript-driven `Idle` covers the common case — an agent that finishes its turn emits `end_turn` / `task_complete` → `idle`. It does **not** cover an agent that **vanishes mid-turn while the PTY stays alive** (process killed or crashed with no closing turn-end — e.g. `claude` run as a child of a shell pane): its last phase is `Running`, and no transcript turn-end ever flips it.

A correct fix needs a reliable _per-pane_ "agent process gone" signal, and the backend does not push one today: the watcher is started/stopped by the **frontend's** detection poll, and `agentExited` in `useAgentStatus` is poll-derived and panel-scoped (the active session), not a per-pane backend event. Wiring a real one is detection-architecture work, so it is **deferred to VIM-93b** (alongside reliable `awaiting`). Until then a mid-turn-crashed agent reads `running` until its PTY actually exits, at which point §1's exit path takes over (`completed` / `errored`). Crucially, `completed` / `errored` stay **exclusively** real-PTY-exit signals — this spec never paints a fake terminal state onto a live PTY.

### Edge-triggering & dedup

`emit_lifecycle_on_change` makes live emission edge-triggered — one event per Running ↔ Idle transition, no per-line spam. Within a single agent session a re-sent same-phase event is a no-op (the §4 bridge sets `pane.status` idempotently).

**Restart identity (a lifecycle event is _state_, not a counter).** The `agent-turn` duplicate-window doc (`types.rs:278`) calls restart-boundary duplicates harmless because an over-counted turn is transient. That reasoning does **not** transfer to lifecycle: a stale event from the **old** tail in its ≤500 ms shutdown window can carry a _different_ phase and overwrite the new agent's — last-writer-wins, and §4's sticky-terminal guard only protects `completed` / `errored`, not `running ↔ idle`. So `AgentLifecycleEvent` carries `agent_session_id` (already derived per tail — Claude's transcript stem, Codex's `session_meta.id`); the §4 bridge records each pane's current agent session (set by the detection/attach that sequences restarts) and **drops events whose `agent_session_id` is not the current one**. A superseded tail's late event is ignored, so restart is deterministic, not last-writer-wins. (Identity-keyed drop is the offset/cursor discipline the project already uses for replay-then-stream attach.)

**Replay-bounded (one-shot boundary flush).** Transcript tailers replay the file from byte 0 on attach/restart, so naive edge-triggering would re-emit every historical Running ↔ Idle transition before settling — violating "no per-line spam." The tracker is replay-bounded like the existing `TestRunEmitter`, carrying three fields:

- `last_phase: Option<AgentPhase>` — the **live** de-dup slot, init `None`, **left untouched during replay**.
- `replay_phase: Option<AgentPhase>` — accumulates the latest phase from replayed lines (silent — no emit).
- `replay_done: bool` — init `false`.

`on_caught_up` fires on **every** live poll cycle (≈500 ms), not just once at the boundary (`base/transcript_tail_service.rs`), so the flush is explicitly one-shot. The first `on_caught_up` (while `!replay_done`) calls `emit_lifecycle_on_change(events, sid, &mut last_phase, replay_phase)` once — `last_phase` is still `None`, so the `*last == Some(phase)` guard does not fire and the settled phase **is** emitted (and `last_phase` set) — then sets `replay_done = true`; every later `on_caught_up` short-circuits on `replay_done`. While `!replay_done`, `process_line` updates only `replay_phase`; once `replay_done`, `process_line` edge-triggers live through the helper. (Updating `last_phase` during replay instead — a one-slot design — is the bug: the boundary call would find `last_phase == Some(replay_phase)` and skip, so §4 never receives the first settle.) If no lifecycle signal appeared during replay, `replay_phase` stays `None` and nothing is flushed — the pane keeps its spawn default. No new mechanism — it reuses the base tail-service's replay→live signal — so a freshly-attached pane shows its current phase, not its history.

### Out of scope for §3

`awaiting` emission (VIM-93b — the value is reserved in the enum only); `completed` / `errored` (the PTY-exit path, §1); the write into `pane.status` (the bridge, §4).

## §4 — Bridge (agent lifecycle → `pane.status`)

Today nothing writes the agent's phase into `pane.status` — `useAgentStatus` consumes `agent-*` events into its own `AgentStatus`, never into `useSessionManager`'s `panes[]` (verified: no `setSessions` on any agent event). §4 adds that missing link.

### Two writers, one field — they must not fight

`pane.status` (materialized) is written by two independent sources:

| Writer                                  | Sets                                       | Where                                                                                         |
| --------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **PTY terminal (exit _or_ read-error)** | `completed` / `errored`                    | `useSessionManager` exit + `service.onError` handlers (§1) + `sessionFromInfo` hydration (§1) |
| **Agent lifecycle (live)**              | `running` / `idle` / (`awaiting` reserved) | **new** `agent-lifecycle` listener                                                            |

### Merge rule (per pane)

```
PTY exited / read-error?  → completed | errored   (exit code or pty-error; STICKY — lifecycle never overrides)
else                      → running | idle | awaiting   (agent-lifecycle; 'running' default at spawn until first settle)
```

Terminal states are **sticky**: the lifecycle listener writes a pane only when `!isTerminalStatus(pane.status)` (the §2 helper). This guards against a late or replayed lifecycle event resurrecting an exited pane (`completed → running`).

### Listener

Mirror the existing `onPtyExitRef` + `usePtyExitListener` pattern in `useSessionManager` (owner of `panes[]`): a new `onAgentLifecycleRef`, subscribed via the same `listen('agent-lifecycle', cb)` + `addUnlisten` mechanism `useAgentStatus` already uses for `agent-status` / `agent-turn`. On each event:

1. Find the pane by `ptyId === event.sessionId` (same match as the exit handler).
2. If `event.agentSessionId` is not the pane's current agent session → skip (stale tail from before a restart — see §3 _Restart identity_).
3. If `isTerminalStatus(pane.status)` → skip (sticky terminal).
4. Else set `pane.status = phaseToStatus(event.phase)` and re-derive the session status (§5).

`phaseToStatus` is a 1:1 `Record<AgentPhase, …>` off the generated binding enum — exhaustiveness-checked, so a future phase rename/add is `tsc`-caught.

### Edge cases

- **Spawn** — pane starts `running` (today's default); the first `agent-lifecycle` (emitted at the replay→live boundary, §3) settles it. No wrong-state flash — the bridge only moves `running ↔ idle` on a real event.
- **Agent exits, PTY alive** (agent process ends, shell stays) — no PTY-exit event. If the agent closed its turn first (`end_turn`), the pane already reads `idle` and stays there (nothing overrides it). A **mid-turn** crash with no closing turn-end is the deferred case (§3 limitation → VIM-93b): the pane stays `running` until the PTY itself exits. No false `completed` is ever painted onto a live PTY.
- **Restart** (new agent on the same live PTY) — pane is non-terminal, so the re-replayed lifecycle re-settles it; sticky-terminal doesn't apply.

### Out of scope for §4

Session-level aggregation + precedence, and the card / `StatusDot` display — that is §5.

## §5 — Aggregation & display

### Precedence — data-driven, not an `if` cascade

`deriveSessionStatus(panes)` rolls the per-pane statuses into one session status by strict precedence — **`errored > awaiting > running > idle > completed`** (a broken pane is the most important thing to surface, even above one waiting on you). The precedence lives in a single declarative `Record`, folded with `reduce` — no chain of `if (some …) return …`:

```ts
// precedence high → low; the Record is exhaustiveness-checked — a new SessionStatus must be ranked
const STATUS_PRECEDENCE: Record<SessionStatus, number> = {
  errored: 0,
  awaiting: 1,
  running: 2,
  idle: 3,
  completed: 4,
}

export const deriveSessionStatus = (panes: Pane[]): SessionStatus => {
  if (panes.length === 0) return 'errored' // invariant guard (empty = corrupt session)
  return panes.reduce<SessionStatus>(
    (top, pane) =>
      STATUS_PRECEDENCE[pane.status] < STATUS_PRECEDENCE[top]
        ? pane.status
        : top,
    'completed'
  )
}
```

- Reordering or adding a status is a one-line edit to `STATUS_PRECEDENCE`; the `Record<SessionStatus, number>` is `tsc`-exhaustive (a new `SessionStatus` value fails to compile until ranked) — the same exhaustive-`Record` discipline §2 mandates for `isTerminalStatus`.
- The empty-`panes[]` guard stays `errored` (corrupt session = most-salient flag; consistent with `errored` being top precedence). The `'completed'` seed is the lowest-priority identity, so a fully-`completed` pane set folds to `completed`.
- `deriveShellSessionStatus` is **unchanged** — still filters to shell panes (browser-only fallback intact) and delegates to this `deriveSessionStatus`.
- Worked examples: `{errored, idle, idle, idle}` → `errored`; `{running, idle, idle, completed}` → `running`; all-`idle` → `idle`; all-`completed` → `completed`.

### Display (aggregate only — no per-pane indicators)

The card and tab strip render the single aggregated `session.status`; no per-pane dots. The per-value visuals are the §2 maps — Card `STATUS_TEXT` (`awaiting` → `#ff94a5` "Awaiting you", `idle` → `#8a8299` "Idle") and `StatusDot` (`awaiting` = pink pulse, `idle` = quiet neutral dot). So a quad with one crashed pane reads a single **"Errored"** even if the other three are idle; a busy-plus-idle quad reads **"Running"**. The precedence _is_ what the user sees.

### Tests

- `sessionStatus.test.ts`: one case per precedence rung + the mixed combos above + the empty-guard. Red-first — the current 3-way precedence fails the new `awaiting` / `idle` cases.
- `Card.test.tsx` / `StatusDot.test.tsx`: assert the new `awaiting` / `idle` label + tone. Low icon-risk (text label + color, not new glyphs), but eyeball the dim `idle` tone in the running app — vitest passes on `textContent` and can't see a wrong color.

### Out of scope for §5

Nothing new deferred — detection (§3), bridge (§4), and data model (§2) own the rest.
