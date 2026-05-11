---
title: Step 5b — SplitView render (per-session canvas)
date: 2026-05-11
status: draft
issue: TBD (sibling of #164; 5a was completed in #198)
owners: [winoooops]
related:
  - docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md
  - docs/superpowers/specs/2026-05-10-step-5a-pane-model-refactor-design.md
  - docs/design/handoff/prototype/src/splitview.jsx
  - docs/design/handoff/README.md
  - docs/roadmap/progress.yaml
---

# Step 5b — SplitView render (per-session canvas)

## Context

Step 5 of the UI Handoff Migration ([#164](https://github.com/winoooops/vimeflow/issues/164))
originally bundled four concerns: SplitView grid, LayoutSwitcher, ⌘1-4 /
⌘\ shortcuts, and pane spawn/close auto-shrink. During 5a brainstorming
([spec](2026-05-10-step-5a-pane-model-refactor-design.md), shipped in
[#198](https://github.com/winoooops/vimeflow/pull/198)), the work split:
5a built the pane data model — `Session.layout` + `Session.panes[]`,
per-pane PTY ownership, exactly-one-`active` invariant — but
intentionally left the rendering on a single-pane code path.

Today, `TerminalZone` iterates `sessions[]` for outer hide/show and
renders `<TerminalPane pane={findActivePane(session)} ... />` per
session — only the active pane mounts. Even if a session held multiple
panes, the others would not render. Step 5b changes that: TerminalZone
delegates per-session grid rendering to a new `SplitView` component
that maps every `pane ∈ session.panes` to a CSS Grid slot, following
the prototype at `docs/design/handoff/prototype/src/splitview.jsx`.

To keep this PR small enough to review (5a's PR was felt as too large),
step 5 is sliced into three sub-steps:

- **5b (this spec)** — pure render. New `SplitView` component renders
  `session.panes` 1..N via the 5 canonical layouts (`single`, `vsplit`,
  `hsplit`, `threeRight`, `quad`) using CSS Grid with
  `minmax(0, 1fr)` tracks. Focus ring follows 5a's `pane.active` flag
  (no separate `focusedPaneId`). **No `LayoutSwitcher` UI, no keyboard
  shortcuts, no `addPane`/`removePane` mutations, no
  `service.spawn`/`kill` calls.** Multi-pane behaviour is exercised
  via test fixtures only. Production sessions remain `layout='single'`,
  `panes=[1]` until 5c.
- **5c (separate spec)** — `LayoutSwitcher` UI, ⌘1-4 focus / ⌘\ toggle,
  click-to-focus + `setSessionActivePane` mutation, placeholder-slot
  pane spawn, X-close, auto-shrink-on-close.
- **5d (separate spec)** — auto-grow on layout pick (one click spawns
  N PTYs in parallel for the new slots).

This spec covers 5b only.

## Goals

1. Add `SplitView` at `src/features/terminal/components/SplitView/` that
   renders all panes in `session.panes` (clamped to
   `LAYOUTS[layout].capacity`) using CSS Grid templates from a typed
   `layouts.ts` module. Empty slots (`panes.length < capacity`) render
   as no-content grid tracks — 5c adds the "+ click to add pane"
   placeholder.
2. The pane with `pane.active === true` (5a invariant) renders with
   the focus ring (`outline` + soft glow per the prototype,
   `agent.accent`-coloured via the `src/agents/registry.ts` lookup
   landed in step 1). All other panes render dimmed (`opacity: ~0.78`
   per prototype).
3. `TerminalZone` retains session-iteration + show/hide. For each
   session, it renders `<SplitView session={...} service={...} ... />`
   in place of the current single `<TerminalPane>`. Non-active
   sessions keep their `display:none` rule (5a non-goal #6
   unchanged).
4. Production behaviour is visually near-identical for single-pane
   sessions: `createSession` (5a) still produces `layout='single'`
   `panes=[1]`, and `SplitView` with that input renders the existing
   `TerminalPane` in a single grid track inside the uniform shell
   (`gap:8 / padding:10 / bg:bg-surface`). The visible delta vs today
   is a ~10px margin around the terminal — accepted as part of the
   migration's uniform-shell baseline.
5. Multi-pane rendering is verified via test fixtures, both
   full-capacity (2-pane `vsplit`, 2-pane `hsplit`, 3-pane
   `threeRight`, 4-pane `quad`) AND under-capacity (2-pane `quad`
   → 2 visible panes + 2 empty grid tracks; 1-pane `threeRight` →
   1 visible pane + 2 empty tracks). Assertions cover
   `grid-template-{areas, columns, rows}`, the focus-ring marker on
   the `active` pane, unique `data-pane-id` per rendered slot, and
   the absence of slot content in empty tracks.

## Non-goals

1. **`LayoutSwitcher` UI** — 5c. SplitView in 5b accepts
   `session.layout` passively; no UI surfaces a layout picker.
2. **⌘1-4 focus / ⌘\ toggle keyboard shortcuts** — 5c.
3. **Click-to-focus** — 5c. 5b's SplitView does not register click
   handlers that mutate `pane.active`. The focus ring is read-only,
   driven by whichever pane currently has `pane.active === true`.
4. **`addPane`/`removePane` manager mutations** — 5c.
5. **`service.spawn` fan-out on layout change (auto-grow)** — 5d.
6. **Auto-shrink on pane close** — 5c (close itself is in 5c).
7. **Placeholder-slot rendering** ("+ click to add pane") — 5c.
   In 5b, slots with no pane render as empty grid tracks.
8. **Per-pane chrome changes.** `TerminalPane` (step 4 + 5a) is
   consumed as-is. New chrome affordances (agent picker, pane-collapse
   button) are out of scope.
9. **Activity-panel binding changes.** `WorkspaceView` already calls
   `useAgentStatus(activePane?.ptyId)` keyed off the active session's
   active pane. 5b doesn't touch the binding. When 5c moves
   `pane.active` between panes via click or ⌘1-4, the same expression
   re-derives the activity feed.
10. **Per-session multi-pane creation in production.**
    `createSession` (5a) continues to spawn 1-pane sessions. Tests are
    the only consumer of multi-pane fixtures in 5b.

## Decisions (resolved during 5b brainstorming)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Three-PR slice (5b render, 5c switcher + spawn/close + shortcuts, 5d auto-grow)                                                                                                                                                                                                                                                                                                         | 5a's PR was too large for review. Minimal PRs cut reviewer load, accepting that 5b is fixture-tested only and offers no user-visible UX until 5c.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | Reuse 5a's `pane.active` for the focus ring; do NOT add `Session.focusedPaneId`                                                                                                                                                                                                                                                                                                         | One state field, one invariant (exactly-one-active per session). The prototype's `focusedPaneId` and our `pane.active` express the same idea; collapsing them avoids a second mutation surface. Future divergence is a separate refactor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3   | Pure render in 5b — no manager mutations, no PTY-lifecycle IPC (no `service.spawn`, no `service.kill`). Pre-existing service usage that is part of normal pane operation (`onData`/`onExit`/`onError` subscriptions, `resize` on fit, `write` on user input, `setActiveSession` on session focus) continues unchanged.                                                                  | Smallest possible 5b. The focus ring is read-only from `pane.active`; clicks are no-ops in 5b. Mirrors 5a's data-only PR strategy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4   | New `SplitView` component (new directory) rather than inlining into `TerminalZone`                                                                                                                                                                                                                                                                                                      | Forward-compatible: 5c's placeholder + X-close logic and 5d's auto-grow logic attach to `SplitView`. Keeps `TerminalZone` focused on session-iteration + show/hide. Avoids a future re-split refactor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5   | Uniform chrome (`gap:8 / padding:10 / bg:bg-surface`) for ALL layouts, including `layout='single'`                                                                                                                                                                                                                                                                                      | Matches the prototype. Single-pane sessions get a ~10px margin vs today's full-bleed terminal — accepted as the migration's uniform-shell visual baseline. One CSS code path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6   | `LAYOUTS` constants live in a typed `layouts.ts` next to `SplitView.tsx`; imported (not duplicated)                                                                                                                                                                                                                                                                                     | Single source for grid templates. 5c/5d will read `LAYOUTS[id].capacity` for spawn fan-out — they import from the same module.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | SplitView clamps `visiblePanes = panes.slice(0, LAYOUTS[layout].capacity)`. **Invariant: `panes.length <= LAYOUTS[layout].capacity` AND the active pane's index in `panes` is `< capacity`** (the active pane is always within the visible slice). When the invariant is violated, SplitView `throw new Error(...)` ONLY under `import.meta.env.DEV`; production builds silently clamp. | Clamping makes SplitView tolerant of 5c's transient `panes.length < capacity` states (empty grid tracks, no error). The active-within-slice invariant guarantees the focus ring always renders on a visible pane — without it, a future mutation that left `active=true` on an off-screen pane would produce a focus-less SplitView. 5a satisfies the invariant trivially (`panes.length=1`, capacity=1); 5c/5d's `addPane`/`removePane`/auto-grow are responsible for maintaining it. `throw` is ESLint-compatible (unlike `console.error`, which the repo blocks via `no-console: error`); Vitest runs in DEV mode, so the throw fires in tests and surfaces the bug deterministically. Production builds (where `import.meta.env.DEV === false`) silently clamp; a user would see one less pane than expected, never a crash. Mirrors the read-side convention in `src/features/sessions/utils/activeSessionPane.ts` (writers throw via `getActivePane`; readers like `findActivePane` return `null`).        |
| 8   | Test fixtures construct multi-pane `Session` objects directly (bypassing `useSessionManager`)                                                                                                                                                                                                                                                                                           | Manager's `createSession` (5a) always spawns 1-pane; adding a test-only multi-pane spawn helper is unnecessary because 5b adds no manager mutations. Fixtures are plain object literals with `panes: [...]` and `layout: 'vsplit'` etc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 9   | Grid templates expressed via inline `style={{gridTemplateAreas, gridTemplateColumns, gridTemplateRows}}` + Tailwind for everything else                                                                                                                                                                                                                                                 | Tailwind 3 supports arbitrary values but not runtime-computed dynamic ones. The 5 layouts use runtime-derived templates that can't be expressed as static class strings. Inline style for the dynamic bits; Tailwind for static surrounding chrome.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10  | `paneMode(pane): TerminalPaneMode` (status-first derivation) moves from `TerminalZone` into `SplitView.tsx` as a **private** helper. `TerminalZone` no longer derives mode itself — it delegates rendering (and therefore mode resolution) to SplitView.                                                                                                                                | Without an explicit `mode` prop, `TerminalPane` would default to `'spawn'`, which calls `service.spawn` and contradicts 5b's "no IPC calls" non-goal. `TerminalZone` already derives mode today (`pane.status === 'completed'\|'errored'` → `'awaiting-restart'`; `pane.restoreData` → `'attach'`; else `'spawn'`); after 5b delegates per-session rendering to SplitView, that derivation has exactly one consumer (SplitView), so it lives there as a private function. The render-time `data-mode` attribute on each pane slot makes the helper testable through SplitView.test.tsx without exporting it.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | **TerminalPane's visual focus signal is retargeted from `useFocusedPane().isFocused` to `pane.active`.** The DOM-focus side effects of `useFocusedPane` (xterm input-cursor coupling via `onTerminalFocusChange`) are retained; only the visual marker changes. SplitView adds no wrapper focus ring.                                                                                   | Today (post step 4 + 5a) the `data-focused` attribute on the pane wrapper, the `boxShadow` accent halo, and the `border` colour all derive from `useFocusedPane().isFocused`, which tracks DOM focus + click events local to the pane. The result: the visual ring fires on DOM focus, which can diverge from `pane.active` (the manager-level state). 5b drives all three visual signals from `pane.active`, so a manager-level invariant (exactly-one-active per session) cleanly maps to a single ring on screen. The container's `onClick` keeps `bodyRef.current?.focusTerminal()` (so clicking the pane still puts keyboard focus on xterm) but drops `setFocused(true)` (visual is now read-only from pane state). In single-pane production, `pane.active === true` always, so the ring renders identically to today after the user has clicked once; the only visible delta is that the ring is now ALWAYS-on for the single active pane (matches the prototype's "always-on for the focused pane" UX). |

## §1 Architecture — module decomposition + file-level scope

### Types — no new exports

5a's `Session`, `Pane`, `LayoutId` exhaust 5b's data needs. SplitView
consumes the existing model unchanged. No edits to
`src/features/sessions/types/index.ts`.

### Identification namespaces (carried over from 5a)

| Namespace    | Used for                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.id` | Outer session-panel wrapper key, `data-session-id`, `aria-labelledby` linkage to the SessionTabs strip.                                                                                                                                                                                                                                                                                                                                            |
| `pane.id`    | Session-scoped pane id (`'p0'`, `'p1'`, …). Used as React's per-pane element key inside SplitView AND as the addressing handle for future `Session.panes[].id`-keyed mutations (5c's `addPane`/`removePane`/`setSessionActivePane`). **SplitView does NOT use `pane.id` for grid-area placement** — the grid area for slot `i` is derived from the iteration index (`p${i}`), so pane.id naming can evolve independently of layout slot semantics. |
| `pane.ptyId` | Rust-IPC handle: TerminalPane's `key` (5a F16), `useTerminal(pane.ptyId)`, agent detection, `notifyPaneReady(pane.ptyId, …)`, `terminalCache.get(pane.ptyId)`. **Unchanged by 5b.**                                                                                                                                                                                                                                                                |

5b adds no new id namespaces.

### Module shape

```
src/features/terminal/components/SplitView/
├── SplitView.tsx        # grid container; maps session.panes → grid slots
├── layouts.ts           # typed LAYOUTS constants (5 entries)
├── index.ts             # barrel: SplitView, LAYOUTS, LayoutShape
├── SplitView.test.tsx   # render tests + inline multi-pane fixtures
└── layouts.test.ts      # pure-data tests over LAYOUTS shape
```

`paneMode(pane: Pane): TerminalPaneMode` (status-first derivation
landed in step-4 `TerminalZone`) moves into `SplitView.tsx` as a
private helper. Today's `TerminalZone` is the only consumer; once 5b
delegates per-session rendering to SplitView, TerminalZone no longer
derives mode. Inlining keeps the helper near its only call site and
covered by SplitView.test.tsx via the rendered `data-mode` attribute.

### New files

| File                 | Purpose                                                                                                                                                                                                                                                                                                                                                                        | LOC  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `SplitView.tsx`      | Layout grid container. Props: `session`, `service`, `onSessionCwdChange?`, `onPaneReady?`, `onSessionRestart?`, `deferTerminalFit?`, `isActive`. Clamps `panes.slice(0, LAYOUTS[layout].capacity)`; renders `<TerminalPane>` per slot with derived `mode`. Single inner `<div>` carries the grid styles.                                                                       | ~140 |
| `layouts.ts`         | Typed `LAYOUTS: Record<LayoutId, LayoutShape>`. `LayoutShape = {id, name, capacity, cols, rows, areas}`. Frozen via `as const`. Re-exports `LayoutId` from `../../../sessions/types`.                                                                                                                                                                                          | ~70  |
| `index.ts`           | Barrel re-export of `SplitView`, `LAYOUTS`, `LayoutShape`. Callers outside the directory import from here.                                                                                                                                                                                                                                                                     | ~5   |
| `SplitView.test.tsx` | Render tests. Inline fixture helpers (`makeSession(layout, paneCount, activeIndex)`) seed plain `Session` objects bypassing the manager. Full-capacity (`vsplit`, `hsplit`, `threeRight`, `quad`) + under-capacity (`quad`-with-2, `threeRight`-with-1) + `single`. Assertions: grid style values, `data-pane-id`, focus-ring marker on the `active` pane, empty-slot absence. | ~220 |
| `layouts.test.ts`    | Data-shape tests. For each layout: `capacity` matches unique cells in `areas`; `cols`/`rows` track-counts match `areas` dimensions; grid-area names follow `p${index}` (0..capacity-1) with no gaps.                                                                                                                                                                           | ~50  |

### Modified files

| File                                                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | LOC delta             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `src/features/workspace/components/TerminalZone.tsx`           | For each session, render `<SplitView session={session} service={service} onSessionCwdChange={...} onPaneReady={...} onSessionRestart={...} deferTerminalFit={...} isActive={isActive} />` in place of the current inline single `<TerminalPane>` + `mode`-derivation + per-pane wrapper. Session-iteration + outer `display:none` wrapper preserved. Drop `findActivePane` import + the inline mode block.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | +~20, -~50 (-~30 net) |
| `src/features/workspace/components/TerminalZone.test.tsx`      | Update assertions that reached `data-pane-id`/`data-mode`/`data-pty-id` on the outer `terminal-pane` wrapper — those data attrs now hang on the SplitView slot. Add one multi-pane fixture test (vsplit) asserting both panes render `data-pane-id="p0"` and `"p1"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | +~40, -~15            |
| `src/features/terminal/components/TerminalPane/index.tsx`      | Three concrete changes per Decisions #4, #11, and Goal #2 (inactive-pane dim): (1) narrow the `useFocusedPane` destructure to `const { onTerminalFocusChange } = useFocusedPane({ containerRef })` — KEEP the hook call (Body still consumes `onTerminalFocusChange` via the existing `<Body onFocusChange={...}>` prop); ADD `const isFocused = pane.active` as a separate top-level constant that drives the visual ring. Drop `setFocused(true)` from `handleContainerClick`; keep `bodyRef.current?.focusTerminal()`. (2) Replace `const agent = agentForSession(session)` with `const agent = agentForPane(pane)`. (3) Apply non-focused dimming: extend `containerStyle` (or the wrapper className) so `opacity: 0.78` when `!isFocused`, `opacity: 1` when focused — matches prototype's `opacity: 0.78` for non-focused panes. Note: `useFocusedPane`'s `isFocused` return value becomes unused; a future cleanup can slim the hook to expose only `onTerminalFocusChange`, but that refactor is out of scope for 5b. | +~10, -~7 (+~3 net)   |
| `src/features/terminal/components/TerminalPane/index.test.tsx` | The "clicking the container flips data-focused" test (line ~201) is moved to 5c (where click-to-focus actually mutates state). 5b adds a new test: render with `pane.active=true` → `data-focused="true"`; render with `pane.active=false` → no `data-focused` attribute.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | +~25, -~15            |
| `src/features/sessions/utils/agentForSession.ts`               | Add `agentForPane(pane: Pane): Agent` — analog of `agentForSession(session)` that reuses the existing `AGENT_BY_SESSION_TYPE` record to translate `pane.agentType` (`'claude-code' \| 'codex' \| 'aider' \| 'generic'`) to an `AgentId` (`'claude' \| 'codex' \| 'gemini' \| 'shell'`), then indexes `AGENTS`. (Direct indexing like `AGENTS[pane.agentType]` would fail to compile — the registry's keys do not include `'claude-code'`/`'aider'`/`'generic'`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | +~5                   |
| `src/features/sessions/utils/agentForSession.test.ts`          | Add `describe('agentForPane', ...)` covering each `Pane.agentType` value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | +~20                  |
| `docs/roadmap/progress.yaml`                                   | Under the existing `ui-handoff-migration` phase, split `ui-s5` into `ui-s5a` (done, PR 198 / commit a76d962), `ui-s5b` (this spec, pending), `ui-s5c` (pending — switcher + spawn/close + shortcuts), `ui-s5d` (pending — auto-grow). Mirrors how `ui-s4` was previously a single step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | +~25, -~5             |

### Files NOT touched

| File                                                           | Why                                                                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/sessions/types/index.ts`                         | No new types; 5a's `Pane` + `LayoutId` + `Session` are sufficient.                                                                |
| `src/features/sessions/hooks/useSessionManager.ts` + sub-hooks | 5b adds no mutations. Manager's public API stays at its current shape (15 fields post-5a).                                        |
| `src/bindings/*`                                               | No IPC change.                                                                                                                    |
| `src-tauri/src/**`                                             | No backend change.                                                                                                                |
| `tailwind.config.js`                                           | No new tokens. SplitView uses existing `bg-surface`, `gap`, `p`, etc.                                                             |
| `src/agents/registry.ts`                                       | Consumed read-only for accent colours via the new `agentForPane()` resolver (added to `agentForSession.ts` — see modified files). |

### `LAYOUTS` data shape (`layouts.ts`)

```ts
// src/features/terminal/components/SplitView/layouts.ts
import type { LayoutId } from '../../../sessions/types'

export interface LayoutShape {
  readonly id: LayoutId
  readonly name: string
  /** Maximum pane count for this layout. SplitView clamps `panes.slice(0, capacity)`. */
  readonly capacity: 1 | 2 | 3 | 4
  /** CSS `grid-template-columns` value (uses `minmax(0, 1fr)` for shrinkable tracks). */
  readonly cols: string
  /** CSS `grid-template-rows` value. */
  readonly rows: string
  /** 2D layout of pane-id slot names (`'p0'`, `'p1'`, …) used to build `grid-template-areas`. */
  readonly areas: readonly (readonly string[])[]
}

export const LAYOUTS: Record<LayoutId, LayoutShape> = {
  single: {
    id: 'single',
    name: 'Single',
    capacity: 1,
    cols: 'minmax(0,1fr)',
    rows: 'minmax(0,1fr)',
    areas: [['p0']],
  },
  vsplit: {
    id: 'vsplit',
    name: 'Vertical split',
    capacity: 2,
    cols: 'minmax(0,1fr) minmax(0,1fr)',
    rows: 'minmax(0,1fr)',
    areas: [['p0', 'p1']],
  },
  hsplit: {
    id: 'hsplit',
    name: 'Horizontal split',
    capacity: 2,
    cols: 'minmax(0,1fr)',
    rows: 'minmax(0,1fr) minmax(0,1fr)',
    areas: [['p0'], ['p1']],
  },
  threeRight: {
    id: 'threeRight',
    name: 'Main + 2 stack',
    capacity: 3,
    cols: 'minmax(0,1.4fr) minmax(0,1fr)',
    rows: 'minmax(0,1fr) minmax(0,1fr)',
    areas: [
      ['p0', 'p1'],
      ['p0', 'p2'],
    ],
  },
  quad: {
    id: 'quad',
    name: 'Quad',
    capacity: 4,
    cols: 'minmax(0,1fr) minmax(0,1fr)',
    rows: 'minmax(0,1fr) minmax(0,1fr)',
    areas: [
      ['p0', 'p1'],
      ['p2', 'p3'],
    ],
  },
} as const
```

The prototype's `icon` field is intentionally omitted — icon glyphs
ship with the LayoutSwitcher UI in 5c, not the data layer.

### Net file count + LOC

- **New:** 5 files, ~485 LOC (heavy share in tests).
- **Modified:** 7 files (TerminalZone + tests, TerminalPane index + tests, agentForSession + tests, progress.yaml), ~+140 / -~92 LOC, net ~+48 LOC.
- **Total:** ~+625 / -~92, ~535 LOC across 12 files.

Just over half of 5a's footprint. Distinct enough from 5a to feel its
own PR; small enough that reviewer load stays under 30 minutes.

## §2 Component APIs

### `SplitView` props

```ts
import type { Session } from '../../../sessions/types'
import type { ITerminalService } from '../../services/terminalService'
import type {
  PaneEventHandler,
  NotifyPaneReadyResult,
} from '../../../sessions/hooks/useSessionManager'

export interface SplitViewProps {
  /** Session whose panes to render. SplitView reads `session.layout`
   *  + `session.panes`, derives the grid from `LAYOUTS[session.layout]`,
   *  and clamps `panes.slice(0, capacity)`. */
  session: Session

  /** Forwarded to every TerminalPane. MUST be the same instance the
   *  workspace passes to `useSessionManager` (5a Round 4 F1). */
  service: ITerminalService

  /** True iff this session is the active session in the workspace.
   *  Forwarded to each `<TerminalPane isActive={isActive} />` — drives
   *  `useGitBranch`/`useGitStatus` enablement and xterm fitting. */
  isActive: boolean

  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  onPaneReady?: (
    ptyId: string,
    handler: PaneEventHandler
  ) => NotifyPaneReadyResult
  onSessionRestart?: (sessionId: string) => void
  deferTerminalFit?: boolean
}
```

### SplitView render shape (sketch)

```tsx
const layout = LAYOUTS[session.layout]
if (import.meta.env.DEV && session.panes.length > layout.capacity) {
  // Single invariant check. The original spec also tried to assert
  // `activeIdx < capacity` as a distinct branch, but with panes.length
  // bounded by capacity (this check passes) and array indices in
  // [0, length), an active index >= capacity is impossible. The
  // exactly-one-active half of 5a's invariant is enforced upstream by
  // `getActivePane`/`findActivePane` — SplitView does not re-check.
  throw new Error(
    `SplitView invariant violation: session ${session.id} has ` +
      `${session.panes.length} panes but layout '${session.layout}' ` +
      `has capacity ${layout.capacity}`
  )
}
const visiblePanes = session.panes.slice(0, layout.capacity)
const areasStr = layout.areas.map((row) => `"${row.join(' ')}"`).join(' ')

return (
  <div
    data-testid="split-view"
    data-session-id={session.id}
    data-layout={session.layout}
    className="grid h-full w-full gap-2 bg-surface p-2.5"
    style={{
      gridTemplateColumns: layout.cols,
      gridTemplateRows: layout.rows,
      gridTemplateAreas: areasStr,
    }}
  >
    {visiblePanes.map((pane, i) => {
      const mode = paneMode(pane) // private helper in this file
      return (
        <div
          key={pane.id}
          data-testid="split-view-slot"
          data-pane-id={pane.id}
          data-pty-id={pane.ptyId}
          data-mode={mode}
          data-cwd={pane.cwd}
          className="relative min-h-0 min-w-0"
          // grid-area derived from iteration index, NOT pane.id — matches
          // the prototype convention and keeps pane.id semantics scoped to
          // React keying / addressing within session.panes.
          style={{ gridArea: `p${i}` }}
        >
          <TerminalPane
            key={pane.ptyId}
            session={session}
            pane={pane}
            service={service}
            mode={mode}
            onCwdChange={(cwd) =>
              onSessionCwdChange?.(session.id, pane.id, cwd)
            }
            onPaneReady={onPaneReady}
            onRestart={onSessionRestart}
            isActive={isActive}
            deferFit={deferTerminalFit}
          />
        </div>
      )
    })}
  </div>
)
```

Notes:

- `<TerminalPane key={pane.ptyId}>` mirrors 5a's F16 keying so a
  `restartSession` (same `pane.id`, new `pane.ptyId`) cleanly remounts
  the inner subtree.
- Per-slot wrapper `<div>` carries the `data-pane-id`, `data-pty-id`,
  `data-mode`, `data-cwd` attrs. Tests address slots by stable
  selectors without reaching into TerminalPane internals.
- `gridArea` derives from the iteration index (`p${i}`), matching the
  `LAYOUTS[layout].areas` cell names. `pane.id` is intentionally NOT
  used for grid placement — it stays a stable React key for the slot
  wrapper. This mirrors the handoff prototype's convention and lets
  pane.id evolve independently of layout slot semantics.
- Outer wrapper uses Tailwind for static styles (`gap-2`, `p-2.5`,
  `bg-surface`, `h-full`, `w-full`); inline `style` for the three
  dynamic grid templates.

### `paneMode` (private helper inside `SplitView.tsx`)

```ts
const paneMode = (pane: Pane): TerminalPaneMode => {
  if (pane.status === 'completed' || pane.status === 'errored') {
    return 'awaiting-restart'
  }
  if (pane.restoreData) return 'attach'
  return 'spawn'
}
```

Same status-first precedence as today's `TerminalZone` (5a round-3 F3 /
codex P2). Lifted verbatim. Tested through SplitView's rendered
`data-mode` attribute — no separate export.

### `TerminalZone` delegation

The session-iteration body shrinks. Before (5a, simplified):

```tsx
sessions.map((session) => {
  const activePane = findActivePane(session)
  if (!activePane) return null
  let mode: TerminalPaneMode = 'spawn'
  if (activePane.status === 'completed' || activePane.status === 'errored') {
    mode = 'awaiting-restart'
  } else if (activePane.restoreData) {
    mode = 'attach'
  }
  return (
    <div
      key={session.id}
      ...
      data-pane-id={activePane.id}
      data-pty-id={activePane.ptyId}
      data-mode={mode}
      data-cwd={activePane.cwd}
    >
      <TerminalPane key={activePane.ptyId} session={session} pane={activePane} mode={mode} ... />
    </div>
  )
})
```

After (5b):

```tsx
sessions.map((session) => {
  const isActive = session.id === activeSessionId
  const hasVisibleTab = isActive || isOpenSessionStatus(session.status)
  return (
    <div
      key={session.id}
      id={`session-panel-${session.id}`}
      role="tabpanel"
      aria-labelledby={hasVisibleTab ? `session-tab-${session.id}` : undefined}
      data-testid="terminal-pane"
      data-session-id={session.id}
      className={`absolute inset-0 ${isActive ? '' : 'hidden'}`}
    >
      <SplitView
        session={session}
        service={service}
        isActive={isActive}
        onSessionCwdChange={onSessionCwdChange}
        onPaneReady={onPaneReady}
        onSessionRestart={onSessionRestart}
        deferTerminalFit={deferTerminalFit}
      />
    </div>
  )
})
```

The outer per-session wrapper retains everything tab-related
(`data-session-id`, `aria-labelledby`, `role="tabpanel"`,
`display:none` hide). Pane-specific data-attrs migrate INTO
SplitView's per-slot wrapper, where they multiply across panes
correctly.

### TerminalPane signature deltas

| Hook / call site            | Before                                                                                      | After                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Focus marker source         | `const { isFocused, setFocused, onTerminalFocusChange } = useFocusedPane({ containerRef })` | `const { onTerminalFocusChange } = useFocusedPane({ containerRef })` <br> `const isFocused = pane.active` |
| Click handler body          | `setFocused(true)` + `bodyRef.current?.focusTerminal()`                                     | `bodyRef.current?.focusTerminal()` only                                                                   |
| Agent resolver              | `const agent = agentForSession(session)`                                                    | `const agent = agentForPane(pane)`                                                                        |
| Inactive-pane dim (Goal #2) | Not applied today (single-pane render is always full opacity)                               | Wrapper style: `opacity: isFocused ? 1 : 0.78` — matches prototype's non-focused pane treatment.          |

Header.tsx, Footer.tsx, HeaderActions.tsx, HeaderMetadata.tsx,
RestartAffordance.tsx, Body.tsx continue to consume `agent` (the
resolved `Agent` object) and `isFocused` (the boolean) as props or
context — no signature changes downstream. The `useFocusedPane`
hook's now-unused `isFocused`/`setFocused` returns are tolerated for
5b's minimal cut; a slim-the-hook refactor is left to a follow-up.

### Test fixture pattern (inline in `SplitView.test.tsx`)

```ts
const makeSession = (
  layout: LayoutId,
  paneCount: number,
  activeIndex = 0
): Session => ({
  id: 'sess-fix',
  projectId: 'proj-fix',
  name: 'fixture session',
  workingDirectory: '/tmp/fixture',
  agentType: 'generic',
  status: 'running',
  layout,
  panes: Array.from({ length: paneCount }, (_, i) => ({
    id: `p${i}`,
    ptyId: `pty-${i}`,
    cwd: '/tmp/fixture',
    agentType: 'generic',
    status: 'running',
    active: i === activeIndex,
    pid: 1000 + i,
    // restoreData seeded so `paneMode(pane)` returns 'attach' (not 'spawn');
    // tests must NOT trigger `service.spawn` — the 5b "no IPC calls" contract
    // hinges on every fixture pane being in attach mode.
    restoreData: {
      sessionId: `pty-${i}`,
      cwd: '/tmp/fixture',
      pid: 1000 + i,
      replayData: '',
      replayEndOffset: 0,
      bufferedEvents: [],
    },
  })),
  createdAt: '2026-05-11T00:00:00Z',
  lastActivityAt: '2026-05-11T00:00:00Z',
  activity: { ...emptyActivity }, // emptyActivity is a constant — spread to avoid mutation
})
```

Co-located inside `SplitView.test.tsx`. No `src/test/fixtures/`
directory created — only one consumer in 5b (YAGNI). When 5c/5d
extend the fixture API (e.g., per-pane different `agentType`), the
helper graduates to its own file.

## §3 Testing approach

### Coverage targets

| File                          | What it tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Approach                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `layouts.test.ts`             | Pure data invariants. For each `LayoutId`: `capacity` equals the count of distinct cell names in `areas`; cell names are `p0..p(capacity-1)` with no gaps; `cols` track-count equals `areas[0].length`; `rows` track-count equals `areas.length`. One test asserts the LAYOUTS object contains all 5 keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Plain `expect(...)` against the constant.                                       |
| `SplitView.test.tsx`          | Render behaviour. Per layout (5): outer grid style values (`gridTemplateAreas/Columns/Rows`) match `LAYOUTS[layout]`; each slot's `data-pane-id` matches `pane.id`; `data-mode` matches `paneMode(pane)`; `data-cwd` matches `pane.cwd`; **the inner TerminalPane wrapper (`data-testid="terminal-pane-wrapper"`) inside the active pane's slot carries `data-focused="true"`** while non-active wrappers carry no `data-focused` AND have `opacity: 0.78` on their inline style. Under-capacity tests (`quad`-with-2, `threeRight`-with-1) assert `panes.length` slots render. **One over-capacity invariant test** wraps the render in `expect(...).toThrow(/SplitView invariant/)` with `panes.length > capacity` (the active-pane-offscreen branch is logically unreachable as a distinct fixture since array indices are bounded by length). Plus an explicit assertion that `mockService.spawn` and `mockService.kill` were never called. | RTL `render` with the inline `makeSession` fixture + a mock `ITerminalService`. |
| `TerminalZone.test.tsx`       | Delegation behaviour. Existing assertions that reached `data-pane-id`/`data-mode`/`data-pty-id`/`data-cwd` on the outer `terminal-pane` wrapper now reach into the SplitView slot. New test: single-session render shows `<SplitView>` with one slot; multi-session render shows N `<SplitView>`s with the non-active session's wrapper carrying `hidden`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | RTL `render` with a mock `useSessionManager` output.                            |
| `agentForSession.test.ts`     | New `describe('agentForPane', ...)` block covering each `Pane.agentType` value (`'claude-code' → claude`, `'codex' → codex`, `'aider' → shell`, `'generic' → shell`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Plain unit tests, mirror existing `agentForSession` test shape.                 |
| `TerminalPane/index.test.tsx` | The "clicking the container flips data-focused" test (~line 201) moves to 5c (where click-to-focus mutates `pane.active` for real). 5b adds the paired test: render with `pane.active=true` → `data-focused="true"`; render with `pane.active=false` → no `data-focused` attribute AND `opacity: 0.78` on wrapper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | RTL `render` per existing test pattern.                                         |

### Mock service for SplitView.test.tsx

Tests construct a minimal `ITerminalService` stub:

```ts
// Matches `src/features/terminal/services/terminalService.ts` exactly.
const mockService: ITerminalService = {
  spawn: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  onData: vi.fn(async () => () => {}), // async — ITerminalService.onData returns Promise<() => void>

  onExit: vi.fn(() => () => {}),
  onError: vi.fn(() => () => {}),
  listSessions: vi.fn(async () => ({ sessions: [], activeSessionId: null })),
  setActiveSession: vi.fn(async () => {}),
  reorderSessions: vi.fn(async () => {}),
  updateSessionCwd: vi.fn(async () => {}),
}
```

The 'attach' mode of `paneMode(pane)` does NOT call `service.attach`
(no such method exists). It signals TerminalPane's `Body` to consume
`pane.restoreData` for replay-then-stream instead of calling
`service.spawn` for a fresh PTY. The mock methods above cover every
ITerminalService call TerminalPane's attach path can make
(`onData`/`onExit`/`onError` subscriptions; `resize` after fit;
`write` on user input — none of which fire in non-interacting render
tests). Pairs with `restoreData`-seeded fixtures so each pane's mode
is `'attach'`. Combined, this guarantees `service.spawn` is never
invoked in tests — asserted explicitly via
`expect(mockService.spawn).not.toHaveBeenCalled()` in one of the
render tests, locking in Decision #3 mechanically.

### Pre-push gate

`vitest run` runs every PR through pre-push (Husky). The 5b PR adds
new fixture-driven tests but otherwise keeps the existing suite green.
Lint + Prettier via lint-staged on commit; ESLint's `no-console: error`
is honored (Decision #7's invariant uses `throw`, not `console.error`).

## §4 Risks & mitigations

| Risk                                                                                                                | Mitigation                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single-pane visual delta (~10px margin around terminal) surprises users on first build                              | Goal #4 accepts this as the migration's uniform-shell baseline; the handoff prototype shows the same margin. If user QA flags it on the 5b PR, the local fallback is a `layout === 'single' ? 0 : 8` conditional on gap/padding — one CSS branch, no architectural impact.                      |
| `pane.active` always-on in single-pane sessions causes a permanent focus ring even when nothing is keyboard-focused | Matches the prototype's "current pane is always focused" mental model in single-pane mode and aligns with user intuition (this is the one pane I can type into). If problematic, 5c's click-to-focus introduces the click-outside-blurs path; out of scope here.                                |
| `TerminalPane`'s `useFocusedPane` returns become unused dead state                                                  | Accepted for 5b minimality (Decision #11 explicitly notes this). A follow-up cleanup PR can slim the hook to expose only `onTerminalFocusChange`, or remove it entirely if Body refactors to track xterm focus internally.                                                                      |
| Existing `TerminalPane.test.tsx` "click flips focus" test fails after the focus retarget                            | Test moves to 5c (where the behaviour returns via the new `setSessionActivePane` mutation). 5b removes the test and adds a `pane.active=true → data-focused="true"` test in its place — see the modified-files table in §1.                                                                     |
| Vitest's mock for `ITerminalService` drifts from the real interface                                                 | The interface lives at `src/features/terminal/services/terminalService.ts` (importable). The mock declares the type explicitly (`const mockService: ITerminalService = ...`) so TypeScript catches signature drift at test-compile time. Pre-push `vitest run` fails fast on a real divergence. |
| Production single-pane sessions silently start rendering inside a CSS Grid container — micro-performance regression | Negligible: a 1×1 CSS Grid with `minmax(0, 1fr)` tracks is effectively a flexbox parent for one child. xterm's WebGL renderer is unaffected by the wrapper. Manual smoke-test in `npm run tauri:dev` before merge.                                                                              |
| `progress.yaml` split of `ui-s5` into `ui-s5a/5b/5c/5d` confuses readers expecting the previous flat shape          | Same restructuring pattern was used when step-4 split off from the original `tauri-migration-roadmap`. CHANGELOG.md entry for the 5b PR calls out the split explicitly.                                                                                                                         |
| Auto-grow / spawn-fanout dependency landing in 5d feels "stuck" until 5c lands                                      | The chain is short: 5b ships render → 5c ships LayoutSwitcher + manual spawn-per-slot + close + ⌘shortcuts → 5d ships auto-grow. Each PR is independently mergeable. If 5d slips, users get manual control as the worst case (still strictly better than today's hard single-pane limit).       |

## References

- `docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md` —
  master UI migration spec; §9 step 5 originally bundled SplitView +
  Switcher + shortcuts + spawn/close. 5a/5b/5c/5d slice the work.
- `docs/superpowers/specs/2026-05-10-step-5a-pane-model-refactor-design.md` —
  5a's data model. 5b consumes `Session.layout`, `Session.panes[]`,
  and the exactly-one-`active` invariant directly.
- `docs/design/handoff/prototype/src/splitview.jsx` — handoff
  prototype's `SplitView`, `LayoutSwitcher`, `TerminalPane`, and
  `VIMEFLOW_LAYOUTS` constants. 5b ports the LAYOUTS shape + grid
  rendering; LayoutSwitcher / AgentPicker / DockSwitcher ship in
  5c/5d.
- `docs/design/handoff/README.md` — handoff package primary spec.
- `docs/design/UNIFIED.md` — older 5-zone layout spec, partially
  superseded by the handoff bundle.
- `src/agents/registry.ts` — `AGENTS` registry + `AgentId` type
  (step 1).
- `src/features/sessions/utils/agentForSession.ts` —
  `AGENT_BY_SESSION_TYPE` translation map + sister of `agentForPane`
  added in this spec.
- `rules/common/pr-scope.md` — PR-scope discipline justifies the
  three-way 5b/5c/5d slice.
- `rules/typescript/coding-style/CLAUDE.md` +
  `rules/typescript/testing/CLAUDE.md` — code style + test conventions.

## Next step after approval

Invoke `superpowers:writing-plans` to produce the implementation plan
for 5b. The plan lists the sub-tasks in dependency order (layouts.ts
→ SplitView.tsx → agentForPane → TerminalPane retarget → TerminalZone
delegation → tests → progress.yaml) and the TDD sequence (red → green
→ refactor) per file.

<!-- codex-reviewed: 2026-05-11T15:02:08Z -->
