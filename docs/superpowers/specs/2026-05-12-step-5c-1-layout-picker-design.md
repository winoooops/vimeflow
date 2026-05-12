---
title: Step 5c-1 — Layout picker + focus controls (passive, animated)
date: 2026-05-12
status: draft
issue: TBD (sibling of #164; 5b shipped in #199)
owners: [winoooops]
related:
  - docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md
  - docs/superpowers/specs/2026-05-10-step-5a-pane-model-refactor-design.md
  - docs/superpowers/specs/2026-05-11-step-5b-splitview-render-design.md
  - docs/design/handoff/prototype/src/splitview.jsx
  - docs/design/handoff/prototype/src/app.jsx
  - ~/projects/shared-layout-animations/my-app/src/app/page.tsx
  - docs/roadmap/progress.yaml
---

# Step 5c-1 — Layout picker + focus controls (passive, animated)

## Context

Step 5 of the UI Handoff Migration ([#164](https://github.com/winoooops/vimeflow/issues/164))
was originally scoped as "SplitView + LayoutSwitcher + ⌘1-4 / ⌘\ +
spawn/close auto-shrink". 5a
([#198](https://github.com/winoooops/vimeflow/pull/198)) refactored the
data model — `Session.layout` + `Session.panes[]`, per-pane PTY ownership,
exactly-one-active invariant. 5b
([#199](https://github.com/winoooops/vimeflow/pull/199)) added the CSS Grid
`SplitView` that maps `session.panes` to layout slots. Production sessions
still ship at `layout='single'`, `panes.length=1`; the user has no way to
pick a different layout, focus a non-active pane, or grow/shrink the pane
count.

This spec covers **5c-1 — the passive layout picker + focus controls**.
The implementation PR introduces the slicing into `progress.yaml` —
splitting the current single `ui-s5c` entry into `ui-s5c-1` (this PR),
`ui-s5c-2` (separate spec), and keeping `ui-s5d` unchanged:

- **5c-1 (this spec)** — passive `LayoutSwitcher` UI (picks
  `session.layout`; does NOT spawn or kill panes), click-to-focus + ⌘1-4
  (mutates `pane.active` via a new `setSessionActivePane` manager
  mutation), and ⌘\ (cycles through all 5 layouts). The pane count per
  session stays hardcoded at 1 — picking `vsplit` from a single-pane
  session sets `session.layout='vsplit'` and SplitView renders 1 real
  pane + 1 empty grid track (5b's existing behaviour). No placeholder UI
  in empty slots. Framer Motion drives the per-pane resize animation
  when the layout changes (full shared-layout pattern, forward-compat
  for 5c-2's add/remove).
- **5c-2 (separate spec)** — `addPane`/`removePane` manager mutations,
  "+ click to add pane" placeholder in empty slots, X-close button on
  per-pane chrome, auto-shrink layout on close.
- **5d (later)** — auto-grow on layout pick (one click spawns N PTYs in
  parallel for the new slots).

### Why slice 5c

The original 5c bundle (~650 LOC + ~400 LOC tests across ~15 files)
approaches the LOC count of 5a, which reviewers felt was too large.
Splitting at the "UI surfaces only" vs "manager mutations" seam keeps
each PR under ~30 min reviewer load and produces independently
bisectable commits.

Trade-off: 5c-1 on its own gives the user a working layout picker
(clicking `vsplit` works, the visible focus ring follows `pane.active`)
but no way to fill the empty grid tracks with PTYs. 5c-2 follows
immediately; the picker is functional UI, not vapor-ware.

## Goals

1. **LayoutSwitcher** — new component at
   `src/features/terminal/components/LayoutSwitcher/`. 5 buttons with
   SVG glyphs matching each layout shape (ported from the handoff
   prototype `splitview.jsx:554-683`). Active button highlighted with
   the primary tonal accent. Picking a layout calls a new
   `setSessionLayout(sessionId, layoutId)` manager mutation. No
   spawn/kill side-effects.
2. **`usePaneShortcuts` hook** — new at
   `src/features/terminal/hooks/`. Capture-phase `document` keydown
   listener (mirrors `useCommandPalette` pattern). Wires:
   - **Ctrl/Cmd+1-4** → focus pane index N in the active session
     (no-op if `panes[N-1]` doesn't exist).
   - **Ctrl/Cmd+\\** → cycle the active session's layout through
     `single → vsplit → hsplit → threeRight → quad → single`.
3. **Click-to-focus** — clicking any rendered pane slot in `SplitView`
   calls a new `setSessionActivePane(sessionId, paneId)` manager
   mutation. The existing `bodyRef.current?.focusTerminal()` xterm
   DOM-focus call stays — only the active-pane state mutation is added.
4. **Manager mutations: `setSessionActivePane`, `setSessionLayout`** —
   added to `useSessionManager.ts`'s public `SessionManager` interface.
   Both maintain 5a's invariants (exactly-one-active; `panes.length
≥ 1`; materialized `Session.workingDirectory` +
   `Session.agentType` re-derived from the new active pane when the
   active flag rotates).
5. **Toolbar placement** — `TerminalZone` mounts a new toolbar between
   the existing `SessionTabs` (above, owned by `WorkspaceView`) and
   `SplitView` (below). Toolbar contents: `LayoutSwitcher` on the left
   - keyboard-hint label on the right (`⌘+1-4 focus · ⌘+\ cycle`).
     Hidden when `sessions.length === 0` (loading or empty state).
6. **Framer Motion shared-layout animations** — `<LayoutGroup id={session.id}>`
   wraps the SplitView grid (the explicit `id` namespaces `layoutId`
   matching to this one session — without it, every session reuses
   `pane.id='p0'` and hidden mounted sessions would cross-collide on
   their first render). `<motion.div layout>` on the grid container.
   `<motion.div layout layoutId={pane.id}>` on each pane slot wrapper —
   `pane.id` is stable across `restartSession` (5a F16 rotates
   `pane.ptyId`, not `pane.id`), so the focus ring + layout transition
   keep playing through a restart instead of replaying enter/exit. `<AnimatePresence initial={false}>` around the slots
   map (no-op in 5c-1's single-pane reality; forward-compat for 5c-2's
   add/remove). Spring transition `{ stiffness: 360, damping: 34 }`
   ported from the demo at
   `~/projects/shared-layout-animations/my-app/src/app/page.tsx`. When
   the user picks a different layout (LayoutSwitcher or ⌘\), the
   visible pane smoothly resizes from its old grid-area to its new one
   — e.g. picking `vsplit` from `single` morphs p0 from full-width to
   half-width over ~250ms.

## Non-goals

1. **`addPane` / `removePane` mutations** — 5c-2.
2. **"+ click to add pane" placeholder in empty grid tracks** — 5c-2.
   5c-1's empty tracks stay inert (5b's existing behaviour).
3. **X-close button on `TerminalPane` chrome** — 5c-2.
4. **Auto-shrink layout on pane close** — 5c-2.
5. **Auto-grow on layout pick** (one-shot parallel PTY fan-out) — 5d.
6. **Per-pane agent picker** (rebinding `pane.agentType` post-spawn) —
   out of migration scope.
7. **Per-session "lastMultiLayout" memory** — ⌘\ cycles linearly; no
   history.
8. **Bundling shortcuts into the command palette** — kept as a separate
   document listener, parallel to `useCommandPalette`. Migration §9
   step 8 may revisit.
9. **xterm keybinding suppression for arbitrary keys** — only Ctrl+1-4
   and Ctrl+\ are pre-empted at the document level. Other terminal
   keys flow through unchanged.
10. **Rust IPC changes** — both new mutations
    (`setSessionActivePane`, `setSessionLayout`) live entirely in React
    state. Rust still owns active-SESSION (`service.setActiveSession`),
    but not active-pane-within-session or layout. No
    `src-tauri/src/**` edits, no `src/bindings/**` regeneration.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Slice 5c into 5c-1 (UI + focus-only mutations + motion) + 5c-2 (pane lifecycle mutations: `addPane`/`removePane` + X-close + auto-shrink)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 5a's PR was felt as too large. 5c-1's mutations are limited to _focus + layout_ (no spawn/kill); 5c-2 owns the lifecycle surface. The split keeps each PR under ~30 min reviewer load. 5c-1 alone ships a working, animated layout picker; 5c-2 follows immediately.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | LayoutSwitcher is **passive** — picking a layout updates `session.layout` only; no panes spawn or close                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Auto-grow is 5d's explicit scope; auto-shrink is 5c-2's. Picking `vsplit` from a single-pane session produces 1 live pane + 1 empty grid track. SplitView (5b) already handles the empty-track case.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | ⌘\ **cycles through all 5 layouts** (single → vsplit → hsplit → threeRight → quad → single)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | User pick. Differs from the handoff prototype which toggles `single ↔ vsplit` only. Cycling is predictable from any starting layout and exposes all 5 templates without users learning multiple shortcuts. No per-session "last multi layout" state needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | Modifier key guard: `(e.metaKey \|\| e.ctrlKey) && !e.altKey && !e.shiftKey` (cross-platform, capture-phase document listener)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Matches the handoff prototype (`app.jsx:211`). Matches the existing `useCommandPalette` capture-phase pattern. The `!altKey && !shiftKey` half ensures Alt+1, Shift+\, and any Ctrl-augmented terminal shortcut (e.g., `Ctrl+Alt+T`) flow through to xterm untouched. xterm's per-pane keydown listeners are pre-empted only for the bare Ctrl/Cmd combinations — same trade-off the palette already accepts for Ctrl+:.                                                                                                                                                                                                                                                                                                                                                        |
| 5   | New `setSessionActivePane(sessionId, paneId)` mutation; click-to-focus + ⌘1-4 both call it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | One mutation site for active-pane changes simplifies invariant maintenance. The materialized `Session.workingDirectory` + `Session.agentType` are re-derived inside the mutation so existing consumers (Tab cards, Sidebar subtitles, agent-status panel) stay correct.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | New `setSessionLayout(sessionId, layoutId)` mutation; LayoutSwitcher + ⌘\ both call it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Symmetric to #5. Updates `session.layout` only — no pane mutations (per Decision #2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7   | LayoutSwitcher toolbar mounts in `TerminalZone`, between `SessionTabs` (above, in `WorkspaceView`) and `SplitView` (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Matches the handoff prototype (`app.jsx:368-406`). Closest to the affected surface (the SplitView grid). Avoids polluting `WorkspaceView` with toolbar JSX.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | `usePaneShortcuts` mounted in `WorkspaceView`, not `TerminalZone`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Per handoff §9 step 8: "key handler in WorkspaceView.tsx". Keeps `WorkspaceView` as the single coordinator for global keyboard shortcuts (matches the command palette's wiring).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | Adopt `framer-motion` v12 (already at `^12.38.0`, used in 6 places: CommandPalette, CommandResults, sessions List/Group/Card, UnsavedChangesDialog). Shared-layout pattern ported from the user's demo (`~/projects/shared-layout-animations/my-app/src/app/page.tsx`): `LayoutGroup id={session.id}` outermost (the explicit `id` scopes Motion's `layoutId` matching to one session — `pane.id` values like `'p0'` repeat across sessions, and without the namespacing, hidden mounted sessions would cross-collide on first render) + `motion.div layout` on grid container + per-pane slot wrapper with `layoutId={pane.id}` + `AnimatePresence initial={false}` around the slots map. Spring `{ stiffness: 360, damping: 34 }`. | No new dep. The shared-layout pattern is mature in v12; user has validated in the demo. Per-session LayoutGroup scoping prevents cross-session pane animations when SessionTabs switches. `pane.id` (not `pane.ptyId`) is the layoutId source because 5a's F16 keying rotates `pane.ptyId` on `restartSession` — using ptyId would replay enter/exit during a restart instead of preserving the slot. xterm-inside-motion compatibility is a real risk (captured in §7) — Framer Motion's FLIP technique transforms the wrapper during animation; the WebGL canvas inside may render at scaled-up resolution for ~200ms before FitAddon refits. Smoke-test during dev; if visible glitch is unacceptable, fall back to `layout="position"` (animates translate only, no scale). |
| 10  | **Rust active-session contract stays out of 5c-1.** `service.setActiveSession(ptyId)` continues to be called only when the active SESSION rotates (existing 5a behaviour). `setSessionActivePane` does NOT touch Rust state. In 5c-1, `panes.length === 1` per session, so Rust's cached active PTY = the only pane's PTY by construction — the contract is trivially correct.                                                                                                                                                                                                                                                                                                                                                       | Non-goal #10 (the Rust-IPC bullet) keeps 5c-1's surface narrow. Multi-pane sessions in 5c-2 will resolve the divergence — either by syncing Rust's active PTY on every `setSessionActivePane`, or by accepting Rust's per-session active PTY as "most recent intent" semantically distinct from React's per-session active pane. The decision belongs to 5c-2's scope where multi-pane is first observable. 5c-1 documents the future split rather than pre-committing.                                                                                                                                                                                                                                                                                                         |
| 11  | **xterm DOM-focus follows `pane.active`** — `TerminalPane/index.tsx` gains a small effect that calls `bodyRef.current?.focusTerminal()` whenever `pane.active` transitions from `false` to `true`. Implementation: `useEffect(() => { if (pane.active) bodyRef.current?.focusTerminal(); }, [pane.active])` with a `useRef`-guarded rising-edge check to avoid duplicate-focus on initial mount.                                                                                                                                                                                                                                                                                                                                     | Without this, clicking an inactive pane or pressing ⌘2 sets `pane.active=true` (visual ring moves) but leaves keyboard focus on the previously-active xterm — "first click moves ring, second click moves cursor." The effect couples visual + keyboard focus so a single action moves both. Lives inside `TerminalPane` (closest to the xterm + ref) rather than as a side-effect of the manager mutation — keeps the mutation pure and the focus coupling local to the component that owns the xterm instance. Promotes `TerminalPane/index.tsx` from "NOT touched" to a small modification (~10 LOC + ~30 LOC test).                                                                                                                                                         |

## §1 Architecture — module decomposition + file-level scope

### Identification namespaces (carried over from 5a/5b)

| Namespace    | Used for                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.id` | Addressing key for the new manager mutations `setSessionActivePane(sessionId, …)` and `setSessionLayout(sessionId, …)`. SplitView outer wrapper `data-session-id`.                                                                                                                                                                                                        |
| `pane.id`    | Session-scoped pane id (`'p0'`, `'p1'`, …). React key in SplitView slot wrappers (5b). 5c-1 addressing handle for `setSessionActivePane(sessionId, paneId)`. **Also drives `motion.div layoutId={pane.id}`** — stable across `restartSession` (5a F16 rotates only `pane.ptyId`), so Framer Motion preserves the slot through a restart rather than replaying enter/exit. |
| `pane.ptyId` | Rust IPC handle (5a). Used by `useTerminal`, `agent-detector`, `notifyPaneReady`. **Unchanged by 5c-1** — neither mutation touches it.                                                                                                                                                                                                                                    |

5c-1 adds no new id namespaces.

### Module shape

```
src/features/terminal/
├── components/
│   ├── LayoutSwitcher/              # new
│   │   ├── LayoutSwitcher.tsx       # 5-button picker
│   │   ├── LayoutGlyph.tsx          # SVG glyphs (1 per LayoutId)
│   │   ├── index.ts                 # barrel: LayoutSwitcher
│   │   ├── LayoutSwitcher.test.tsx
│   │   └── LayoutGlyph.test.tsx
│   ├── SplitView/                   # modified (motion wrapping + click-to-focus)
│   └── TerminalPane/                # unchanged (visual focus already on pane.active per 5b)
└── hooks/
    ├── usePaneShortcuts.ts          # new — capture-phase document keydown
    └── usePaneShortcuts.test.ts
```

### New files

| File                                                                      | Purpose                                                                                                                                                                                                                                                                                                | LOC  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.tsx`      | Props: `{ activeLayoutId: LayoutId, onPick: (next: LayoutId) => void }`. Renders 5 buttons (one per `LayoutId`) with active highlight (primary tonal accent + 1px outline). Calls `onPick(L.id)` on click. Pure render — no internal state.                                                            | ~80  |
| `src/features/terminal/components/LayoutSwitcher/LayoutGlyph.tsx`         | Component: `{ layoutId: LayoutId }`. Inline `<svg>` matching the layout shape (port of `splitview.jsx:554-683`). `stroke="currentColor"` so the button colour cascades.                                                                                                                                | ~80  |
| `src/features/terminal/components/LayoutSwitcher/index.ts`                | Barrel re-export of `LayoutSwitcher`.                                                                                                                                                                                                                                                                  | ~3   |
| `src/features/terminal/components/LayoutSwitcher/LayoutSwitcher.test.tsx` | RTL: 5 buttons render (one per LayoutId); the button matching `activeLayoutId` carries `data-active="true"`; clicking a non-active button fires `onPick(L.id)`.                                                                                                                                        | ~80  |
| `src/features/terminal/components/LayoutSwitcher/LayoutGlyph.test.tsx`    | Data-shape: each `LayoutId` renders a `<svg>` with the expected number of `<line>` separators (single:0, vsplit:1, hsplit:1, threeRight:2, quad:2).                                                                                                                                                    | ~40  |
| `src/features/terminal/hooks/usePaneShortcuts.ts`                         | Capture-phase `document` keydown listener. Reads `activeSessionId` + `sessions` via refs (closure-stale guard). Calls `setSessionActivePane` on Ctrl/Cmd+1-4; `setSessionLayout` on Ctrl/Cmd+\\ (cycle through `LAYOUT_CYCLE`).                                                                        | ~110 |
| `src/features/terminal/hooks/usePaneShortcuts.test.ts`                    | Synthetic KeyboardEvent dispatch. Cases: Cmd+1 with 1 pane → focus p0 (no-op since p0 already active); Cmd+2 with 1 pane → no-op (`panes[1]` undefined); Cmd+\\ from `single` → `vsplit`; Cmd+\\ from `quad` → `single` (wrap); modifier guards (no Alt+1, no Shift+\\); `activeSessionId=null` no-op. | ~160 |

### Modified files

| File                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | LOC delta  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------- | --------- |
| `src/features/sessions/hooks/useSessionManager.ts`              | (1) `SessionManager` interface gains `setSessionActivePane(sessionId, paneId): void` and `setSessionLayout(sessionId, layoutId): void`. (2) `setSessionActivePane` body: `setSessions` updater that flips the matching pane's `active=true` and every other pane in the same session to `active=false`; re-derives `Session.workingDirectory` + `Session.agentType` from the new active pane (mirrors `onPtyExitRef.current`'s pattern). (3) `setSessionLayout`: updates `session.layout` only — no pane mutations. (4) **No-op semantics**: both mutations short-circuit and return the same `prev` array reference when the sessionId is missing (with `console.warn`), the paneId is missing (`setSessionActivePane`, with `console.warn`), the pane is already active (`setSessionActivePane`), or the layout is unchanged (`setSessionLayout`). The mutating path uses `prev.slice(0, idx)` + new session + `prev.slice(idx+1)` (NOT `prev.map(...)`) so unaffected sessions keep their identity. | +~45       |
| `src/features/sessions/hooks/useSessionManager.test.ts`         | New tests for both mutations: exactly-one-active invariant maintained on flip; materialized `workingDirectory`/`agentType` re-derive on rotation; layout update preserves panes; missing-id warn-and-no-op.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | +~120      |
| `src/features/terminal/components/SplitView/SplitView.tsx`      | (1) Add prop `onSetActivePane?: (sessionId: string, paneId: string) => void`. (2) Wrap return in `<LayoutGroup id={session.id}>`. (3) Outer `<div>` → `<motion.div layout …>` carrying existing grid styles. (4) Slot `<div>` → `<motion.div layout layoutId={pane.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ type: 'spring', stiffness: 360, damping: 34 }} onClick={() => onSetActivePane?.(session.id, pane.id)} …>`. (5) Wrap `visiblePanes.map(...)` in `<AnimatePresence initial={false}>`.                                                                                                                                                                                                                                                                                                                                                                                                                   | +~30, -~10 |
| `src/features/terminal/components/SplitView/SplitView.test.tsx` | Mock `framer-motion` per testing-library convention (motion components render as plain DOM in jsdom; AnimatePresence/LayoutGroup are no-op wrappers). Add click-to-focus test: 2-pane fixture, active=p0; click p1 slot; assert `onSetActivePane` called with `(session.id, 'p1')`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | +~80       |
| `src/features/terminal/components/TerminalPane/index.tsx`       | Add a rising-edge effect that calls `bodyRef.current?.focusTerminal()` when `pane.active` flips `false → true` (Decision #11). Uses a `useRef` initialised to `pane.active`'s mount value + a `useEffect([pane.active])` so the rising-edge check is explicit. No prop changes. No other behaviour delta.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | +~10       |
| `src/features/terminal/components/TerminalPane/index.test.tsx`  | Test cases: `pane.active=false` initial → `bodyRef.focusTerminal` not called; rerender with `pane.active=true` → `focusTerminal` called once; rerender again with `pane.active=true` (no flip) → no additional call; `pane.active=true` initial mount → `focusTerminal` NOT called by the new effect (existing mount-focus path stays the sole driver). Uses an explicit `vi.fn()` on the mocked `Body` ref.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | +~35       |
| `src/features/workspace/WorkspaceView.tsx`                      | Destructure `setSessionActivePane`, `setSessionLayout` from `useSessionManager`. Call `usePaneShortcuts({ sessions, activeSessionId, setSessionActivePane, setSessionLayout })`. Pass both as props to `TerminalZone`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | +~10       |
| `src/features/workspace/WorkspaceView.test.tsx`                 | Mock `usePaneShortcuts`; assert it receives the expected handlers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | +~15       |
| `src/features/workspace/components/TerminalZone.tsx`            | (1) Props gain `setSessionActivePane`, `setSessionLayout`. (2) Derive `const activeSession = sessions.find(s => s.id === activeSessionId)`. (3) Mount toolbar `<div>` before `data-testid="terminal-content"`: `<LayoutSwitcher activeLayoutId={activeSession?.layout ?? 'single'} onPick={(id) => activeSession && setSessionLayout(activeSession.id, id)} />` + hint label `⌘+1-4 focus · ⌘+\ cycle`. Hidden when `loading                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |            | sessions.length === 0`. (4) Pass `onSetActivePane={setSessionActivePane}`to`SplitView`. | +~45, -~5 |
| `src/features/workspace/components/TerminalZone.test.tsx`       | Toolbar mount test (LayoutSwitcher present when `sessions.length > 0`; absent otherwise). LayoutSwitcher click → `setSessionLayout` called with active session id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | +~55       |
| `docs/roadmap/progress.yaml`                                    | **Split** the existing single `ui-s5c` entry (which still bundles "LayoutSwitcher + ⌘1-4 / ⌘\\ + click-to-focus + placeholder spawn + X-close + auto-shrink") into three new entries: `ui-s5c-1` (this PR — "Layout picker + focus controls (passive, animated)"), `ui-s5c-2` ("addPane / removePane / placeholder / X-close / auto-shrink"), and keep `ui-s5d` unchanged. Mark `ui-s5c-1` `in_progress` at PR-open, `done` on merge with the commit + PR id. Update phase `notes` to reflect the slicing decision (cross-links to this spec + 5a/5b).                                                                                                                                                                                                                                                                                                                                                                                                                                                 | +~10, -~3  |

### Files NOT touched

| File                                                                                                                                                          | Why                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/sessions/types/index.ts`                                                                                                                        | 5a's `Pane` / `LayoutId` / `Session` are sufficient.                                                                                                                                                  |
| `src/features/terminal/components/SplitView/layouts.ts`                                                                                                       | `LAYOUTS` constants unchanged. LayoutSwitcher reads them via the SplitView barrel.                                                                                                                    |
| `src/features/terminal/components/TerminalPane/Body.tsx` / `Header.tsx` / `Footer.tsx` / `HeaderActions.tsx` / `HeaderMetadata.tsx` / `RestartAffordance.tsx` | 5b already wired `data-focused` to `pane.active`. 5c-1 routes click through SplitView's slot wrapper; only `index.tsx` grows the focus-coupling effect (Decision #11). Sub-components stay unchanged. |
| `src/features/sessions/utils/activeSessionPane.ts`                                                                                                            | 5a's `findActivePane` / `getActivePane` are read-only helpers. Writes live in the new mutations.                                                                                                      |
| `src/bindings/**` / `src-tauri/src/**`                                                                                                                        | No IPC change. Active-pane-within-session + layout are React-only.                                                                                                                                    |
| `tailwind.config.js`                                                                                                                                          | LayoutSwitcher uses existing `primary`, `on-surface-muted`, `surface-container`.                                                                                                                      |
| `src/features/command-palette/hooks/useCommandPalette.ts`                                                                                                     | Capture-phase pattern referenced but not modified. `usePaneShortcuts` is parallel, not nested.                                                                                                        |

### `LAYOUT_CYCLE` constant (in `usePaneShortcuts.ts`)

```ts
import type { LayoutId } from '../../sessions/types'

const LAYOUT_CYCLE: readonly LayoutId[] = [
  'single',
  'vsplit',
  'hsplit',
  'threeRight',
  'quad',
] as const
```

The cycle order matches `LAYOUTS` declaration order in `layouts.ts`. ⌘\ advances by `(currentIdx + 1) % LAYOUT_CYCLE.length`. In 5c-1's single-pane reality, advancing to layouts with `capacity > 1` is harmless — SplitView clamps the visible slice and the extra grid tracks render empty (5b behaviour).

### Net file count + LOC

- **New:** 7 files, ~553 LOC (tests share ~280 LOC).
- **Modified:** 10 files (now includes `TerminalPane/index.tsx` + its test for Decision #11's focus-coupling effect), ~+435 / -~18 LOC.
- **Total:** ~+988 / -~18, ~1006 LOC across ~17 files.

Larger than 5b (~625 LOC) but smaller than 5a. The motion goal + dual manager mutations + keyboard hook + focus-coupling effect account for the bulk.

## §2 Component APIs

### `LayoutSwitcher`

```tsx
import type { ReactElement } from 'react'
import { clsx } from 'clsx'
import type { LayoutId } from '../../../sessions/types'
import { LAYOUTS } from '../SplitView'
import { LayoutGlyph } from './LayoutGlyph'

export interface LayoutSwitcherProps {
  activeLayoutId: LayoutId
  onPick: (next: LayoutId) => void
}

export const LayoutSwitcher = ({
  activeLayoutId,
  onPick,
}: LayoutSwitcherProps): ReactElement => (
  <div
    data-testid="layout-switcher"
    role="toolbar"
    aria-label="Pane layout"
    className="inline-flex items-center gap-0.5 rounded-md bg-surface-container/60 p-0.5"
  >
    {Object.values(LAYOUTS).map((L) => (
      <button
        key={L.id}
        type="button"
        title={L.name}
        data-active={activeLayoutId === L.id || undefined}
        onClick={() => onPick(L.id)}
        className={clsx(
          'inline-flex h-5 w-6 items-center justify-center rounded',
          activeLayoutId === L.id
            ? 'bg-primary/15 text-primary ring-1 ring-primary/45'
            : 'text-on-surface-muted hover:text-on-surface'
        )}
      >
        <LayoutGlyph layoutId={L.id} />
      </button>
    ))}
  </div>
)
```

### `LayoutGlyph` (5 SVGs ported from prototype `splitview.jsx:554-683`)

```tsx
import type { ReactElement } from 'react'
import type { LayoutId } from '../../../sessions/types'

export interface LayoutGlyphProps {
  layoutId: LayoutId
}

export const LayoutGlyph = ({ layoutId }: LayoutGlyphProps): ReactElement => {
  const sw = 1.4
  const r = 1.4
  // Frame rect is identical across all glyphs; only the dividing lines vary.
  const frame = (
    <rect
      x="1"
      y="1"
      width="12"
      height="9"
      rx={r}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )
  const v = (
    <line
      x1="7"
      y1="1.5"
      x2="7"
      y2="9.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )
  const h = (
    <line
      x1="1.5"
      y1="5.5"
      x2="12.5"
      y2="5.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )
  const threeR1 = (
    <line
      x1="8"
      y1="1.5"
      x2="8"
      y2="9.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )
  const threeR2 = (
    <line
      x1="8"
      y1="5.5"
      x2="12.5"
      y2="5.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )

  return (
    <svg width="14" height="11" viewBox="0 0 14 11">
      {frame}
      {layoutId === 'vsplit' && v}
      {layoutId === 'hsplit' && h}
      {layoutId === 'threeRight' && (
        <>
          {threeR1}
          {threeR2}
        </>
      )}
      {layoutId === 'quad' && (
        <>
          {v}
          {h}
        </>
      )}
    </svg>
  )
}
```

### `usePaneShortcuts`

```ts
import { useEffect, useRef } from 'react'
import type { LayoutId, Session } from '../../sessions/types'

const LAYOUT_CYCLE: readonly LayoutId[] = [
  'single',
  'vsplit',
  'hsplit',
  'threeRight',
  'quad',
] as const

export interface UsePaneShortcutsOptions {
  sessions: Session[]
  activeSessionId: string | null
  setSessionActivePane: (sessionId: string, paneId: string) => void
  setSessionLayout: (sessionId: string, layoutId: LayoutId) => void
}

export const usePaneShortcuts = ({
  sessions,
  activeSessionId,
  setSessionActivePane,
  setSessionLayout,
}: UsePaneShortcutsOptions): void => {
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Decision #4 guard: require Ctrl OR Cmd; reject Alt + Shift so
      // common terminal shortcuts (Alt+1, Shift+\, Ctrl+Alt+T) flow
      // through to xterm untouched.
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.altKey || event.shiftKey) return

      const activeId = activeSessionIdRef.current
      if (activeId === null) return
      const activeSession = sessionsRef.current.find((s) => s.id === activeId)
      if (!activeSession) return

      // Cmd/Ctrl + 1-4 → focus pane index N. We pre-empt the key
      // UNCONDITIONALLY once the modifier+digit combination matches our
      // reserved set — even when panes[idx] doesn't exist or the
      // target is already active, the shortcut still belongs to us
      // and must NOT leak through to xterm.
      if (event.key >= '1' && event.key <= '4') {
        event.preventDefault()
        event.stopPropagation()
        const idx = parseInt(event.key, 10) - 1
        const target = activeSession.panes[idx]
        if (target && !target.active) {
          setSessionActivePane(activeSession.id, target.id)
        }
        return
      }

      // Cmd/Ctrl + \ → cycle layout. Always pre-empt the combination.
      if (event.key === '\\') {
        event.preventDefault()
        event.stopPropagation()
        const currentIdx = LAYOUT_CYCLE.indexOf(activeSession.layout)
        const nextIdx = (currentIdx + 1) % LAYOUT_CYCLE.length
        setSessionLayout(activeSession.id, LAYOUT_CYCLE[nextIdx])
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [setSessionActivePane, setSessionLayout])
}
```

### `setSessionActivePane` (added inside `useSessionManager` body)

```ts
const setSessionActivePane = useCallback(
  (sessionId: string, paneId: string): void => {
    setSessions((prev) => {
      // No-op guards return `prev` (same reference) so React skips the
      // re-render. `prev.map(...)` always builds a new array, so the
      // no-op branches must short-circuit before the map call.
      const idx = prev.findIndex((s) => s.id === sessionId)
      if (idx === -1) {
        // eslint-disable-next-line no-console
        console.warn(`setSessionActivePane: no session ${sessionId}`)
        return prev
      }
      const session = prev[idx]
      const target = session.panes.find((p) => p.id === paneId)
      if (!target) {
        // eslint-disable-next-line no-console
        console.warn(
          `setSessionActivePane: no pane ${paneId} in session ${sessionId}`
        )
        return prev
      }
      if (target.active) return prev // already active — avoid spurious re-render

      const newPanes = session.panes.map((p) => ({
        ...p,
        active: p.id === paneId,
      }))
      const newSession: Session = {
        ...session,
        panes: newPanes,
        workingDirectory: target.cwd, // re-materialize per 5a Decision #9
        agentType: target.agentType,
      }
      return [...prev.slice(0, idx), newSession, ...prev.slice(idx + 1)]
    })
  },
  []
)
```

### `setSessionLayout` (added inside `useSessionManager` body)

```ts
const setSessionLayout = useCallback(
  (sessionId: string, layoutId: LayoutId): void => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId)
      if (idx === -1) {
        // eslint-disable-next-line no-console
        console.warn(`setSessionLayout: no session ${sessionId}`)
        return prev
      }
      const session = prev[idx]
      if (session.layout === layoutId) return prev // same layout — skip re-render
      const newSession: Session = { ...session, layout: layoutId }
      return [...prev.slice(0, idx), newSession, ...prev.slice(idx + 1)]
    })
  },
  []
)
```

### `TerminalPane/index.tsx` — focus-coupling effect (Decision #11)

```tsx
// Added near the top of the function body, alongside the existing
// useFocusedPane / bodyRef declarations:
const wasActiveRef = useRef(pane.active)
useEffect(() => {
  if (pane.active && !wasActiveRef.current) {
    bodyRef.current?.focusTerminal()
  }
  wasActiveRef.current = pane.active
}, [pane.active])
```

The `wasActiveRef` rising-edge check ensures the effect only fires on
the `false → true` transition. Mount with `pane.active=true` does NOT
fire — the ref is initialised to `pane.active`'s mount value, so the
first effect-run sees `wasActiveRef.current === pane.active === true`
and skips the focus call. Subsequent transitions trigger normally.

This effect is the new contract; it does NOT replace any existing
mount-focus path. The post-5b `handleContainerClick` continues to
fire `bodyRef.current?.focusTerminal()` on direct DOM clicks into
the pane wrapper — orthogonal to the rising-edge effect.

### `SplitView` — additive prop + motion-wrapped render

```tsx
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'

export interface SplitViewProps {
  session: Session
  service: ITerminalService
  isActive: boolean
  onSessionCwdChange?: (sessionId: string, paneId: string, cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onSessionRestart?: (sessionId: string) => void
  /** NEW in 5c-1: click-to-focus dispatcher. */
  onSetActivePane?: (sessionId: string, paneId: string) => void
  deferTerminalFit?: boolean
}

// Key changes from 5b render (everything else preserved):
return (
  <LayoutGroup id={session.id}>
    <motion.div
      layout
      data-testid="split-view"
      data-session-id={session.id}
      data-layout={session.layout}
      className="grid h-full w-full gap-2 bg-surface p-2.5"
      style={{
        gridTemplateColumns: layout.cols,
        gridTemplateRows: layout.rows,
        gridTemplateAreas,
      }}
    >
      <AnimatePresence initial={false}>
        {visiblePanes.map((pane, i) => {
          const mode = paneMode(pane)
          return (
            <motion.div
              key={pane.id}
              layout
              layoutId={pane.id}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 360, damping: 34 }}
              onClick={() => onSetActivePane?.(session.id, pane.id)}
              data-testid="split-view-slot"
              data-pane-id={pane.id}
              data-pty-id={pane.ptyId}
              data-mode={mode}
              data-cwd={pane.cwd}
              className="relative min-h-0 min-w-0"
              style={{ gridArea: `p${i}` }}
            >
              <TerminalPane
                key={pane.ptyId}
                session={session}
                pane={pane} /* … */
              />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </motion.div>
  </LayoutGroup>
)
```

Notes:

- `LayoutGroup id={session.id}` scopes layoutId matching to one session. Without the explicit `id`, every session's `layoutId='p0'` would collide across mounted-but-hidden sessions (sessions stay mounted in `display:none` wrappers so PTYs stay alive — 5a non-goal #6).
- The new `onClick` does NOT stop propagation. `TerminalPane`'s existing `handleContainerClick` still fires `bodyRef.current?.focusTerminal()` — the two are complementary. (Decision #11's rising-edge effect inside `TerminalPane` handles the ⌘1-4 path where there is no DOM click.)

### `TerminalZone` — toolbar shape

```tsx
// Inserted between the `data-testid="terminal-zone"` wrapper and
// `data-testid="terminal-content"`:

const activeSession = sessions.find((s) => s.id === activeSessionId)
const showToolbar =
  !loading && sessions.length > 0 && activeSession !== undefined

// Platform-detect once. `navigator` may not exist in some test envs;
// guard with `typeof`.
const modKey =
  typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
    ? '⌘'
    : 'Ctrl'

{
  showToolbar ? (
    <div
      data-testid="layout-toolbar"
      className="flex shrink-0 items-center gap-2 bg-surface-container px-3 py-2"
    >
      <span className="font-mono text-xs uppercase tracking-wider text-on-surface-muted">
        Layout
      </span>
      <LayoutSwitcher
        activeLayoutId={activeSession.layout}
        onPick={(id) => setSessionLayout(activeSession.id, id)}
      />
      <span className="ml-auto font-mono text-xs text-on-surface-muted">
        <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>+
        <kbd className="rounded bg-on-surface/10 px-1">1-4</kbd> focus pane ·{' '}
        <kbd className="rounded bg-on-surface/10 px-1">{modKey}</kbd>+
        <kbd className="rounded bg-on-surface/10 px-1">\</kbd> cycle
      </span>
    </div>
  ) : null
}
```

## §3 Testing approach

### Coverage targets

| File                          | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LayoutSwitcher.test.tsx`     | 5 buttons render (one per LayoutId); `data-active` on the active button; clicking a non-active button fires `onPick(L.id)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `LayoutGlyph.test.tsx`        | Each `LayoutId` renders a `<svg>` with the expected line-count (single:0 lines, vsplit:1, hsplit:1, threeRight:2, quad:2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `usePaneShortcuts.test.ts`    | Synthetic `KeyboardEvent` dispatch on `document` (with `{ bubbles: true }` so the capture-phase listener fires). Cases: Cmd+1 with active=p0, no other panes → no mutation BUT `event.preventDefault` called (the shortcut is ours, even when already-active); Cmd+2 with `panes.length=1` → no mutation, `preventDefault` called (slot empty but shortcut still reserved); Cmd+\\ from `single` → `setSessionLayout(_, 'vsplit')` + `preventDefault`; Cmd+\\ from `quad` → `setSessionLayout(_, 'single')` (wrap) + `preventDefault`; Ctrl+Alt+1 → no mutation AND `preventDefault` NOT called (alt-augmented combination is outside our reserved set, let xterm see it); Shift+\\ → same; `activeSessionId=null` → no mutation, `preventDefault` NOT called; bare `1` (no modifier) → no mutation, no `preventDefault`; cleanup on unmount (re-dispatch after unmount verifies listener removed). |
| `useSessionManager.test.ts`   | `setSessionActivePane`: 2-pane fixture, flip p0→p1; exactly-one-active maintained; `Session.workingDirectory` re-derives to p1's `cwd`; `Session.agentType` re-derives to p1's `agentType`; idempotent on already-active flip (same React reference returned); missing paneId warns + no-ops. `setSessionLayout`: layout updates; panes unchanged; missing sessionId warns + no-ops; same-layout pick returns same session reference (no re-render).                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `SplitView.test.tsx`          | 5b tests pass unchanged. NEW: click-to-focus — 2-pane fixture (active=p0); `userEvent.click(slotP1)`; assert `onSetActivePane` mock called with `(session.id, 'p1')`. NEW: omitted `onSetActivePane` — clicking the slot is a no-op (no error, no side-effect).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `TerminalPane/index.test.tsx` | Rising-edge effect (Decision #11): render with `pane.active=false`, mock `Body.focusTerminal`; assert NOT called. Rerender `pane.active=true`; assert called once. Rerender again with `pane.active=true` (no flip); no additional call. Re-render `pane.active=false`, then `pane.active=true`; assert called once for the second rising edge. Initial mount with `pane.active=true` → **NEW effect** does NOT call `focusTerminal` (the rising-edge guard treats mount with `active=true` as no transition). Existing behaviour (the post-5b `handleContainerClick` path that fires `focusTerminal()` on direct DOM click into the wrapper) is unchanged and not retested here — its existing tests in `index.test.tsx` continue to cover it.                                                                                                                                                     |
| `TerminalZone.test.tsx`       | Toolbar mount: `sessions.length=0` → no `data-testid="layout-toolbar"`. `loading=true` → no toolbar. One session → toolbar mounts; `LayoutSwitcher` reflects `activeSession.layout`. Click a layout button → `setSessionLayout` mock called with `(activeSession.id, layoutId)`. Platform glyph: `navigator.platform='MacIntel'` (Object.defineProperty in beforeEach) → toolbar text contains `⌘`. Default jsdom (`'Linux x86_64'`) → `Ctrl`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `WorkspaceView.test.tsx`      | `vi.mock('../../terminal/hooks/usePaneShortcuts')`; assert it's called with `{ sessions, activeSessionId, setSessionActivePane, setSessionLayout }` matching the manager's exports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Mock strategy

- **`framer-motion`** — **no mock required.** `motion.div` / `motion.span` render as plain DOM in jsdom; `layout`, `layoutId`, `initial`, `animate`, `exit`, `transition` props are silently dropped. `AnimatePresence` and `LayoutGroup` are no-op wrappers. Existing tests in `Group.test.tsx`, `CommandPalette.test.tsx`, `UnsavedChangesDialog.test.tsx` already render real framer-motion components. New tests follow the same convention.
- **`navigator.platform`** — tests that exercise the toolbar glyph branch use `Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })` in a per-test `beforeEach` + `afterEach` restore. Other tests leave jsdom's default (`'Linux x86_64'`).
- **`bodyRef.current?.focusTerminal`** — replace via the existing `Body` mock seam in TerminalPane tests (`vi.fn()` injected via the test wrapper's `ref` argument).
- **Manager mutation callbacks** — `vi.fn()` in every dependent component test; assert call args.

### Coverage

Per `rules/typescript/testing/CLAUDE.md`: ≥80% statement coverage. New files (LayoutSwitcher, LayoutGlyph, usePaneShortcuts) target 95%+ — small, pure surfaces. Modified files maintain or improve existing coverage.

### Pre-push gate

`vitest run` runs every PR through pre-push (Husky). 5c-1 adds ~30 new test cases across 8 files. Post-5b baseline (~1074 tests) climbs to ~1100.

## §4 Risks & mitigations

| Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **xterm WebGL canvas inside `motion.div layout` transforms** — Motion's FLIP technique applies `transform: translate() scale()` to the wrapper during a layout transition. The canvas inside renders at its old pixel dimensions; for ~200ms (spring duration) until FitAddon refits via `ResizeObserver`, the terminal text may look blurry / scaled. Worst case: jagged glyph rendering during the animation.                                                         | Smoke-test during dev (manual click-through of all 5 layouts in `npm run tauri:dev`). If a visible regression appears, fall back to `<motion.div layout="position">` on the slot wrapper — position-only animation uses `transform: translate(...)` without `scale(...)`, so the canvas keeps its pixel dimensions through the transition. As a tertiary fallback, set `transition.duration: 0` for the active-pane's slot (avoids animating the pane the user is actively typing into). |
| **⌘\\ cycles through layouts that hide panes in 5c-2+** — 5c-1 ships `panes.length === 1` per session, so cycling is benign (SplitView's `selectVisiblePanes` keeps the single active pane visible regardless of `layout.capacity`). In 5c-2 (multi-pane via `addPane`), cycling from `quad` (4 panes) to `single` (capacity 1) hides 3 panes visually. PTYs stay alive (5b's clamp); cycling back restores visibility.                                                 | Out of 5c-1 scope. 5c-2 may refine to `LAYOUT_CYCLE.filter((id) => LAYOUTS[id].capacity >= activeSession.panes.length)` so the cycle only visits "fits-current-panes" layouts. 5c-1 documents the future trade-off rather than pre-committing.                                                                                                                                                                                                                                           |
| **Rust active-session contract diverges from React active-pane in 5c-2+** (Decision #10) — `service.setActiveSession(ptyId)` is called only on active-SESSION rotation. In 5c-1, `panes.length === 1`, so the cached active PTY = the only pane's PTY by construction. In 5c-2, when `setSessionActivePane` rotates between panes within a session, Rust's cached active PTY for that session stays at the previously-active pane until the user switches session tabs. | 5c-2's scope. Resolution options: (a) sync Rust on every `setSessionActivePane` (one extra IPC per click); (b) accept Rust's active-PTY-per-session as semantically distinct ("most recent intent"). Decision deferred to where multi-pane is first observable.                                                                                                                                                                                                                          |
| **Capture-phase document listener pre-empts focused text inputs** — `usePaneShortcuts` calls `preventDefault()` + `stopPropagation()` on Ctrl/Cmd+1-4 / Ctrl/Cmd+\\. If a focused `<input>` (session-rename, command palette search) wants those keys, the capture-phase listener fires first and pre-empts them.                                                                                                                                                       | The guarded combinations are narrow (Ctrl/Cmd+1-4 + Ctrl/Cmd+\\; no Alt/Shift). None overlap standard text-input shortcuts. The existing rename / palette inputs use Enter/Escape/arrow/letter keys. If a future input needs Ctrl+\\, it can call `event.stopPropagation()` in its own capture-phase listener attached to the input element (deeper capture-phase wins). Documented; unmitigated in 5c-1.                                                                                |
| **`navigator.platform` is deprecated** — Modern web platform spec prefers `navigator.userAgentData.platform`. `navigator.platform` still works in evergreen browsers + Tauri's WebView.                                                                                                                                                                                                                                                                                 | Accept the legacy API for 5c-1 — jsdom doesn't fully implement `userAgentData`, so falling back to `platform` is also a test-portability win. If a future Tauri release drops `navigator.platform`, the glyph silently defaults to `'Ctrl'` (still functionally correct on mac because `event.metaKey` covers Cmd; the on-screen label is the only mild confusion).                                                                                                                      |
| **First-time discoverability of ⌘1-4 / ⌘\\** — The toolbar hint label is the only signposting. Power users who hide the toolbar (when 5c-2's spawn flow lands in another visual surface) lose the discoverability anchor.                                                                                                                                                                                                                                               | The toolbar in 5c-1 is always visible when `sessions.length > 0`. Migration §9 step 8 (Command palette + keyboard shortcuts) may add a shortcut-overlay help screen. Out of 5c-1 scope; tracked as a future enhancement.                                                                                                                                                                                                                                                                 |

### Risk-free trade-offs (not in the table)

- **Spring transition tuning** — `{ stiffness: 360, damping: 34 }` ported from the user's demo. If perception during dev says it's too slow, tighten to `stiffness: 400, damping: 30` (snappier). Pure aesthetic; reversible.
- **Toolbar height** — ~32px (8px y-padding around a 16px control). If review pushes back as too thick, drop to 24px (4px y-padding).

## §5 References

- `docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md` — master UI migration spec; step 5 originally bundled SplitView + LayoutSwitcher + shortcuts + spawn/close. 5a/5b/5c-1/5c-2/5d slice the work.
- `docs/superpowers/specs/2026-05-10-step-5a-pane-model-refactor-design.md` — 5a's pane data model. 5c-1 consumes `Session.layout`, `Session.panes[]`, the exactly-one-active invariant, and the `pane.id` / `pane.ptyId` distinction directly.
- `docs/superpowers/specs/2026-05-11-step-5b-splitview-render-design.md` — 5b's SplitView render. 5c-1 wraps `motion.div` around it + adds click-to-focus + layout pick.
- `docs/design/handoff/prototype/src/splitview.jsx` — handoff prototype's `LayoutSwitcher`, `LayoutGlyph`, `TerminalPane`, and `VIMEFLOW_LAYOUTS` constants. 5c-1 ports the LayoutSwitcher UI + glyph SVGs verbatim.
- `docs/design/handoff/prototype/src/app.jsx:208-228` — prototype's keyboard handler. 5c-1 adopts the `metaKey || ctrlKey` guard + the cycle pattern (extended to all 5 layouts instead of binary toggle).
- `~/projects/shared-layout-animations/my-app/src/app/page.tsx` — user's Framer Motion shared-layout demo. 5c-1 adopts the full pattern (`LayoutGroup` + `motion.div layout` per pane + `AnimatePresence`).
- `~/projects/shared-layout-animations/my-app/MOTION_NOTES.md` — explainer of the three Motion primitives.
- `src/features/command-palette/hooks/useCommandPalette.ts` — capture-phase document-keydown reference implementation; `usePaneShortcuts` mirrors the pattern.
- `rules/common/pr-scope.md` — PR-scope discipline justifying the 5c-1 / 5c-2 split.
- `rules/typescript/coding-style/CLAUDE.md` + `rules/typescript/testing/CLAUDE.md` — code style + test conventions.

## §6 Next step after approval

Invoke `superpowers:writing-plans` to produce the implementation plan for 5c-1. Plan covers the sub-tasks in dependency order:

1. `LayoutGlyph` (pure SVG component, no deps)
2. `LayoutSwitcher` (consumes `LAYOUTS` + `LayoutGlyph`)
3. `setSessionLayout` mutation in `useSessionManager` + tests
4. `setSessionActivePane` mutation in `useSessionManager` + tests
5. `usePaneShortcuts` hook + tests
6. `SplitView` motion wrap + click-to-focus (depends on `setSessionActivePane`)
7. `TerminalPane/index.tsx` rising-edge focus effect (Decision #11) + tests
8. `TerminalZone` toolbar mount (depends on `LayoutSwitcher`, `setSessionLayout`) + tests
9. `WorkspaceView` plumbing (depends on `usePaneShortcuts`, `setSessionActivePane`, `setSessionLayout`)
10. `docs/roadmap/progress.yaml` update — mark `ui-s5c-1` `in_progress` → `done` on merge.

TDD per task: red test → green implementation → refactor.

<!-- codex-reviewed: 2026-05-12T14:03:07Z -->
