---
title: Step 5c-2 — Pane lifecycle (addPane / removePane / placeholder / X-close / auto-shrink)
date: 2026-05-12
status: draft
issue: TBD (sibling of #164; 5c-1 shipped in #203)
owners: [winoooops]
related:
  - docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md
  - docs/superpowers/specs/2026-05-10-step-5a-pane-model-refactor-design.md
  - docs/superpowers/specs/2026-05-11-step-5b-splitview-render-design.md
  - docs/superpowers/specs/2026-05-12-step-5c-1-layout-picker-design.md
  - docs/design/handoff/prototype/src/splitview.jsx
  - docs/design/handoff/prototype/src/app.jsx
  - docs/roadmap/progress.yaml
---

# Step 5c-2 — Pane lifecycle (addPane / removePane / placeholder / X-close / auto-shrink)

## Context

Step 5 of the UI Handoff Migration ([#164](https://github.com/winoooops/vimeflow/issues/164))
was originally scoped as "SplitView + LayoutSwitcher + ⌘1-4 / ⌘\ +
spawn/close auto-shrink". The work was sliced into five PRs to keep
reviewer load manageable:

- **5a** ([#198](https://github.com/winoooops/vimeflow/pull/198)) —
  Pane data model: `Session.layout` + `Session.panes[]`, per-pane PTY
  ownership, exactly-one-active invariant.
- **5b** ([#199](https://github.com/winoooops/vimeflow/pull/199)) —
  CSS Grid `SplitView` mapping `session.panes` to layout slots.
- **5c-1** ([#203](https://github.com/winoooops/vimeflow/pull/203)) —
  Passive `LayoutSwitcher`, click-to-focus, ⌘1-4 + ⌘\ shortcuts,
  Framer Motion shared-layout animations. `setSessionLayout` +
  `setSessionActivePane` manager mutations.
- **5c-2 (this spec)** — Pane _lifecycle_ mutations: `addPane`,
  `removePane`, "+ click to add pane" placeholder in empty grid
  tracks, X-close button on per-pane chrome, auto-shrink layout on
  close. First multi-pane production state.
- **5d (next)** — Auto-grow on layout pick: one click on the
  LayoutSwitcher fans out N PTYs in parallel to fill the new
  capacity.

5c-1 shipped the layout _picker_ + focus controls in their entirely
passive form: picking `vsplit` from a single-pane session sets
`session.layout='vsplit'` and SplitView renders one real pane + one
inert empty grid track. 5c-2 makes those empty tracks **actionable**
— users click a centred `+` button in each empty slot to spawn a PTY
into it, and per-pane chrome gains a hover-revealed `×` button to
remove a pane. Both mutations preserve 5a's invariants (`panes.length
≥ 1`, exactly-one-active, materialized `Session.workingDirectory` +
`Session.agentType` re-derived from the active pane).

Auto-shrink (Decision #3 below) bridges the gap between 5c-2's
per-pane close and 5c-1's per-session layout pick: closing a pane in
`quad` (4 panes) demotes the session to `threeRight` (3 panes); the
remaining panes flow into the new grid via 5c-1's Framer Motion
shared-layout animation. The user does NOT need to also adjust the
LayoutSwitcher.

This spec also resolves the Rust active-session contract divergence
that 5c-1 deferred (5c-1 Decision #10). With multi-pane sessions now
observable, `setSessionActivePane` fires
`service.setActiveSession(newPtyId)` on every active-pane rotation
within the focused session — Rust's cached active PTY tracks the
focused pane within the focused session, not just the session-tab
granularity.

## Goals

1. **`applyAddPane` / `applyRemovePane` reducers** — new pure
   functions in `src/features/sessions/utils/paneLifecycle.ts`. Both
   return a small side-info bag so the wrapper can detect no-ops
   (e.g. capacity exceeded inside the race window, last-pane removal
   hitting a 1-pane session) and recover the spawned/killed PTY
   accordingly: `applyAddPane → { sessions, appended: boolean }`,
   `applyRemovePane → { sessions, removedPtyId?, newActivePtyId? }`.
   Both enforce 5a's invariants (`panes.length ≥ 1`, exactly-one-active,
   materialized `workingDirectory` + `agentType`), **re-derive
   `Session.status` via the existing `deriveSessionStatus(panes)`
   helper** in `utils/sessionStatus.ts` so aggregate status tracks
   per-pane status changes (Decision #13), and return the same
   `sessions` reference on no-op branches so React skips the
   re-render. Match the precedent set by 5a's `applyActivePane` in
   `utils/activeSessionPane.ts`.
2. **`autoShrinkLayoutFor(nextPaneCount, currentLayoutId): LayoutId`**
   — new pure helper in the same file. Returns the layout to demote
   to after a pane is removed. Rules from the handoff prototype
   `app.jsx:184-206`:
   - `1` → `single`
   - `2` && `currentLayoutId === 'hsplit'` → `hsplit`
   - `2` (any other current) → `vsplit`
   - `3` → `threeRight`
   - `≥4` → return `currentLayoutId` (only reachable defensively;
     remove from `quad` clamps to 3).
3. **`pickNextActivePaneId(panes, closedIdx): string | null`** — new
   pure helper. `panes` is the BEFORE-splice array; the caller has
   already verified `panes[closedIdx]` exists. Returns
   `panes[closedIdx - 1].id` if it exists; otherwise
   `panes[closedIdx + 1]?.id` (the _successor_ in the before-splice
   array, which is the pane that shifts into `closedIdx` after
   splice); otherwise `null` (no panes left — `removePane` blocks
   this upstream, but the helper handles it). Mirrors the "prev
   index, fall to next" convention from editor splits.
4. **`addPane(sessionId)` mutation on `useSessionManager`** —
   serialized per-session via `pendingPaneOps` (Decision #12); ignore
   the call when another addPane/removePane is already in flight for
   the same session. Pre-flight: validate session, reject when
   `panes.length >= LAYOUTS[session.layout].capacity` (cheap reject).
   Spawn a new PTY inheriting the active pane's `cwd`; after spawn
   resolves, re-read `sessionsRef.current` for a freshness check.
   Commit via `flushSync(setSessions(prev => applyAddPane(prev, ...,
LAYOUTS[prev.layout].capacity)))`; if the reducer reports
   `appended === false` (lost a race to a concurrent commit, or
   capacity guard tripped against the latest committed state), kill
   the orphan PTY and drop bookkeeping. On success, fire
   `service.setActiveSession(newPtyId)` guarded by
   `sessionId === activeSessionIdRef.current`. Same `pendingSpawns`
   accounting as `createSession`.
5. **`removePane(sessionId, paneId)` mutation on `useSessionManager`**
   — serialized per-session via `pendingPaneOps` (Decision #12); the
   guard closes the 2-pane double-close race where two concurrent
   `removePane` calls both pass the `panes.length === 1` check, both
   kill, and the second commit no-ops leaving a surviving pane whose
   PTY was already killed. Pre-flight: validate session + pane; warn
   and return when `session.panes.length === 1` — the tab-strip X
   (`removeSession`) is the correct path for the last-pane case
   (Decisions #4 + #8). `service.kill(pane.ptyId)`; on success, drop
   bookkeeping; `flushSync` the commit via `applyRemovePane`; if the
   reducer returns `newActivePtyId` AND
   `sessionId === activeSessionIdRef.current`, fire
   `service.setActiveSession(newActivePtyId)`.
6. **`EmptySlot` component** — new at
   `src/features/terminal/components/SplitView/EmptySlot.tsx`.
   Renders a centred `+` button + hint text ("add pane"). Click fires
   `onAddPane(session.id)`. SplitView mounts one `EmptySlot` per
   empty grid track within the current layout's capacity (indices
   `panes.length..layout.capacity − 1`).
7. **X-close on per-pane chrome** — the X button is already
   implemented in `TerminalPane/HeaderActions.tsx` (rendered when
   `onClose` is non-undefined). SplitView gains an `onClosePane`
   prop and passes `onClose` to `TerminalPane` **only when
   `session.panes.length > 1`** (Decision #4). TerminalPane's
   `onClose` signature is widened to `(sessionId, paneId)` so the
   handler thread through both ids without bind-trickery.
8. **`setSessionActivePane` Rust sync** — the mutation gains a
   `service.setActiveSession(newPtyId)` IPC call after the React
   state commit, guarded by `sessionId === activeSessionIdRef.current`
   (only sync when we're rotating panes _within_ the focused session
   tab — otherwise we'd accidentally rotate Rust's active tab).
9. **`progress.yaml` update** — flip `ui-s5c-2` from `pending` to
   `in_progress` at PR open, to `done` on merge with the commit + PR
   id; update phase `notes` to mention 5d as the next active step.
10. **`pendingPaneOps: Set<string>` per-session serialization** —
    new ref on `useSessionManager`. Each `addPane` / `removePane`
    adds `sessionId` to the set before its async work and removes it
    in `finally`. Concurrent calls on the same session warn and
    return. Independent of `pendingSpawns` (which counts globally
    for the auto-create-on-empty effect). See Decision #12 for the
    race-class this closes.
11. **`Session.status` re-derivation in both reducers** — both
    `applyAddPane` and `applyRemovePane` call `deriveSessionStatus(panes)`
    (existing helper in `utils/sessionStatus.ts`) and set
    `Session.status` on the updated session. Without this, adding a
    `'running'` pane to a `'completed'` session leaves
    `session.status='completed'`, and closing the only `'running'`
    pane in a mixed session leaves `session.status='running'` —
    chrome (Restart affordance, status pip) would diverge from the
    actual per-pane state. See Decision #13.

## Non-goals

1. **Auto-grow on layout pick (one-shot parallel PTY fan-out)** —
   5d. Picking `quad` from a single-pane session still produces
   1 real pane + 3 `EmptySlot`s; users click each `+` to fill.
2. **Per-pane agent picker on `+`** — 5c-2 ships
   `agentType='generic'` (matches `createSession`). The agent
   detector promotes the new pane via `updatePaneAgentType` once a
   known CLI is detected. A picker UI is a candidate for a later
   spec when telemetry justifies it.
3. **Per-pane cwd picker on `+`** — 5c-2 inherits the active pane's
   `cwd`. The user can `cd` inside the new pane immediately after
   spawn.
4. **Drag-to-reorder panes** within a session.
5. **Drag-to-resize grid tracks** — canonical layouts have fixed
   ratios; resizing collapses 5b's CSS Grid contract.
6. **Cross-session pane moves** (drag a pane between session tabs).
7. **Sticky-layout-with-empty-slots variant** — Decision #3 picks
   shrink-to-fit. The alternative (keep `quad` with empty slots
   after a close) was explicitly rejected during brainstorming.
8. **Per-session "last multi-layout memory"** — closing 4→1 demotes
   to `single`; re-picking `quad` does NOT remember pane
   composition (the prior `quad` panes are killed PTYs).
9. **Backend persistence of multi-pane state changes** — Rust caches
   each PTY individually (5a non-goal #7 unchanged). 5c-2 does not
   touch `src-tauri/src/**` or `src/bindings/**` for state schema.
   The ONLY Rust IPC touched is `service.setActiveSession`, which
   already exists.

## Decisions

| #   | Decision                                                                                                                                                                                                                               | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Approach B (pure-reducer utils in `src/features/sessions/utils/paneLifecycle.ts`); `useSessionManager` callbacks are thin wrappers                                                                                                     | Matches 5a's `applyActivePane` precedent — invariants live in one place, tests are pure (no React, no mocks). The wrapper callbacks do only what reducers can't: input validation, async `service.spawn`/`service.kill`, post-commit IPC. Approach A (inline `useCallback` mutations) would duplicate validation + materialization logic across two more multi-step bodies in an already-980-LOC hook.                                                                                                                                                                                                                                                                                                                         |
| 2   | `addPane` is **one-click spawn** — default `agentType='generic'`, `cwd` inherited from the active pane                                                                                                                                 | Fastest UX. The agent detector promotes `agentType` to `'claude-code'` / `'codex'` / `'aider'` within seconds of the first command. The picker alternative is a future enhancement when telemetry shows users repeatedly re-binding agentType post-spawn. cwd-inheritance is the highest-conversion default: users overwhelmingly want a side terminal in the same directory.                                                                                                                                                                                                                                                                                                                                                  |
| 3   | Auto-shrink layout to fit remaining pane count on `removePane`                                                                                                                                                                         | Matches handoff prototype `app.jsx:184-206`. Predictable: closing always reduces capacity. The "sticky layout with empty slots" alternative was rejected because empty slots immediately after a close are confusing — users expect the visible grid to reflect their actual panes. Users who _want_ a placeholder for a future pane can pick a bigger layout via the LayoutSwitcher and click `+`.                                                                                                                                                                                                                                                                                                                            |
| 4   | X-close button hidden when `session.panes.length === 1`; SplitView passes `onClose` to `TerminalPane` only for multi-pane sessions                                                                                                     | Matches handoff prototype `splitview.jsx:743-745` (`visiblePanes.length > 1 ? () => onClosePane(pane.id) : null`). Two paths to the same end-state ("close session") is worse than one. The tab-strip X (`removeSession`) is the single way to remove a session. Conflating with `removeSession` would also race: the X click would trigger `removePane`, which would early-return (`panes.length` would become 0), and the user would see no effect.                                                                                                                                                                                                                                                                          |
| 5   | `service.setActiveSession(newPtyId)` IPC fires on every `setSessionActivePane` rotation, guarded by `sessionId === activeSessionIdRef.current`                                                                                         | Closes 5c-1 Decision #10's deferred divergence. Rust's cached active PTY tracks the focused pane within the focused session, not just the session-tab granularity. The guard prevents accidental session-tab rotation when a non-active session programmatically rotates its panes (e.g., a future bulk-state restore). One extra IPC per click is negligible (Rust's setter is a single hash-map write).                                                                                                                                                                                                                                                                                                                      |
| 6   | Active-after-close: prefer `panes[closedIdx − 1].id`; if no predecessor, fall through to `panes[closedIdx + 1]?.id` (the successor in the **before-splice** array, which shifts into the closed slot's index after the splice commits) | Matches editor/tab conventions (Vim splits, VS Code panes). Predictable left-drift. The "next index, fall to previous" alternative shifts focus to the SAME visual position as the closed pane (which feels jumpy) and depends on splice semantics that are confusing to reason about at the call site.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | `EmptySlot` is visible only at indices `panes.length..layout.capacity − 1`; clicking it does **not** auto-grow the layout                                                                                                              | Keeps 5c-2 focused on slot-level mutation. Auto-grow on layout pick is 5d's explicit scope. The user grows by picking a larger layout via the LayoutSwitcher, then fills the new slots via `+`. The `+` button is purely additive within the current grid.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | `removePane` early-returns with `console.warn` when `panes.length` would become 0                                                                                                                                                      | Defense-in-depth. Decision #4 already hides the X for single-pane sessions, so this branch should not be reachable from the UI. The guard catches programmatic mis-use (test fixtures, future bulk-state restore) and provides a clear log line instead of an invariant-violation throw deep in the reducer.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | `removePane` kills first, then mutates React state — same ordering as `removeSession`                                                                                                                                                  | If `service.kill` rejects, the pane stays visible (and live in Rust) — recoverable. If we mutated state first and `service.kill` rejected, the React tab would lose the pane while the PTY stayed alive in Rust with no chrome to control it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 10  | TerminalPane's `onClose` prop signature widened from `(sessionId: string) => void` to `(sessionId: string, paneId: string) => void`                                                                                                    | TerminalPane already knows `pane.id`; threading it through the prop avoids `() => onClosePane(session.id, pane.id)` bind-trickery at every call site (SplitView slot map). One TerminalPane consumer today (SplitView); the test suite mocks `onClose` and updates trivially. Existing pre-5b `onClose` was a no-op in production — 5b passed nothing.                                                                                                                                                                                                                                                                                                                                                                         |
| 11  | One PR for 5c-2 (estimated +900–1100 LOC across ~14 files)                                                                                                                                                                             | The lifecycle surface is tightly coupled — splitting into 5c-2a (close + auto-shrink) and 5c-2b (`+` + addPane) would ship a non-functional intermediate state (X-close but no way to recreate). 30–40 min reviewer load is the same bar 5c-1 cleared. Per-file diffs stay small because the pure-reducer split (Decision #1) concentrates logic in two new files.                                                                                                                                                                                                                                                                                                                                                             |
| 12  | Per-session pane-op serialization via a `pendingPaneOps: Set<string>` ref on `useSessionManager`. addPane / removePane add `sessionId` before async work, remove in `finally`; concurrent calls on the same session warn + return      | Closes two race classes codex flagged on the first review pass: (a) two `addPane`s racing against `nextFreePaneId` + the layout-capacity check, where both pick the same `'pN'` and one is silently dropped by the collision guard, orphaning a Rust PTY; (b) two `removePane`s on a 2-pane session both passing the `panes.length === 1` pre-flight, both killing a PTY, and the second reducer commit no-op'ing — leaving a surviving pane whose PTY was already killed in Rust. The serialization gate is per-session (not global), so closing pane in session A while adding in session B remains concurrent. Cheap (a `Set.has` lookup); independent of `pendingSpawns` (which counts globally for auto-create-on-empty). |
| 13  | Both reducers re-derive `Session.status` via `deriveSessionStatus(panes)` after mutating `panes[]`                                                                                                                                     | The existing `onPtyExitRef` pathway already calls `deriveSessionStatus` on every exit. Without the same call in `applyAddPane` / `applyRemovePane`, adding a `'running'` pane to a `'completed'` session leaves `session.status='completed'`, and closing the last `'running'` pane in a mixed session leaves `session.status='running'`. Chrome consumers (Restart affordance in `TerminalPane`, status pip in `Sidebar` session rows, etc.) would diverge from the actual per-pane state.                                                                                                                                                                                                                                    |

## §1 Architecture — module decomposition + file-level scope

### Identification namespaces (carried over from 5a / 5b / 5c-1)

| Namespace    | Used for                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.id` | Addressing key for `addPane(sessionId)`, `removePane(sessionId, paneId)`. SplitView outer wrapper `data-session-id`.                                                                                                                                                                                                                                                                                              |
| `pane.id`    | Session-scoped pane id (`'p0'`, `'p1'`, …). React key + Framer Motion `layoutId` in SplitView slot wrappers (5b / 5c-1). 5c-2 addressing handle for `removePane`. New pane id derived as `'p' + nextFreeIndex(session.panes)` — the smallest non-negative integer whose `'p'`-prefixed form is absent from existing pane ids (handles holes after a removePane, though the array is compacted so holes are rare). |
| `pane.ptyId` | Rust IPC handle. 5c-2 uses it for `service.kill` (removePane) and `service.setActiveSession` (Rust sync). Unchanged semantically from 5a.                                                                                                                                                                                                                                                                         |

5c-2 adds no new id namespaces.

### Module shape

```
src/features/sessions/
├── utils/
│   ├── paneLifecycle.ts            # NEW — applyAddPane, applyRemovePane,
│   │                                #       autoShrinkLayoutFor,
│   │                                #       pickNextActivePaneId,
│   │                                #       nextFreePaneId
│   └── paneLifecycle.test.ts       # NEW
└── hooks/
    └── useSessionManager.ts        # MODIFIED — addPane, removePane,
                                     #            setSessionActivePane
                                     #            (Rust sync)

src/features/terminal/components/
├── SplitView/
│   ├── SplitView.tsx               # MODIFIED — onAddPane / onClosePane
│   │                                #            props, EmptySlot mounting,
│   │                                #            onClose pass-through
│   ├── EmptySlot.tsx               # NEW
│   ├── EmptySlot.test.tsx          # NEW
│   └── SplitView.test.tsx          # MODIFIED
└── TerminalPane/
    └── index.tsx                   # MODIFIED — widened onClose signature

src/features/workspace/
├── WorkspaceView.tsx               # MODIFIED — wire addPane / removePane
│                                    #            from manager into TerminalZone
├── WorkspaceView.test.tsx          # MODIFIED
├── components/
│   ├── TerminalZone.tsx            # MODIFIED — thread props to SplitView
│   └── TerminalZone.test.tsx       # MODIFIED

docs/roadmap/progress.yaml          # MODIFIED — flip ui-s5c-2 status
```

### New files

| File                                                            | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | LOC  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/features/sessions/utils/paneLifecycle.ts`                  | Two reducers + three pure helpers: `applyAddPane(sessions, sessionId, newPane, capacity): { sessions, appended }`, `applyRemovePane(sessions, sessionId, paneId, currentLayoutId): { sessions, removedPtyId?, newActivePtyId? }`, `autoShrinkLayoutFor(nextCount, currentLayoutId)`, `pickNextActivePaneId(panes, closedIdx)`, `nextFreePaneId(panes)`. Two result interfaces (`ApplyAddPaneResult`, `ApplyRemovePaneResult`). Each reducer returns the same `sessions` reference on no-op branches plus the boolean / optional-id sentinel the wrapper uses to recover spawned/killed PTYs. Imports `deriveSessionStatus` from `./sessionStatus` so both reducers re-derive `Session.status` after `panes[]` mutates. | ~180 |
| `src/features/sessions/utils/paneLifecycle.test.ts`             | Pure unit tests per helper. `applyAddPane` — appends pane, flips actives, re-materializes `workingDirectory`/`agentType`, no-op on missing session. `applyRemovePane` — removes pane, auto-shrinks layout, picks next active, re-materializes, no-op on missing session/pane, returns sentinel on `panes.length` would become 0. `autoShrinkLayoutFor` — all 4 transitions × hsplit/vsplit disambiguation. `pickNextActivePaneId` — prev/next/fallback ordering. `nextFreePaneId` — sequence after holes.                                                                                                                                                                                                              | ~220 |
| `src/features/terminal/components/SplitView/EmptySlot.tsx`      | Props: `{ sessionId: string; onAddPane: (sessionId: string) => void }`. Returns a centred `+` button (`<button type="button" aria-label="add pane">`) inside a dashed-border container with hint text. `onClick={(e) => { e.stopPropagation(); onAddPane(sessionId); }}` — `stopPropagation` so the click doesn't bubble to SplitView's slot-click (which calls `onSetActivePane`; the slot has no pane to activate).                                                                                                                                                                                                                                                                                                  | ~60  |
| `src/features/terminal/components/SplitView/EmptySlot.test.tsx` | RTL: button renders with `aria-label="add pane"`; click fires `onAddPane(sessionId)`; `stopPropagation` is called (assertion via `vi.fn()` event spy or `userEvent.click` + outer `onClick` mock).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ~50  |

### Modified files

| File                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | LOC delta |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `src/features/sessions/hooks/useSessionManager.ts`              | (1) `SessionManager` interface gains `addPane(sessionId): void` and `removePane(sessionId, paneId): void`. (2) New ref: `pendingPaneOps = useRef<Set<string>>(new Set())` for per-session serialization (Decision #12). (3) New import: `LAYOUTS` from `../../terminal/components/SplitView/layouts` for capacity lookups inside both wrappers. (4) `addPane` body: serialization gate (`pendingPaneOps.has(sessionId)` → warn + return); validate session; pre-flight capacity guard against `LAYOUTS[session.layout].capacity`; `pendingPaneOps.add` + `setPendingSpawns(c => c + 1)`; `await service.spawn`; freshness re-read; `flushSync(setSessions(prev => applyAddPane(prev, sessionId, newPane, LAYOUTS[fresh.layout].capacity)))`; on `appended === false`, kill the orphan PTY + drop bookkeeping; on success: `service.setActiveSession`, `registerPtySession`; `finally` block decrements `pendingSpawns` + removes from `pendingPaneOps`. (5) `removePane` body: serialization gate; validate session + pane; pre-flight `panes.length === 1` warn + return; `pendingPaneOps.add`; `await service.kill`; on success drop bookkeeping (`dropAllForPty`, `restoreDataRef.delete`, `unregisterPtySession`); `flushSync` via `applyRemovePane(prev, sessionId, paneId, layoutAtCommit)`; if reducer returned a `newActivePtyId` AND `sessionId === activeSessionIdRef.current`, fire `service.setActiveSession(newActivePtyId)`; `finally` removes from `pendingPaneOps`. (6) `setSessionActivePane` gains a post-commit `service.setActiveSession(target.ptyId)` IPC call, guarded by `sessionId === activeSessionIdRef.current`. (7) Return both new mutations from the hook. **No changes to `createSession`, `removeSession`, `restartSession`.** | +~170     |
| `src/features/sessions/hooks/useSessionManager.test.ts`         | New tests: `addPane` — spawn called, pane appended, active flipped, `workingDirectory`/`agentType` re-derived, `service.setActiveSession` fired with new ptyId, `pendingSpawns` decremented even on spawn failure (existing pattern). `removePane` — kill called, pane spliced, layout auto-shrunk, active rotated when needed, `service.setActiveSession` fired only when removing active pane in the focused session, early-return on `panes.length === 1`. `setSessionActivePane` — IPC fired when `sessionId === activeSessionId`, NOT fired when sessionId is different.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | +~200     |
| `src/features/terminal/components/SplitView/SplitView.tsx`      | (1) Props gain `onAddPane?: (sessionId: string) => void` and `onClosePane?: (sessionId: string, paneId: string) => void`. (2) Compute `emptySlotCount = Math.max(0, layout.capacity - visiblePanes.length)`. (3) After the existing `visiblePanes.map(...)`, render an additional `Array.from({ length: emptySlotCount }, (_, k) => visiblePanes.length + k)` of `EmptySlot` wrappers inside the same `<AnimatePresence>` block, each as `<motion.div key={\`empty-\${idx}\`} layout layoutId={\`empty-${session.id}-${idx}\`} ... style={{ gridArea: \`p${idx}\` }}>`containing an`<EmptySlot sessionId={session.id} onAddPane={onAddPane!} />`. The `key`and`layoutId`are stable across renders so empty-slot mount/unmount is smooth. (4) For each *real* pane, pass`onClose={session.panes.length > 1 && onClosePane ? onClosePane : undefined}`to`TerminalPane`. (5) The slot `onClick`(click-to-focus, 5c-1) is unchanged for real panes; empty slots have no slot-onClick (they delegate to`EmptySlot`'s own button).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | +~40, -~5 |
| `src/features/terminal/components/SplitView/SplitView.test.tsx` | New tests: `addPane` empty-slot rendering — single-pane session in `vsplit` shows 1 `EmptySlot` (capacity 2 - 1 pane); quad with 1 pane shows 3 `EmptySlot`s; single layout never shows `EmptySlot`. EmptySlot click fires `onAddPane(session.id)`. `onClose` pass-through — multi-pane session passes `onClose` to TerminalPane; single-pane session does NOT (verify via `vi.mocked(TerminalPane).mock.calls[0][0].onClose === undefined`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | +~100     |
| `src/features/terminal/components/TerminalPane/index.tsx`       | (1) `onClose` prop signature widened from `(sessionId: string) => void` to `(sessionId: string, paneId: string) => void`. (2) `handleClose` updated to call `onClose?.(session.id, pane.id)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | +~2, -~2  |
| `src/features/terminal/components/TerminalPane/index.test.tsx`  | Update existing `onClose` tests to assert the widened signature (call args include both `session.id` and `pane.id`). One new test: `onClose=undefined` → X button not rendered (already covered by Header tests; verify the cascade).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | +~10, -~3 |
| `src/features/workspace/WorkspaceView.tsx`                      | Destructure `addPane`, `removePane` from `useSessionManager`. Pass both to `TerminalZone`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | +~5       |
| `src/features/workspace/WorkspaceView.test.tsx`                 | Mock `useSessionManager` returns include `addPane` + `removePane`. Assert `TerminalZone` receives them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | +~10      |
| `src/features/workspace/components/TerminalZone.tsx`            | Props gain `addPane`, `removePane`. Pass `onAddPane={addPane}` and `onClosePane={removePane}` to `SplitView`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | +~5       |
| `src/features/workspace/components/TerminalZone.test.tsx`       | Add assertions that the new props thread through to `SplitView` (mocked).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | +~20      |
| `docs/roadmap/progress.yaml`                                    | Flip `ui-s5c-2` from `pending` to `in_progress` at PR open, to `done` on merge (with commit + PR id). Update phase `notes` to point at 5d as next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | +~5, -~3  |

### Files NOT touched

| File                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/sessions/types/index.ts`                            | 5a's `Pane` / `LayoutId` / `Session` are sufficient. No new fields needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/features/sessions/utils/activeSessionPane.ts`                | `applyActivePane`, `findActivePane`, `getActivePane` unchanged. The new `paneLifecycle.ts` calls neither directly — invariants are enforced inline within the reducers using the same patterns.                                                                                                                                                                                                                                                                                                                                                   |
| `src/features/terminal/components/SplitView/layouts.ts`           | `LAYOUTS` constants unchanged. `autoShrinkLayoutFor` reads from `LayoutId` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/features/terminal/components/TerminalPane/Header.tsx`        | Header already accepts + passes through `onClose`. No signature change needed at this layer — Header.tsx's `onClose?: () => void` shape (zero-arg) stays; the bind is at TerminalPane's `handleClose` where the wider call ergonomically lands.                                                                                                                                                                                                                                                                                                   |
| `src/features/terminal/components/TerminalPane/HeaderActions.tsx` | Already renders the X button with `aria-label="close pane"` when `onClose` is non-undefined. Visibility is governed by SplitView's pass-through.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/features/terminal/components/TerminalPane/Body.tsx` / others | Unchanged. Add/remove flows reuse 5b's `attach` / `spawn` mode-selection logic via the existing `paneMode` helper in `SplitView.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/features/terminal/hooks/usePaneShortcuts.ts`                 | 5c-1's hook is unchanged. ⌘\\ cycling already documented as benign in 5c-1 risk #2 — cycling from `quad` (4 panes) to `single` (capacity 1) hides 3 panes visually but PTYs stay alive (5b's clamp). 5c-2 does NOT add a capacity-filter to the cycle (out of scope; tracked as a future enhancement).                                                                                                                                                                                                                                            |
| `src/features/terminal/hooks/useTerminal.ts`                      | The attach/spawn lifecycle reuses createSession's pattern via `registerPending` + `notifyPaneReady`. 5c-2 plugs into existing entry points.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src-tauri/src/**` / `src/bindings/**`                            | No new IPC. `service.setActiveSession` and `service.kill` / `service.spawn` already exist (used by 5a/5b for session-tab rotations and `createSession`/`removeSession`).                                                                                                                                                                                                                                                                                                                                                                          |
| `tailwind.config.js`                                              | EmptySlot uses existing tokens (`bg-surface-container`, `text-on-surface-muted`, `border-dashed`).                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/features/sessions/hooks/useSessionRestore.ts`                | Restore is left as-is — `sessionFromInfo` still maps each cached PTY to its own single-pane `Session`. **Multi-pane state does NOT persist across reload.** A user with two panes in session S who reloads the app gets two single-pane sessions back. Acceptable for 5c-2: per-PTY restore is correct in isolation, the UI re-renders cleanly, no orphan PTYs. Multi-pane persistence is a separate concern (see non-goal #9; backend cache schema change) and is tracked for a follow-up spec once multi-pane usage is observable in telemetry. |

### Reducer signatures (in `paneLifecycle.ts`)

```ts
import type { LayoutId, Pane, Session } from '../types'

/** Return value for `applyAddPane`. `appended === false` covers three
 *  no-op branches (missing session, pane id collision, capacity full
 *  against the latest committed state). The wrapper kills the freshly
 *  spawned PTY when `appended === false` so a lost race doesn't
 *  orphan a live PTY in Rust. */
export interface ApplyAddPaneResult {
  sessions: Session[]
  appended: boolean
}

/** Return value for `applyRemovePane`. `removedPtyId` carries the
 *  PTY handle the wrapper should drop bookkeeping for; absent when
 *  the reducer no-op'd (missing session/pane, or `panes.length <= 1`
 *  at commit time — the consumer's pre-flight should already have
 *  caught this, but the reducer is defensive). `newActivePtyId` is
 *  set only when the removed pane was the active one AND a successor
 *  was chosen; the consumer fires `service.setActiveSession` outside
 *  the reducer. */
export interface ApplyRemovePaneResult {
  sessions: Session[]
  removedPtyId?: string
  newActivePtyId?: string
}

export const applyAddPane: (
  sessions: Session[],
  sessionId: string,
  newPane: Pane,
  capacity: number
) => ApplyAddPaneResult

export const applyRemovePane: (
  sessions: Session[],
  sessionId: string,
  paneId: string,
  currentLayoutId: LayoutId
) => ApplyRemovePaneResult

export const autoShrinkLayoutFor: (
  nextPaneCount: number,
  currentLayoutId: LayoutId
) => LayoutId

export const pickNextActivePaneId: (
  panes: readonly Pane[],
  closedIdx: number
) => string | null

export const nextFreePaneId: (panes: readonly Pane[]) => string
```

Both reducers also import `deriveSessionStatus` from
`./sessionStatus` and call it on the new `panes[]` so `Session.status`
re-derives in lockstep with `panes` mutations (Decision #13).

### Net file count + LOC

- **New:** 4 files, ~520 LOC (paneLifecycle.ts + tests share ~310 LOC, EmptySlot + tests share ~110 LOC).
- **Modified:** 10 files, ~+475 / -~13 LOC.
- **Total:** ~+995 / -~13, ~1000 LOC across ~14 files.

Comparable to 5c-1 (~1006 LOC across 17 files). The pure-reducer split keeps the test bulk in `paneLifecycle.test.ts` (pure, fast) rather than the React-bound `useSessionManager.test.ts`. The serialization gate (Decision #12) and capacity recheck (Decision #1's `appended` sentinel) added ~50 LOC vs the first-pass estimate.

## §2 Component APIs

### `paneLifecycle.ts` — reducers + helpers

```ts
// cspell:ignore vsplit hsplit
import type { LayoutId, Pane, Session } from '../types'
import { deriveSessionStatus } from './sessionStatus'

export interface ApplyAddPaneResult {
  sessions: Session[]
  /** True when the new pane was actually appended; false on no-op
   *  branches (missing session, pane id collision, capacity full at
   *  commit time). The consumer kills the freshly spawned PTY when
   *  `appended === false` so a race-lost spawn doesn't orphan a live
   *  PTY in Rust. */
  appended: boolean
}

export interface ApplyRemovePaneResult {
  sessions: Session[]
  /** Set when a pane was actually spliced out; consumers drop
   *  PTY bookkeeping for this id. Absent on no-op branches. */
  removedPtyId?: string
  /** Set when the removed pane was the active one AND a successor
   *  was chosen (`pickNextActivePaneId` returned non-null). The
   *  consumer fires `service.setActiveSession(newActivePtyId)`
   *  outside the reducer. */
  newActivePtyId?: string
}

export const autoShrinkLayoutFor = (
  nextPaneCount: number,
  currentLayoutId: LayoutId
): LayoutId => {
  if (nextPaneCount <= 1) return 'single'
  if (nextPaneCount === 2) {
    return currentLayoutId === 'hsplit' ? 'hsplit' : 'vsplit'
  }
  if (nextPaneCount === 3) return 'threeRight'
  // Defensive — removePane clamps to `panes.length − 1`, so 4 is
  // only reachable from a 5-pane fixture (5b's clamp invariant
  // would have already rejected). Returning currentLayoutId keeps
  // the reducer total.
  return currentLayoutId
}

export const pickNextActivePaneId = (
  panes: readonly Pane[],
  closedIdx: number
): string | null => {
  // `panes` is the BEFORE-splice array; the caller has already
  // verified panes[closedIdx] exists.
  const prev = panes[closedIdx - 1]
  if (prev) return prev.id
  // After splice, panes[closedIdx + 1] shifts into closedIdx —
  // we resolve to its id here to match the post-splice array
  // shape the consumer will commit.
  const next = panes[closedIdx + 1]
  return next?.id ?? null
}

export const nextFreePaneId = (panes: readonly Pane[]): string => {
  const ids = new Set(panes.map((p) => p.id))
  let n = 0
  // Linear scan is fine for capacity ≤ 4 (5c-2 layouts max out at
  // quad). The set lookup keeps the scan O(capacity).
  while (ids.has(`p${n}`)) n += 1
  return `p${n}`
}

export const applyAddPane = (
  sessions: Session[],
  sessionId: string,
  newPane: Pane,
  capacity: number
): ApplyAddPaneResult => {
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) return { sessions, appended: false }

  const session = sessions[idx]
  // Capacity guard — runs against the latest committed `prev` so a
  // concurrent addPane that filled the slot during this call's await
  // window is detected at commit time. The wrapper passes
  // `LAYOUTS[session.layout].capacity`; reading capacity here (not
  // outside the updater) is the only race-safe check.
  if (session.panes.length >= capacity) {
    return { sessions, appended: false }
  }
  // Pane-id collision (defense-in-depth — the wrapper's
  // `nextFreePaneId` should never produce a duplicate, but a
  // programmatic caller could).
  if (session.panes.some((p) => p.id === newPane.id)) {
    return { sessions, appended: false }
  }

  // Flip every existing pane to inactive; new pane is the active one.
  const existing = session.panes.map((p) =>
    p.active === false ? p : { ...p, active: false }
  )
  const panes: Pane[] = [...existing, { ...newPane, active: true }]

  const updated: Session = {
    ...session,
    panes,
    status: deriveSessionStatus(panes),
    workingDirectory: newPane.cwd,
    agentType: newPane.agentType,
  }

  return {
    sessions: [...sessions.slice(0, idx), updated, ...sessions.slice(idx + 1)],
    appended: true,
  }
}

export const applyRemovePane = (
  sessions: Session[],
  sessionId: string,
  paneId: string,
  currentLayoutId: LayoutId
): ApplyRemovePaneResult => {
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) return { sessions }

  const session = sessions[idx]
  const closedIdx = session.panes.findIndex((p) => p.id === paneId)
  if (closedIdx === -1) return { sessions }

  // Decision #8 — never let the reducer produce panes.length === 0;
  // the consumer (`removePane` in useSessionManager) warns earlier.
  if (session.panes.length <= 1) return { sessions }

  const closedPane = session.panes[closedIdx]
  const wasActive = closedPane.active

  const remaining = [
    ...session.panes.slice(0, closedIdx),
    ...session.panes.slice(closedIdx + 1),
  ]

  let panes = remaining
  let newActivePtyId: string | undefined

  if (wasActive) {
    const nextActiveId = pickNextActivePaneId(session.panes, closedIdx)
    // nextActiveId is non-null because remaining.length ≥ 1
    // (we early-returned when length ≤ 1 above).
    panes = remaining.map((p) =>
      p.id === nextActiveId ? { ...p, active: true } : p
    )
    newActivePtyId = panes.find((p) => p.active)?.ptyId
  }

  const nextLayout = autoShrinkLayoutFor(remaining.length, currentLayoutId)
  const active = panes.find((p) => p.active)
  // Invariant: applyRemovePane preserves exactly-one-active.
  // `active` is always defined here — if wasActive, we just
  // promoted the successor; if !wasActive, the still-active
  // original pane survived the splice.
  const updated: Session = {
    ...session,
    panes,
    layout: nextLayout,
    status: deriveSessionStatus(panes),
    workingDirectory: active?.cwd ?? session.workingDirectory,
    agentType: active?.agentType ?? session.agentType,
  }

  return {
    sessions: [...sessions.slice(0, idx), updated, ...sessions.slice(idx + 1)],
    removedPtyId: closedPane.ptyId,
    newActivePtyId,
  }
}
```

### `EmptySlot.tsx`

```tsx
import type { ReactElement, MouseEvent } from 'react'

export interface EmptySlotProps {
  sessionId: string
  onAddPane: (sessionId: string) => void
}

export const EmptySlot = ({
  sessionId,
  onAddPane,
}: EmptySlotProps): ReactElement => {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    // Stop propagation so the slot-click (`onSetActivePane`, 5c-1)
    // doesn't fire — the empty slot has no pane to activate.
    event.stopPropagation()
    onAddPane(sessionId)
  }

  return (
    <div
      data-testid="empty-slot"
      className="flex h-full w-full items-center justify-center rounded-[10px] border border-dashed border-on-surface/15 bg-surface-container/30"
    >
      <button
        type="button"
        aria-label="add pane"
        onClick={handleClick}
        className="flex flex-col items-center gap-2 rounded-md px-4 py-3 text-on-surface-muted transition-colors hover:bg-on-surface/5 hover:text-on-surface"
      >
        <span className="text-2xl leading-none">+</span>
        <span className="font-mono text-xs uppercase tracking-wider">
          add pane
        </span>
      </button>
    </div>
  )
}
```

### `SplitView` — additive props + EmptySlot mounting

```tsx
export interface SplitViewProps {
  session: Session
  service: ITerminalService
  isActive: boolean
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onSessionRestart?: (sessionId: string) => void
  onSetActivePane?: (sessionId: string, paneId: string) => void
  /** NEW in 5c-2: `+ click to add pane` dispatcher. */
  onAddPane?: (sessionId: string) => void
  /** NEW in 5c-2: X-close per-pane dispatcher. */
  onClosePane?: (sessionId: string, paneId: string) => void
  deferTerminalFit?: boolean
}

// Inside the render — after visiblePanes.map(...) closes, add:
const emptySlotCount = Math.max(0, layout.capacity - visiblePanes.length)
const emptySlotIndices = Array.from(
  { length: emptySlotCount },
  (_, k) => visiblePanes.length + k
)

// Inside <AnimatePresence initial={false}>, append:
{
  emptySlotIndices.map((slotIdx) =>
    onAddPane ? (
      <motion.div
        key={`empty-${slotIdx}`}
        layout
        // Stable layoutId so empty-slot mount/unmount through layout
        // changes plays as a slot-level animation rather than a
        // pane-level one (the empty slot is not a pane).
        layoutId={`empty-${session.id}-${slotIdx}`}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        data-testid="split-view-empty-slot"
        className="relative min-h-0 min-w-0"
        style={{ gridArea: `p${slotIdx}` }}
      >
        <EmptySlot sessionId={session.id} onAddPane={onAddPane} />
      </motion.div>
    ) : null
  )
}

// For real panes — pass onClose only when there are siblings:
;<TerminalPane
  key={pane.ptyId}
  session={session}
  pane={pane}
  service={service}
  mode={mode}
  onCwdChange={(cwd) => onSessionCwdChange?.(session.id, pane.id, cwd)}
  onClose={session.panes.length > 1 && onClosePane ? onClosePane : undefined}
  onPaneReady={onPaneReady}
  onRestart={onSessionRestart}
  isActive={isActive}
  deferFit={deferTerminalFit}
/>
```

### `TerminalPane/index.tsx` — widened `onClose`

```tsx
export interface TerminalPaneProps {
  session: Session
  pane: Pane
  isActive: boolean
  service: ITerminalService
  onPaneReady?: NotifyPaneReady
  mode?: TerminalPaneMode
  /** Widened in 5c-2 from `(sessionId) => void` so multi-pane
   *  callers (SplitView) can address the closed pane without
   *  bind-trickery. */
  onClose?: (sessionId: string, paneId: string) => void
  onCwdChange?: (cwd: string) => void
  onRestart?: (sessionId: string) => void
  deferFit?: boolean
}

// Inside the body — handleClose changes from:
//   const handleClose = useCallback((): void => {
//     onClose?.(session.id)
//   }, [onClose, session.id])
// to:
const handleClose = useCallback((): void => {
  onClose?.(session.id, pane.id)
}, [onClose, session.id, pane.id])
```

### `addPane` (added inside `useSessionManager` body)

```ts
// Declared once near the other refs at the top of the hook body:
//   const pendingPaneOps = useRef<Set<string>>(new Set())
// The set holds session ids whose addPane / removePane is currently
// in flight. Per-session — addPane on session A while removePane is
// in flight on session B is still concurrent.

const addPane = useCallback(
  (sessionId: string): void => {
    if (pendingPaneOps.current.has(sessionId)) {
      // eslint-disable-next-line no-console
      console.warn(
        `addPane: another pane op in flight for ${sessionId}; ignoring`
      )
      return
    }

    const session = sessionsRef.current.find((s) => s.id === sessionId)
    if (!session) {
      // eslint-disable-next-line no-console
      console.warn(`addPane: no session ${sessionId}`)
      return
    }
    const activePane = findActivePane(session)
    if (!activePane) {
      // eslint-disable-next-line no-console
      console.warn(`addPane: session ${sessionId} has no active pane`)
      return
    }
    // Pre-flight capacity guard — cheap reject before the spawn IPC.
    // The reducer re-checks against the latest committed state at
    // commit time, but this short-circuits the no-op when capacity
    // is already obviously full.
    if (session.panes.length >= LAYOUTS[session.layout].capacity) {
      // eslint-disable-next-line no-console
      console.warn(
        `addPane: session ${sessionId} is at capacity for layout ${session.layout}`
      )
      return
    }

    pendingPaneOps.current.add(sessionId)
    setPendingSpawns((c) => c + 1)
    void (async (): Promise<void> => {
      try {
        const result = await service.spawn({
          cwd: activePane.cwd,
          env: {},
          enableAgentBridge: true,
        })

        const restoreData: RestoreData = {
          sessionId: result.sessionId,
          cwd: result.cwd,
          pid: result.pid,
          replayData: '',
          replayEndOffset: 0,
          bufferedEvents: [],
        }

        // Read the freshest session for nextFreePaneId and the
        // capacity recheck — the user may have addPane'd in another
        // session, or removePane'd, during the spawn await.
        const fresh = sessionsRef.current.find((s) => s.id === sessionId)
        if (!fresh) {
          // Session removed during the spawn await; kill the orphan.
          // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
          service.kill({ sessionId: result.sessionId }).catch(() => {})
          return
        }

        const newPane: Pane = {
          id: nextFreePaneId(fresh.panes),
          ptyId: result.sessionId,
          cwd: result.cwd,
          agentType: 'generic',
          status: 'running',
          active: true,
          pid: result.pid,
          restoreData,
        }

        restoreDataRef.current.set(fresh.id, restoreData)
        registerPending(result.sessionId)

        let appended = false
        flushSync(() => {
          setSessions((prev) => {
            const target = prev.find((s) => s.id === sessionId)
            const capacityAtCommit = target
              ? LAYOUTS[target.layout].capacity
              : 0
            const result_ = applyAddPane(
              prev,
              sessionId,
              newPane,
              capacityAtCommit
            )
            appended = result_.appended
            return result_.sessions
          })
        })

        if (!appended) {
          // Reducer no-op'd — capacity full at commit (lost a race
          // against another addPane, or a layout shrunk under us)
          // or pane id collision. Kill the freshly-spawned PTY and
          // drop bookkeeping so it doesn't orphan in Rust.
          // eslint-disable-next-line promise/prefer-await-to-then,@typescript-eslint/no-empty-function
          service.kill({ sessionId: result.sessionId }).catch(() => {})
          restoreDataRef.current.delete(result.sessionId)
          // eslint-disable-next-line no-console
          console.warn(
            `addPane: reducer rejected commit for ${sessionId}; orphan killed`
          )
          return
        }

        if (sessionId === activeSessionIdRef.current) {
          service.setActiveSession(result.sessionId).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('addPane: setActiveSession failed', err)
          })
        }
        registerPtySession(result.sessionId, result.sessionId, result.cwd)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('addPane: spawn failed', err)
      } finally {
        setPendingSpawns((c) => c - 1)
        pendingPaneOps.current.delete(sessionId)
      }
    })()
  },
  [activeSessionIdRef, registerPending, service]
)
```

Note: `LAYOUTS` is imported from
`../../terminal/components/SplitView/layouts` at the top of
`useSessionManager.ts`. The cross-feature import already exists
implicitly via the SplitView component tree; making it explicit here
is acceptable because `LAYOUTS` is constant data, not behaviour. An
alternative is to lift `LAYOUTS` into `src/features/sessions/utils/`
alongside the reducers — out of scope for 5c-2 but worth flagging
during PR review if the import bothers reviewers.

### `removePane` (added inside `useSessionManager` body)

```ts
const removePane = useCallback(
  (sessionId: string, paneId: string): void => {
    if (pendingPaneOps.current.has(sessionId)) {
      // eslint-disable-next-line no-console
      console.warn(
        `removePane: another pane op in flight for ${sessionId}; ignoring`
      )
      return
    }

    const session = sessionsRef.current.find((s) => s.id === sessionId)
    if (!session) {
      // eslint-disable-next-line no-console
      console.warn(`removePane: no session ${sessionId}`)
      return
    }
    const target = session.panes.find((p) => p.id === paneId)
    if (!target) {
      // eslint-disable-next-line no-console
      console.warn(`removePane: no pane ${paneId} in session ${sessionId}`)
      return
    }
    if (session.panes.length === 1) {
      // eslint-disable-next-line no-console
      console.warn(
        `removePane: refusing to remove the last pane in ${sessionId}; ` +
          `use removeSession instead`
      )
      return
    }

    pendingPaneOps.current.add(sessionId)
    void (async (): Promise<void> => {
      try {
        try {
          await service.kill({ sessionId: target.ptyId })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('removePane: kill failed; pane preserved', err)
          return
        }

        dropAllForPty(target.ptyId)
        restoreDataRef.current.delete(target.ptyId)
        unregisterPtySession(target.ptyId)

        let computedActivePtyId: string | undefined
        flushSync(() => {
          setSessions((prev) => {
            const fresh = prev.find((s) => s.id === sessionId)
            // Layout id may have changed during the kill await (5c-1's
            // LayoutSwitcher); read it fresh so auto-shrink sees the
            // user's most recent pick.
            const layoutAtCommit = fresh?.layout ?? session.layout
            const result = applyRemovePane(
              prev,
              sessionId,
              paneId,
              layoutAtCommit
            )
            computedActivePtyId = result.newActivePtyId
            return result.sessions
          })
        })

        if (
          computedActivePtyId !== undefined &&
          sessionId === activeSessionIdRef.current
        ) {
          service.setActiveSession(computedActivePtyId).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('removePane: setActiveSession failed', err)
          })
        }
      } finally {
        pendingPaneOps.current.delete(sessionId)
      }
    })()
  },
  [activeSessionIdRef, dropAllForPty, service]
)
```

### `setSessionActivePane` — post-commit Rust sync (Decision #5)

```ts
// Existing body (5c-1) lives unchanged through the React state
// update. Add a trailing IPC call:
setSessions((prev) => applyActivePane(prev, sessionId, paneId))

if (sessionId === activeSessionIdRef.current) {
  service.setActiveSession(target.ptyId).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('setSessionActivePane: setActiveSession failed', err)
  })
}
```

The IPC fires AFTER `setSessions` schedules the update. `setSessions`
is synchronous-effect, the IPC is async; no ordering risk because
Rust's `setActiveSession` is idempotent — re-asserting the new active
PTY is safe even if React's commit happens to be deferred a tick.

## §3 Testing approach

### Coverage targets

| File                          | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paneLifecycle.test.ts`       | **`applyAddPane`**: returns `{ appended: true }` and appends pane, flips every other pane to inactive, re-materializes `workingDirectory`/`agentType`, **re-derives `Session.status` via `deriveSessionStatus` — e.g. adding a `'running'` pane to a `'completed'` session flips status to `'running'`**. Returns `{ sessions: <same ref>, appended: false }` on no-op branches: missing sessionId, pane.id collision, **`panes.length >= capacity`** (e.g. 2 panes in a `vsplit` (capacity 2) session → reducer rejects). **`applyRemovePane`**: removes pane, splices array, auto-shrinks layout per all (count, prevLayout) pairs, picks next active when removed pane was active, leaves other panes' active flag untouched when removed pane was inactive, **re-derives `Session.status` — e.g. closing the only `'running'` pane in a mixed running+completed session flips status to `'completed'`**. Returns `removedPtyId` + `newActivePtyId` correctly, no-op on missing session/pane, no-op on `panes.length === 1`. **`autoShrinkLayoutFor`**: 1 → single, 2 from hsplit → hsplit, 2 from vsplit/threeRight/quad → vsplit, 3 → threeRight, 4 → currentLayoutId (defensive). **`pickNextActivePaneId`**: prev exists → prev.id; closing first pane → `panes[closedIdx + 1]?.id` (before-splice successor); closing only pane (panes.length=1) → null (caller never hits this branch but the helper handles it). **`nextFreePaneId`**: empty → 'p0'; ['p0'] → 'p1'; ['p0','p2'] → 'p1'; ['p1','p0','p2'] → 'p3'.                                                                                                                                                                                                                                 |
| `useSessionManager.test.ts`   | **`addPane`**: 2-pane fixture (vsplit, capacity 2) → reducer rejects when capacity full; capacity-2 layout already-2-pane → addPane warns + no-op (pre-flight); 1-pane vsplit → 2 panes after addPane, new pane is active, `service.spawn` called with active pane's cwd + `enableAgentBridge`, `service.setActiveSession` called with new ptyId when session is active, NOT called when session is inactive. `pendingSpawns` increments + decrements symmetrically (including on spawn failure). Spawn-during-removeSession: kills the orphan. **`pendingPaneOps` serialization**: a second `addPane(s1)` while the first is in flight → warn + no-op (no extra spawn). After the first addPane resolves, a follow-up `addPane(s1)` proceeds normally. Concurrent `addPane(s1)` + `addPane(s2)` both proceed (per-session set). **Capacity recheck race**: a second `addPane` that wins the race past pre-flight but loses at the reducer commit → reducer returns `appended: false`, wrapper kills the orphan PTY (`service.kill` called with the new ptyId). **`removePane`**: 2-pane fixture → 1 pane after, `service.kill` called with closed pane's ptyId, layout auto-shrinks (vsplit → single), active rotates when active pane closed, `service.setActiveSession` fired with new active ptyId. `panes.length === 1` → warn + no-op (pre-flight). `service.kill` rejects → React state untouched. **`pendingPaneOps` serialization**: concurrent `removePane(s1, p0)` + `removePane(s1, p1)` on a 2-pane session — second is rejected, only one `service.kill` fires, exactly one pane survives. **`setSessionActivePane`**: fires `setActiveSession` when `sessionId === activeSessionId`; does NOT fire when `sessionId` is a different session. |
| `EmptySlot.test.tsx`          | Renders button with `aria-label="add pane"` and hint text. Click fires `onAddPane(sessionId)`. `stopPropagation` is called (assert via a wrapping `<div onClick={spy}>` not firing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SplitView.test.tsx`          | New tests: empty-slot rendering for each layout × pane-count combo (`single` always 0 EmptySlots; `vsplit` with 1 pane → 1 EmptySlot; `quad` with 2 panes → 2 EmptySlots). `onAddPane` undefined → no EmptySlot rendered. Click `EmptySlot` → `onAddPane(session.id)` fires. Multi-pane session passes `onClose` to TerminalPane (via mocked TerminalPane assertion on mock.calls); single-pane session passes `onClose === undefined`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `TerminalPane/index.test.tsx` | Update existing `onClose` tests to use the widened signature. Add: clicking the X (rendered by HeaderActions when `onClose` is set) fires `onClose(session.id, pane.id)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TerminalZone.test.tsx`       | Assert `onAddPane` and `onClosePane` thread through to mocked `SplitView`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `WorkspaceView.test.tsx`      | Mock `useSessionManager` returns expanded with `addPane` + `removePane`; assert `TerminalZone` receives them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Mock strategy

- **`framer-motion`** — same convention as 5c-1: `motion.*` renders as plain DOM in jsdom; `AnimatePresence` / `LayoutGroup` are no-op wrappers. No mock needed.
- **`service.setActiveSession`** — `vi.fn().mockResolvedValue(undefined)` in `useSessionManager.test.ts`. Assert call args + count.
- **`service.spawn` / `service.kill`** — already mocked in the existing test scaffolding via `createMockTerminalService()`. Extend to assert per-test call counts for `addPane` / `removePane`.
- **`flushSync`** — used directly via the real `react-dom`; no mock.
- **`TerminalPane`** (in SplitView.test) — `vi.mock('../TerminalPane', () => ({ TerminalPane: vi.fn(() => null) }))` keeps the SplitView test pure of TerminalPane's internals. Reads `vi.mocked(TerminalPane).mock.calls[0][0]` to assert prop pass-through.

### Coverage

Per `rules/typescript/testing/CLAUDE.md`: ≥80% statement coverage. New pure helpers in `paneLifecycle.ts` target 95%+ — small, pure surfaces. Modified files maintain or improve existing coverage.

### Pre-push gate

`vitest run` runs every PR through pre-push (Husky). 5c-2 adds ~40 new test cases across 7 files. Post-5c-1 baseline (~1100 tests) climbs to ~1140.

## §4 Risks & mitigations

| Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`addPane` race with concurrent `addPane` on the same session** — User clicks `+` twice quickly. Without serialization, both `service.spawn` calls would proceed; both would compute `nextFreePaneId` against state that hasn't seen the other pending pane; both would pick `'p1'`; the second `applyAddPane` would no-op via the collision guard, orphaning a live PTY in Rust. **Worse:** picking `vsplit` (capacity 2) from a single-pane session and clicking `+` twice would let both spawns proceed, then the second `applyAddPane` would tip past `panes.length >= capacity` only at commit time. | Closed by **Decision #12** (`pendingPaneOps` per-session serialization): the second click is rejected at the entry of `addPane` with `console.warn`. Defense-in-depth: even if a future caller bypasses the serialization gate, the reducer's `capacity` guard + `appended: false` signal trigger the wrapper to kill the orphan PTY (see `useSessionManager.test.ts` capacity-recheck-race test). Together, the two layers handle both rapid clicks and any programmatic mis-use.                                                                                                                                                                 |
| **`removePane` race with concurrent `removePane` on the same session** — User clicks two different X buttons in a 2-pane session quickly. Without serialization, both pass the pre-flight `panes.length === 1` check (still 2 at click time); both `service.kill` succeed; the first reducer commit shrinks to 1 pane; the second reducer commit no-ops via `panes.length <= 1` — but the wrapper has _already_ dropped the dead PTY's bookkeeping, so React state retains a pane whose PTY is dead in Rust.                                                                                               | Closed by **Decision #12** (`pendingPaneOps`): the second click is rejected at the entry of `removePane`. Verified by a serialization test in `useSessionManager.test.ts` (concurrent two-X-click case asserts exactly one `service.kill` fires and exactly one pane survives). The reducer's `panes.length <= 1` defensive branch remains, but the serialization gate makes it unreachable from the UI.                                                                                                                                                                                                                                           |
| **`removePane` race with concurrent `removeSession` on the same session** — User clicks tab-X concurrent with pane-X. removeSession kills every pane; removePane awakes after the kill and finds the session already gone.                                                                                                                                                                                                                                                                                                                                                                                 | `removePane`'s post-kill block re-reads `sessionsRef.current` inside `setSessions` via the reducer's `findIndex(s => s.id === sessionId)`; the no-op branch returns `prev`. The kill IPC may be a double-kill (removeSession also killed this pane's ptyId), but `service.kill` is idempotent on the Rust side (drop the cache entry; no-op if already dropped). No state corruption; one extra `console.warn` from removeSession's `kill failed for a pane` branch is the user-visible cost. `removeSession` does NOT participate in `pendingPaneOps` — the gate is per-pane mutation only, so a tab-X click during a pane-X click is concurrent. |
| **Framer Motion exit animation during `removePane` overlaps SplitView's re-render** — The closed pane's `motion.div` plays `exit={{ opacity: 0, scale: 0.96 }}` while the surviving panes re-flow to their new grid areas. If the exit's `transition` (spring 360/34) outlasts the FLIP animation, the user sees the dying pane on top of the layout reshuffle for ~200ms.                                                                                                                                                                                                                                 | Acceptable — the visual is the _intended_ multi-stage motion from the prototype. The remaining panes' `layout` animations and the closed pane's `exit` animation share the same spring config, so they finish in lockstep. Smoke-test in `npm run tauri:dev` after merge; if perceived as a regression, tighten `exit.transition.duration` to ~150ms (a fast fade-out on top of a slower layout reflow).                                                                                                                                                                                                                                           |
| **`service.setActiveSession` in `setSessionActivePane` rotates Rust's tab when called on a non-active session** — Decision #5 guards with `sessionId === activeSessionIdRef.current`. Without the guard, a programmatic call (e.g., a future bulk-state restore that pre-rotates active panes in inactive sessions) would each time call `service.setActiveSession(otherPtyId)`, rotating Rust's tab to the wrong session.                                                                                                                                                                                 | The guard is implemented in the mutation body and covered by a dedicated test (`useSessionManager.test.ts`: "setSessionActivePane on inactive session does NOT fire setActiveSession"). The guard also lives in `removePane` and `addPane` for the same reason.                                                                                                                                                                                                                                                                                                                                                                                    |
| **Auto-shrink picks `vsplit` when user was in `threeRight` and closes one pane** — The user's "main + 2 stack" intent becomes a symmetric vsplit. They lose the asymmetric ratio (1.4fr / 1fr).                                                                                                                                                                                                                                                                                                                                                                                                            | Documented in Decision #3 as accepted. The alternative (preserve `threeRight` with one empty slot) was rejected because empty slots immediately after a close are confusing. If telemetry shows this is a common irritant, a future iteration can introduce a "last-multi-layout memory" or sticky-shrink behavior (5c-2 non-goal #8). 5c-2 ships the simpler rule.                                                                                                                                                                                                                                                                                |
| **Empty-slot `+` click bubbles to SplitView slot click** — Without `stopPropagation` in `EmptySlot.handleClick`, the slot's `onClick` (which calls `onSetActivePane(session.id, pane.id)`) would fire — but the empty slot has no pane.id. Coverage: SplitView's slot onClick is only wired for _real_ panes (the empty-slot `motion.div` doesn't carry onClick). So even without `stopPropagation`, the bubble would hit the grid container's outer `motion.div` which has no onClick handler.                                                                                                            | Defense-in-depth — `stopPropagation` is added anyway in `EmptySlot.handleClick`. Cheap. Removes the "what if someone adds onClick to the empty-slot wrapper later" worry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Spawn failure in `addPane` leaves `EmptySlot` visible** — User clicks `+`, spawn rejects, no new pane is appended. The empty slot is still there (because `panes.length < layout.capacity` is unchanged).                                                                                                                                                                                                                                                                                                                                                                                                | Intended: the user can click `+` again to retry. `console.warn('addPane: spawn failed')` surfaces the failure to dev consoles. A future iteration could surface a toast; out of scope for 5c-2 (matches `createSession`'s warn-only pattern).                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Cycling layouts via ⌘\\ (5c-1) hides panes when capacity drops** — 5c-1 documented this: cycling from `quad` (4 panes) to `single` (capacity 1) hides 3 panes visually; PTYs stay alive. 5c-2 makes those hidden panes more impactful because users can now actually _have_ 4 panes (vs 5c-1's 1-pane reality).                                                                                                                                                                                                                                                                                          | Out of 5c-2 scope. Documented carry-over from 5c-1 risk #2. A follow-up may filter `LAYOUT_CYCLE` to `(layoutId) => LAYOUTS[layoutId].capacity ≥ activeSession.panes.length`. If telemetry shows users frequently hit this case, prioritize the filter; otherwise the existing "cycle is benign because clamp keeps PTYs alive" behaviour is acceptable.                                                                                                                                                                                                                                                                                           |
| **Pane id collision after a series of add/remove cycles** — User adds p0 + p1 + p2; closes p1; adds → `nextFreePaneId` returns `p1` (the hole). Stable for a single session, but the killed `p1`'s ptyId-based bookkeeping (terminal cache, restoreData) was dropped on remove, so the new `p1` is a fresh pane in every respect.                                                                                                                                                                                                                                                                          | Intended. Pane ids are session-scoped slot names, not durable handles. The `pane.ptyId` namespace is the Rust handle and is rotated by spawn. Test coverage: `nextFreePaneId(['p0', 'p2']) === 'p1'` exercises the hole-fill behaviour.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **TerminalPane.onClose signature widening breaks an unknown caller** — One in-tree consumer (`SplitView`), zero out-of-tree consumers (not a library). Risk is bounded to the test suite.                                                                                                                                                                                                                                                                                                                                                                                                                  | `npm run type-check` catches every miswired caller at compile time. The widening is additive at the _call site_ (callers that pass the old `(sessionId) => void` lambda will fail type-check), so there is no silent runtime mismatch.                                                                                                                                                                                                                                                                                                                                                                                                             |

### Risk-free trade-offs (not in the table)

- **EmptySlot visual styling** — `border-dashed` is a placeholder; if the visual review prefers a subtler treatment (e.g., a `ring-1 ring-on-surface/8` outline), swap during PR. Pure CSS.
- **Spring config for empty-slot exit animation** — Reuses 5c-1's `{ stiffness: 360, damping: 34 }`. If the empty slot's enter/exit feels too bouncy compared to real-pane add/remove, tune separately (a `motion.div` prop, not a shared constant).

## §5 References

- `docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md` — master UI migration spec; step 5 originally bundled SplitView + LayoutSwitcher + shortcuts + spawn/close. 5a/5b/5c-1/5c-2/5d slice the work.
- `docs/superpowers/specs/2026-05-10-step-5a-pane-model-refactor-design.md` — 5a's pane data model. 5c-2 maintains the invariants 5a defined (`panes.length ≥ 1`, exactly-one-active, materialized `workingDirectory`/`agentType`).
- `docs/superpowers/specs/2026-05-11-step-5b-splitview-render-design.md` — 5b's SplitView render. 5c-2 extends with `EmptySlot` and X-close prop wiring.
- `docs/superpowers/specs/2026-05-12-step-5c-1-layout-picker-design.md` — 5c-1's layout picker + focus controls + motion + first new manager mutations (`setSessionLayout`, `setSessionActivePane`). 5c-2 builds on the same mutation-callback pattern and closes 5c-1 Decision #10's Rust active-pane sync deferral.
- `docs/design/handoff/prototype/src/splitview.jsx:686-754` — handoff prototype's `SplitView` with `onClosePane` pass-through gated by `visiblePanes.length > 1` (5c-2 Decision #4).
- `docs/design/handoff/prototype/src/app.jsx:184-206` — prototype's `closePane` with the auto-shrink rule (5c-2 Decision #3).
- `src/features/sessions/utils/activeSessionPane.ts` — `applyActivePane` precedent for pure-reducer style (5c-2 Decision #1).
- `rules/common/pr-scope.md` — PR-scope discipline justifying the 5c-2 single-PR approach (Decision #11).
- `rules/typescript/coding-style/CLAUDE.md` + `rules/typescript/testing/CLAUDE.md` — code style + test conventions.

## §6 Next step after approval

Invoke `superpowers:writing-plans` to produce the implementation plan for 5c-2. Plan covers the sub-tasks in dependency order:

1. `paneLifecycle.ts` reducers + helpers + tests (pure, no React)
2. `useSessionManager.ts` — `addPane`, `removePane`, `setSessionActivePane` Rust sync + tests
3. `TerminalPane/index.tsx` — widened `onClose` signature + tests
4. `EmptySlot.tsx` + tests
5. `SplitView.tsx` — `onAddPane` / `onClosePane` props + EmptySlot mounting + onClose pass-through + tests
6. `TerminalZone.tsx` — prop threading + tests
7. `WorkspaceView.tsx` — manager wiring + tests
8. `docs/roadmap/progress.yaml` — flip `ui-s5c-2` `in_progress` → `done` on merge

TDD per task: red test → green implementation → refactor.

<!-- codex-reviewed: 2026-05-13T03:26:12Z -->
