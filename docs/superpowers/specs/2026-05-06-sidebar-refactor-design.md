---
title: Sidebar Refactor — Promote to Global + Extract Reusable Session Primitives
date: 2026-05-06
status: draft
owners: [winoooops]
related:
  - GitHub issue #178
  - docs/design/UNIFIED.md
  - docs/design/handoff/README.md (§4.2 sessions list)
  - docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md (handoff migration; PR #174 = step 3, source of current Sidebar)
  - src/features/workspace/components/Sidebar.tsx (707 lines today)
  - src/features/workspace/components/SessionTabs.tsx (279 lines today)
---

# Sidebar Refactor — Promote to Global + Extract Reusable Session Primitives

## Context

After PR #174 landed step 3 of the UI handoff migration, `src/features/workspace/components/Sidebar.tsx` has grown to 707 lines under a single feature path. Four concerns sit inside it that no longer belong together:

1. **App-level chrome.** The 5-zone shell (`IconRail · Sidebar · Main · ActivityPanel · StatusBar`) treats the sidebar as a global region, not a workspace feature. Today's path implies the opposite.
2. **Workspace session UI.** `SessionRow`, `RecentSessionRow`, `GroupHeader`, the bright/dim state-pill lookups, the line-delta math, and the rename-input plumbing are all session-feature concerns stuffed inside the chrome file.
3. **Duplication between active/recent rows.** `SessionRow` and `RecentSessionRow` share ~80% of their structure (status dot, title, time, subtitle, state pill, line delta, hover edit/remove). Cycle 5 (dim Recent treatment) and cycle 6 (absolute-overlay activation button) increased the divergence on tone and event-routing details, raising the cost of any further change.
4. **Browser-style session tabs as a sibling.** `SessionTabs.tsx` (279 lines) is the strip-shaped peer of the sidebar's session list. Its inner per-tab JSX duplicates the same status-dot + name + close-button shape the row markup carries. Co-locating under a new `sessions/` subtree alongside the cards lets us mirror the same per-item leaf extraction pattern on both surfaces.

This refactor reorganises the four concerns onto separate module paths and replaces the duplicated row code with a single `Card` driving both Active and Recent renderings, plus a sibling `Tab` leaf for the strip.

## Naming convention

The new `sessions/` subtree follows a "directory provides namespace" rule: file names and exported symbols **do not repeat the `Session` prefix** when the path already implies it. Inside `src/features/workspace/sessions/`, files and their primary exports are:

| File                               | Export                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `sessions/components/Card.tsx`     | `Card`                                                                                                          |
| `sessions/components/Group.tsx`    | `Group` (compound — `Group` is the body container; `Group.Header` is a static sub-component for the header row) |
| `sessions/components/List.tsx`     | `List`                                                                                                          |
| `sessions/components/Tab.tsx`      | `Tab`                                                                                                           |
| `sessions/components/Tabs.tsx`     | `Tabs`                                                                                                          |
| `sessions/utils/statePill.ts`      | `STATE_PILL_LABEL`, `STATE_PILL_TONE`, `STATE_PILL_TONE_DIM`                                                    |
| `sessions/utils/lineDelta.ts`      | `lineDelta`                                                                                                     |
| `sessions/utils/subtitle.ts`       | `subtitle`                                                                                                      |
| `sessions/utils/mediateReorder.ts` | `mediateReorder` (pure helper used by `List` for cross-group reorder mediation; extracted for unit-testability) |

`WorkspaceView` reads these as `import { List } from './sessions/components/List'`; the new `Sidebar` is content-agnostic and must not import any of these symbols (per Decision #1). The path supplies the disambiguating context. Old names referenced in this spec (`SessionRow`, `RecentSessionRow`, `SessionTabs`, …) refer to the pre-refactor code that this PR removes.

## Goals

1. **Promote `Sidebar` to a generic, content-agnostic chrome component** at `src/components/sidebar/Sidebar.tsx`. It owns layout (vertical column, bounded scroll-eligible content region, resizable bottom-pane height + handle) and knows nothing about `Session` / `SessionStatus` / agent state. The `content` slot's caller owns its own scroll element (Sidebar provides bounded space but does not apply `overflow-y-auto`). The bottom pane is a generic slot — callers decide what fills it (workspace fills with `FileExplorer`).
2. **Co-locate workspace session UI** under `src/features/workspace/sessions/` per the table above.
3. **Replace `SessionRow` + `RecentSessionRow` with a single `Card`** parameterised by `variant: 'active' | 'recent'` driving wrapper element (`Reorder.Item` vs `<li>`), tone, and minor structural differences.
4. **Mirror the extraction for the session-tab strip**: rename `SessionTabs.tsx` → `sessions/components/Tabs.tsx` and pull the per-tab JSX into `sessions/components/Tab.tsx`.
5. **Redistribute the 25 tests** in `Sidebar.test.tsx` to colocated leaf files plus a small set of `List.test.tsx` integration tests for cross-component flows (remove-active + focus-restore, scroll-region invariant, group-split rendering).
6. **No visual or behavioural regression** vs the cycle-6 sidebar that ships in PR #174.

## Non-goals

- The SESSIONS / FILES / CONTEXT three-tab switcher in the sidebar (#175). The named-slot Sidebar API leaves room for #175 to swap `content` without touching `Sidebar`, but the switcher itself is not in this PR.
- Any change to session domain types (`Session`, `SessionStatus`), Tauri commands, or `useSessionManager` internals.
- Hoisting the `handleRemoveSession` next-id-and-focus wrapper into a hook shared with `Tabs.handleClose`. Both wrappers stay file-local for now; a follow-up could unify them, but the focus-target divergence (`sidebar-activate-${id}` vs `session-tab-${id}`) makes unification non-trivial.
- Activity-panel restyle (#165, step 6) and bottom-drawer restyle (#166, step 7).

## Decisions (locked during brainstorming)

| #   | Decision                                                                                                                                                                                                                                                                                                                  | Rationale                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sidebar uses **named slots** (`header` / `content` / `bottomPane` / `footer`)                                                                                                                                                                                                                                             | Cleanest "chrome owns layout, feature owns content" boundary. Slot names are chrome-only — `bottomPane` doesn't presume FileExplorer fills it.                                                                                                                                                                                     |
| 2   | `Card` is **a single component** with `variant: 'active' \| 'recent'`                                                                                                                                                                                                                                                     | Two variants only; one switch covers them. Avoids file-multiplication for marginal flexibility we may never need.                                                                                                                                                                                                                  |
| 3   | Reorder-ownership splits across three layers: `List` owns active/recent split + cross-group reorder mediation + remove-flow handler; `Group` owns the per-group container element (`Reorder.Group` for active, `<ul>` for recent); `Card` owns the per-row wrapper element (`Reorder.Item` for active, `<li>` for recent) | Encapsulates session-aggregator behaviour in one workspace file. `Group` is the natural owner of the drag context for one group; `List` mediates because the cross-group concatenation (`[...reorderedActive, ...recentRef.current]`) requires both groups' state. WorkspaceView passes `<List ... />` to `Sidebar.content`.       |
| 4   | Tests redistribute as **leaf + thin integration** (2–3 `List.test.tsx` integration tests for cross-component flows)                                                                                                                                                                                                       | Each behavior tested at its origin; cross-component coordination keeps integration coverage at the assembly point.                                                                                                                                                                                                                 |
| 5   | The session-tab strip co-locates AND extracts a `Tab` leaf                                                                                                                                                                                                                                                                | Mirrors the `Card` extraction. Strip orchestrator (`Tabs`) stays thin; per-tab JSX is reusable.                                                                                                                                                                                                                                    |
| 6   | `pickNextVisibleSessionId`, `getVisibleSessions`, `isOpenSessionStatus`, `agentForSession` stay in `workspace/utils/`                                                                                                                                                                                                     | `TerminalZone.tsx` (outside `sessions/`) consumes `pickNextVisibleSessionId` and `isOpenSessionStatus`. Keeping them at the workspace level avoids `TerminalZone` taking a `../sessions/utils/...` dependency on a sibling subtree it doesn't otherwise touch. Inside `sessions/`, `Tabs` and `List` import via `../../utils/...`. |
| 7   | File names and exported symbols **do not repeat the `Session` prefix** inside `sessions/`                                                                                                                                                                                                                                 | Directory provides namespace context. File name = symbol name keeps lint and grep-by-component-name predictable.                                                                                                                                                                                                                   |

## File layout

### Before

```
src/
├── components/
│   ├── Tooltip.tsx
│   └── Tooltip.test.tsx
└── features/
    └── workspace/
        ├── components/
        │   ├── Sidebar.tsx              ← 707 lines (this refactor's source)
        │   ├── Sidebar.test.tsx         ← 25 tests
        │   ├── SessionTabs.tsx          ← 279 lines
        │   ├── SessionTabs.test.tsx
        │   ├── SidebarStatusHeader.tsx  ← unchanged
        │   ├── StatusDot.tsx            ← unchanged
        │   ├── panels/FileExplorer.tsx  ← unchanged
        │   └── … (BottomDrawer, IconRail, etc., unchanged)
        ├── hooks/useRenameState.ts      ← unchanged
        └── utils/
            ├── pickNextVisibleSessionId.ts  ← unchanged (Decision #6)
            └── agentForSession.ts            ← unchanged (Decision #6)
```

### After

```
src/
├── components/
│   ├── Tooltip.tsx                     ← unchanged
│   ├── Tooltip.test.tsx                ← unchanged
│   └── sidebar/
│       ├── Sidebar.tsx                 ← NEW (generic chrome; ~120 lines target)
│       └── Sidebar.test.tsx            ← NEW (slot composition + split-resize)
└── features/
    └── workspace/
        ├── components/
        │   ├── SidebarStatusHeader.tsx ← unchanged
        │   ├── StatusDot.tsx           ← unchanged
        │   ├── panels/FileExplorer.tsx ← unchanged
        │   └── … (BottomDrawer, IconRail, etc., unchanged)
        ├── sessions/                   ← NEW subtree
        │   ├── components/
        │   │   ├── List.tsx            ← composer (active/recent split, reorder ctx, remove-flow)
        │   │   ├── List.test.tsx       ← integration (cross-component flows)
        │   │   ├── Group.tsx           ← header + list + empty-state per variant
        │   │   ├── Group.test.tsx
        │   │   ├── Card.tsx            ← single component, variant: 'active' | 'recent'
        │   │   ├── Card.test.tsx       ← variant tests
        │   │   ├── Tabs.tsx            ← strip orchestrator (was SessionTabs.tsx)
        │   │   ├── Tabs.test.tsx       ← was SessionTabs.test.tsx
        │   │   ├── Tab.tsx             ← per-tab leaf (extracted from Tabs)
        │   │   └── Tab.test.tsx
        │   └── utils/
        │       ├── statePill.ts        ← STATE_PILL_LABEL / TONE / TONE_DIM
        │       ├── statePill.test.ts
        │       ├── lineDelta.ts        ← was sessionLineDelta()
        │       ├── lineDelta.test.ts
        │       ├── subtitle.ts         ← was sessionSubtitle()
        │       ├── subtitle.test.ts
        │       ├── mediateReorder.ts   ← pure cross-group reorder helper
        │       └── mediateReorder.test.ts
        ├── hooks/useRenameState.ts     ← unchanged (consumed by Card)
        └── utils/                      ← unchanged (Decision #6)
            ├── pickNextVisibleSessionId.ts
            └── agentForSession.ts
```

### Move / extract / delete summary

| Op      | From                                                                                                | To                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOVE    | `features/workspace/components/Sidebar.tsx`                                                         | `components/sidebar/Sidebar.tsx`                       | Body rewritten as content-agnostic chrome (slot props). See §"Sidebar API".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| SPLIT   | `features/workspace/components/Sidebar.test.tsx`                                                    | new `Sidebar.test.tsx` + `List.test.tsx` + leaf tests  | 25 tests redistribute. Mapping in §"Test redistribution".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| MOVE    | `features/workspace/components/SessionTabs.tsx`                                                     | `features/workspace/sessions/components/Tabs.tsx`      | Renamed; per-tab JSX extracted into sibling `Tab.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| MOVE    | `features/workspace/components/SessionTabs.test.tsx`                                                | `features/workspace/sessions/components/Tabs.test.tsx` | Tests stay green; some move to `Tab.test.tsx` if they target per-tab markup specifically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| EXTRACT | inline `SessionRow` + `RecentSessionRow` (Sidebar.tsx)                                              | `sessions/components/Card.tsx`                         | Single component with `variant` prop; both old types removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| EXTRACT | inline `GroupHeader` + group containers (Sidebar.tsx)                                               | `sessions/components/Group.tsx`                        | Header + list shell + empty-state + per-group container element. Variant controls the container element (`Reorder.Group` for active, `<ul>` for recent), receiving `sessions` + optional `onReorder` from `List`. `List` (not `Group`) bridges per-group `onReorder` calls into a full-sessions update via the `recentGroupRef` pattern.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| EXTRACT | session split logic + `handleRemoveSession` (Sidebar.tsx)                                           | `sessions/components/List.tsx`                         | Workspace composer. Mounts both `Group`s, owns reorder callback, owns next-id-and-focus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| EXTRACT | inline `STATE_PILL_*` constants (Sidebar.tsx)                                                       | `sessions/utils/statePill.ts`                          | Three named exports, no logic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| EXTRACT | inline `sessionLineDelta()` (Sidebar.tsx)                                                           | `sessions/utils/lineDelta.ts`                          | Renamed `lineDelta`. Pure function over `Session`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| EXTRACT | inline `sessionSubtitle()` (Sidebar.tsx)                                                            | `sessions/utils/subtitle.ts`                           | Renamed `subtitle`. Pure function over `Session`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| NEW     | inline `[...reorderedActive, ...recentRef.current]` cross-group reorder concatenation (Sidebar.tsx) | `sessions/utils/mediateReorder.ts`                     | Pure helper `mediateReorder(reorderedActive, recent)` consumed by `List`. Extracted so its unit test runs without rendering framer-motion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| EDIT    | `features/workspace/WorkspaceView.tsx`                                                              | (same path)                                            | Imports change: `./components/Sidebar` → `../../components/sidebar/Sidebar`; `./components/SessionTabs` → `./sessions/components/Tabs`; `./hooks/useResizable` → `../../hooks/useResizable` (see §"Sidebar API" scope addition). NEW imports needed: `./components/SidebarStatusHeader` (mounted in `Sidebar.header` slot), `./components/panels/FileExplorer` (mounted in `Sidebar.bottomPane` slot), and `./sessions/components/List` (mounted in `Sidebar.content` slot). Passes 4 slots to `Sidebar`; the previous flow of passing `agentStatus` + `activeCwd` + `onFileSelect` props directly to `Sidebar` goes away (those concerns move into the slot children). FileExplorer's `cwd` prop must preserve today's `'~'` fallback: `<FileExplorer cwd={activeSession?.workingDirectory ?? '~'} ... />` — the existing `activeCwd` const at the top of the component falls back to `'.'` for other consumers (e.g. `useGitStatus`); do NOT use that const as FileExplorer's `cwd` source unless the fallback is changed to `'~'`. |
| EDIT    | `features/workspace/WorkspaceView.command-palette.test.tsx`                                         | (same path)                                            | `vi.mock('./components/Sidebar', ...)` → `vi.mock('../../components/sidebar/Sidebar', ...)`. Mock factory body unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| EDIT    | `features/workspace/WorkspaceView.subscription.test.tsx`                                            | (same path)                                            | `vi.mock('./components/Sidebar', ...)` → `vi.mock('../../components/sidebar/Sidebar', ...)`. Mock factory body MUST also be updated: the new `Sidebar` no longer receives `agentStatus` (it lives inside the `header` slot's `<SidebarStatusHeader>`). Specifically: drop the `capturedSidebarProps` declaration (line 124), the `beforeEach` reset of `capturedSidebarProps.agentStatus` (line 191), the capture inside the mock factory (line 147), AND the two assertions reading `capturedSidebarProps.agentStatus` (lines 211 + 219). The test's intent ("`agentStatus` flows to downstream consumers") is preserved by the existing `capturedPanelProps.agentStatus` assertions on the `AgentStatusPanel` mock (already in the same file at line 153).                                                                                                                                                                                                                                                                          |

### Files explicitly NOT touched

- `IconRail.tsx` — issue notes it could also move global "but for this refactor, focus on Sidebar." Out of scope here.
- `SidebarStatusHeader.tsx`, `StatusDot.tsx` — leaf primitives consumed by the new tree but not moved. `Sidebar.test.tsx` does NOT import `SidebarStatusHeader`; slot props receive plain `ReactNode` test fixtures (e.g., `<div data-testid="header-fixture">…</div>`) so the chrome's tests stay decoupled from feature components.
- `useRenameState.ts` (in `workspace/hooks/`) — consumed by `Card.tsx`. Stays where it is.
- `pickNextVisibleSessionId.ts`, `getVisibleSessions`, `isOpenSessionStatus` (in `workspace/utils/`) — consumed by both `Tabs.tsx` and the new `List.tsx`. Decision #6 keeps them in `workspace/utils/`.
- `agentForSession.ts` — same.

## Sidebar API contract

### File: `src/components/sidebar/Sidebar.tsx`

The new `Sidebar` is a content-agnostic, four-slot chrome component. It owns the vertical column and the resizable bottom pane; the `content` slot's caller owns its own scroll element (Sidebar provides bounded space, not `overflow-y-auto`). It owns no domain types and does no domain rendering.

### Props

```ts
import type { ReactNode } from 'react'

export interface SidebarProps {
  /** Top fixed-height region. */
  header?: ReactNode
  /** Middle scroll-eligible region (flex 1). Sidebar provides bounded space; the content's caller owns its own overflow. Required. */
  content: ReactNode
  /**
   * Optional resizable bottom pane below `content`. When present, a
   * horizontal split-resize handle separates `content` from
   * `bottomPane`. When absent, `content` fills the rest.
   */
  bottomPane?: ReactNode
  /** Bottom fixed-height region (e.g. primary action button). */
  footer?: ReactNode
  /** Initial bottom-pane height in pixels. Default 320. */
  bottomPaneInitialHeight?: number
  /** Minimum bottom-pane height. Default 100. */
  bottomPaneMinHeight?: number
  /** Maximum bottom-pane height. Default 500. */
  bottomPaneMaxHeight?: number
  /** Test hook id. Default `'sidebar'`. */
  'data-testid'?: string
}
```

### Layout (top → bottom)

```
┌──────────────────────────┐
│ header                   │  fixed (px-3 pt-3 pb-2; intrinsic height)
├──────────────────────────┤
│                          │
│ content (flex 1; scroll-│
│   eligible — caller owns │
│   its overflow element)  │
│                          │
├──────────────────────────┤
│ ─── resize handle ───    │  4px row (h-1), cursor-row-resize, hover-tinted
├──────────────────────────┤
│                          │
│ bottomPane (heightPx)    │  resizable, only rendered when prop provided
│                          │
├──────────────────────────┤
│ footer                   │  fixed (p-3)
└──────────────────────────┘
```

### Slot absence semantics

All slots except `content` are optional. A slot's wrapper renders only when the prop is not `null`, `undefined`, or `false` — those three values suppress the wrapper, leaving no empty padded gap. Other valid `ReactNode` values (including `0` and `''`) DO render their wrapper (React would render those as text content; the wrapper exists to host them). When `bottomPane` is absent (`null` / `undefined` / `false`), both the resize handle and the bottom region are omitted and `content` flexes to fill the area below `header` and above `footer`.

### Internal behaviour

- **Resize state.** Sidebar uses the shared `useResizable` hook with `direction: 'vertical'`, `invert: true` (handle sits at the top edge of the bottom pane; dragging up grows the pane). To avoid Sidebar (a generic chrome component) importing from `src/features/`, this PR promotes `useResizable` from `src/features/workspace/hooks/useResizable.ts` → `src/hooks/useResizable.ts`. The hook is already domain-agnostic (no `Session` knowledge); WorkspaceView keeps using it for sidebar width via the new path.
- **Initial-height clamping.** `useResizable` clamps `initial` to `[min, max]` on mount via `useState(() => Math.round(Math.min(max, Math.max(min, initial))))`. This is a 3-line fix to the hook (currently `useState(initial)`); it benefits all four `useResizable` consumers (Sidebar bottom-pane, sidebar width in WorkspaceView, BottomDrawer height, future) and prevents `aria-valuenow` from briefly reflecting an out-of-range value before the first drag.
- **Scroll ownership.** Sidebar provides BOUNDED vertical space for the `content` slot via `<div className="flex min-h-0 flex-1 flex-col">{content}</div>`. Sidebar does NOT apply `overflow-y-auto` and does NOT depend on `framer-motion`. The `content` slot's caller (`List` in this PR) is responsible for its own scroll element — including `motion.div` with `layoutScroll` for framer-motion's drag-while-scrolled support. This keeps Sidebar's chrome layer framer-motion-free while preserving today's drag behavior. (Full detail in §"Workspace session module — `List`".)
- **Drag overlay.** While dragging, a viewport-covering `<div className="fixed inset-0 z-50 cursor-row-resize" />` suppresses iframe / xterm mouse events (preserves the existing pattern from PR #174).
- **Resize handle a11y.** `role="separator"`, `aria-orientation="horizontal"`, `aria-valuenow`/`aria-valuemin`/`aria-valuemax` reflect the live size. Mouse-driven via `useResizable.handleMouseDown`. Keyboard-driven adjustment (arrow keys via `useResizable.adjustBy(±step)`) is deferred — see #180. Pre-existing gap inherited from PR #174; this refactor preserves the gap rather than introducing a new one.

### What Sidebar does NOT do

- Knows nothing about `Session`, `SessionStatus`, `AgentStatus`, or `FileNode`.
- Does not import from `src/features/`.
- Does not own session state, file selection, or agent-status display. Workspace fills the slots.

### WorkspaceView wiring (illustrative)

```tsx
<Sidebar
  header={
    <SidebarStatusHeader
      status={agentStatus}
      activeSessionName={
        sessions.find((s) => s.id === activeSessionId)?.name ?? null
      }
    />
  }
  content={
    <List
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSessionClick={setActiveSessionId}
      onNewInstance={createSession}
      onRemoveSession={removeSession}
      onRenameSession={renameSession}
      onReorderSessions={reorderSessions}
    />
  }
  bottomPane={
    <FileExplorer
      cwd={activeSession?.workingDirectory ?? '~'}
      onFileSelect={handleFileSelect}
    />
  }
  footer={
    <button
      type="button"
      onClick={createSession}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-secondary py-2.5 font-label text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition-all hover:shadow-xl hover:shadow-primary/20"
      aria-label="New Instance"
    >
      <span className="material-symbols-outlined text-lg">bolt</span>
      <span>New Instance</span>
    </button>
  }
/>
```

The "New Instance" gradient button stays inline in `WorkspaceView`'s footer slot rather than being extracted into a component — `createSession` is in scope, the styling is non-reusable today, and inlining keeps the slot-API call site readable. Extraction can happen later if a second consumer appears.

### Scope addition: `useResizable` promotion

Promoting the hook is a small adjacent move, not strictly required by issue #178, but necessary to keep `Sidebar` free of `src/features/` imports. Files affected:

| Op   | From                                                            | To                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOVE | `src/features/workspace/hooks/useResizable.ts`                  | `src/hooks/useResizable.ts`      | Plus the 3-line `initial` clamp fix described above.                                                                                                                                                                                                                                                                                                                                                 |
| MOVE | `src/features/workspace/hooks/useResizable.test.ts`             | `src/hooks/useResizable.test.ts` | Add a regression test for the clamp (initial > max → clamps to max; initial < min → clamps to min).                                                                                                                                                                                                                                                                                                  |
| EDIT | `src/features/workspace/WorkspaceView.tsx`                      | (same path)                      | Import path bump: `./hooks/useResizable` → `../../hooks/useResizable`.                                                                                                                                                                                                                                                                                                                               |
| EDIT | `src/features/workspace/components/BottomDrawer.tsx`            | (same path)                      | Import path bump: `../hooks/useResizable` → `../../../hooks/useResizable`. `BottomDrawer.test.tsx` does NOT `vi.mock` `useResizable` (lets the real hook run), so no test edit is needed beyond the import-path fallout in `BottomDrawer.tsx` itself.                                                                                                                                                |
| EDIT | `src/features/workspace/WorkspaceView.command-palette.test.tsx` | (same path)                      | Two path-bump sites: (1) `vi.mock('./hooks/useResizable', ...)` → `vi.mock('../../hooks/useResizable', ...)` (line 11); (2) the dynamic `await import('./hooks/useResizable')` inside `beforeEach` (line 110) → `await import('../../hooks/useResizable')`. Both must change in lockstep or the mock and the import resolve to different module identities and the test silently runs the real hook. |

## Workspace session module — `Card`

### File: `src/features/workspace/sessions/components/Card.tsx`

`Card` is a single component rendering one row in a session group. It is the consolidation of the pre-refactor `SessionRow` + `RecentSessionRow`. The `variant` prop drives every per-variant visual difference: wrapping element, drag affordance, tone, and layout. Rename eligibility is callback-driven (gated on `onRename` presence) regardless of variant.

### Props

```ts
import type { Session } from '../../types'

export interface CardProps {
  session: Session
  variant: 'active' | 'recent'
  isActive: boolean
  onClick: (id: string) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, name: string) => void
}
```

### Variant matrix

| Aspect                 | `'active'`                                                | `'recent'`                                                          |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Wrapper element        | `Reorder.Item`                                            | `<li>`                                                              |
| Cursor                 | `cursor-grab active:cursor-grabbing`                      | default                                                             |
| `data-testid`          | `session-row`                                             | `recent-session-row`                                                |
| StatusDot              | default `size`, no `dim`                                  | `size={6}` `dim`                                                    |
| Title color (inactive) | `text-on-surface`                                         | `text-on-surface-variant/60`                                        |
| Title color (active)   | `text-on-surface`                                         | `text-on-surface`                                                   |
| Title font size        | 13px                                                      | 12.5px                                                              |
| State pill class       | `STATE_PILL_TONE[status]`                                 | `STATE_PILL_TONE_DIM[status]`                                       |
| Subtitle layout        | block below title (full row, `pl-[15px]`)                 | right-aligned inline next to state pill (`ml-auto` on the same row) |
| Vertical padding       | `py-2.5`                                                  | `py-2`                                                              |
| Drag visual            | `whileDrag={{ scale: 1.02, boxShadow: ..., zIndex: 50 }}` | n/a                                                                 |
| Layout animation       | `layout="position"`                                       | n/a                                                                 |
| Time-text dimness      | `text-on-surface-variant/70`                              | `text-on-surface-variant/50`                                        |
| Line-delta classes     | bright (`text-success` / `text-error`)                    | dim (`text-success/70` / `text-error/70`)                           |

### Common (variant-agnostic) behavior

- **Selection indicator.** When `isActive`, render a vertical bar (`<span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary-container" />`) as the first child of the wrapper.
- **Absolute overlay activation.** A full-row `<button>` is positioned `absolute inset-0`, above the selection bar but below the foreground content via `pointer-events-none` on the content layer. Pattern preserved verbatim from PR #174 (solves the HTML-validity issue with nested `<input>`). The button carries `id="sidebar-activate-${session.id}"` — `List.handleRemoveSession` uses this id for focus restoration.
- **Foreground content.** A `pointer-events-none` flex column above the activation button contains:
  - StatusDot + title (or rename input when `isEditing`) + timestamp.
  - Subtitle (variant-positioned per matrix).
  - State pill + optional line-delta.
- **Rename plumbing.** `Card` calls `useRenameState(session, onRename)` (workspace hook, path unchanged: `src/features/workspace/hooks/useRenameState.ts`). Double-click on the title `<span>` triggers `beginEdit` only when `onRename` is provided. The rename `<input>` and the title `<span>` opt back into pointer events with `pointer-events-auto` so they sit above the activation button.
- **Title-click activation (mandatory).** The title `<span>` (when not editing) carries an explicit `onClick={() => onClick(session.id)}` alongside `onDoubleClick={beginEdit}`. Without the explicit single-click handler, `pointer-events-auto` (needed for the rename double-click) would intercept clicks on the visible name before they reach the sibling overlay button — silently breaking row activation for clicks that land on the title text. PR #174 already carries this `onClick`; the refactor preserves it verbatim.
- **Hover actions.** Top-right absolute cluster (`absolute right-2 top-2`) with edit + remove buttons, opacity-0 by default, `group-hover:opacity-100` and `group-focus-within:opacity-100`. Each carries `pointer-events-auto`. Edit button rendered iff `onRename` provided; remove button rendered iff `onRemove` provided.
- **Time formatting.** `formatRelativeTime(session.lastActivityAt)` from `src/features/agent-status/utils/relativeTime` (path unchanged).
- **Subtitle source.** `subtitle(session)` from `sessions/utils/subtitle.ts`.
- **Line delta.** `lineDelta(session)` from `sessions/utils/lineDelta.ts`. Renders only when `added > 0 || removed > 0`.
- **Aria-hidden on title `<span>`.** Preserves PR #174's pattern: the activation `<button>` carries `aria-label={session.name}`, so the visible `<span>` is `aria-hidden="true"` to avoid double-announcing the name to assistive tech.

### Implementation sketch

```tsx
export const Card = ({
  session,
  variant,
  isActive,
  onClick,
  onRemove = undefined,
  onRename = undefined,
}: CardProps): ReactElement => {
  const {
    isEditing,
    editValue,
    setEditValue,
    inputRef,
    beginEdit,
    commitRename,
    cancelRename,
  } = useRenameState(session, onRename)
  const { added, removed } = lineDelta(session)
  const subtitleText = subtitle(session)

  // Inner content is identical between variants; only the outer wrapper
  // and class lookups differ. Two render paths keep TypeScript happy
  // around the Reorder.Item-vs-li polymorphism and avoid a polymorphic
  // `Wrapper = condition ? Reorder.Item : 'li'` which has no common
  // prop signature.
  const inner = (
    <>
      {isActive && <SelectionBar />}
      <ActivationButton
        sessionId={session.id}
        name={session.name}
        disabled={isEditing}
        onClick={onClick}
      />
      <CardContent
        variant={variant}
        isActive={isActive}
        session={session}
        subtitle={subtitleText}
        added={added}
        removed={removed}
        renameState={{
          isEditing,
          editValue,
          setEditValue,
          inputRef,
          beginEdit,
          commitRename,
          cancelRename,
        }}
        canRename={onRename !== undefined}
      />
      <HoverActions
        onEdit={onRename ? beginEdit : undefined}
        onRemove={onRemove ? () => onRemove(session.id) : undefined}
      />
    </>
  )

  if (variant === 'active') {
    return (
      <Reorder.Item
        value={session}
        id={session.id}
        data-testid="session-row"
        data-session-id={session.id}
        data-active={isActive}
        className={activeCardClass(isActive)}
        whileDrag={{
          scale: 1.02,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 50,
        }}
        layout="position"
      >
        {inner}
      </Reorder.Item>
    )
  }

  return (
    <li
      data-testid="recent-session-row"
      data-session-id={session.id}
      data-active={isActive}
      className={recentCardClass(isActive)}
    >
      {inner}
    </li>
  )
}
```

`SelectionBar`, `ActivationButton`, `CardContent`, and `HoverActions` are file-local sub-components (not exported). They keep `Card.tsx` legible without leaking implementation primitives. `activeCardClass` / `recentCardClass` are simple `(isActive) => string` helpers returning today's class strings verbatim.

### Test surface (`Card.test.tsx`)

Active-variant tests must wrap the `Card` in a `Reorder.Group` parent — `Reorder.Item` requires that ancestry. Add a `renderActiveCard(session, props?)` helper at the top of the test file:

```tsx
import { Reorder } from 'framer-motion'
import { render } from '@testing-library/react'

const renderActiveCard = (
  session: Session,
  overrides: Partial<CardProps> = {}
) =>
  render(
    <Reorder.Group axis="y" values={[session]} onReorder={() => {}}>
      <Card
        session={session}
        variant="active"
        isActive={false}
        onClick={() => {}}
        {...overrides}
      />
    </Reorder.Group>
  )
```

Recent-variant tests render `<Card variant="recent" ...>` directly under `<ul>` (since `Card` returns a bare `<li>` for recent). A symmetric `renderRecentCard` helper wrapping in `<ul>` keeps the test markup HTML-valid.

Tests cover, per variant where relevant:

- Renders status dot reflecting `session.status` (Active: default size; Recent: size 6 + dim).
- Renders subtitle text (uses real `subtitle(session)` — no mock; keeps behavior end-to-end).
- Renders state pill with correct label + tone class (bright for Active, dim for Recent).
- Renders line-delta only when `added > 0 || removed > 0`.
- `onClick(id)` fires when activation button is clicked (`getByLabelText(session.name)`).
- Single-clicking the title `<span>` activates the row (regression guard for the `pointer-events-auto` interception — if a future change drops the explicit `onClick` on the title span, this test fails).
- Active selection bar rendered iff `isActive`.
- `data-testid` is `session-row` for Active, `recent-session-row` for Recent.
- Active variant renders inside a `Reorder.Item` (asserted via `data-testid="session-row"` + the drag-related class on the wrapper); Recent renders as a plain `<li>`.
- `onRename` plumbing: double-click title with `onRename` → enters edit mode; Enter commits; Escape cancels; Blur commits.
- Edit/remove buttons hidden when `onRename` / `onRemove` is omitted.
- `onRemove` plumbing: clicking remove fires `onRemove(id)`.

`Card.test.tsx` does NOT cover Active+Recent integration, group-split, or remove-flow next-id selection — those move to `List.test.tsx`.

## Workspace session module — `Group`

### File: `src/features/workspace/sessions/components/Group.tsx`

`Group` is a **compound component** with two parts:

- `Group.Header` — renders the section header row (`<h3>` + optional `headerAction`).
- `Group` (default body) — renders the per-group container element (`Reorder.Group` for active, `<ul>` for recent) with cards or empty state.

The split exists because PR #174's `Sidebar.tsx` places the Active `<h3>` OUTSIDE the scroll region but the Recent `<h3>` INSIDE — see §"Workspace session module — `List`" for how `List` exploits this split to preserve verbatim layout. A single header+body component cannot model the asymmetric placement.

`Group` is unaware of `Card`'s internals; `List` builds the cards and hands them in via `children`.

### Props

```ts
import type { ReactNode } from 'react'
import type { Session } from '../../types'

// --- Group.Header ---
export interface GroupHeaderProps {
  label: string // "Active" | "Recent"
  headerAction?: ReactNode // e.g. the "+" button next to the Active header
}

// --- Group (body) ---
type GroupBodyCommonProps = {
  sessions: Session[] // drives Reorder.Group's `values` AND the empty check
  emptyState?: ReactNode // rendered when sessions.length === 0
  children: ReactNode // cards rendered by the caller (List)
}

export type GroupProps = GroupBodyCommonProps &
  (
    | { variant: 'active'; onReorder: (sessions: Session[]) => void }
    | { variant: 'recent'; onReorder?: never }
  )
```

The discriminated union enforces at the type level that Active groups receive an `onReorder` callback (Reorder.Group requires one) while Recent groups must not pass `onReorder` (it would be ignored, which is worse than impossible).

### Defaults

- `Group.Header` `data-testid`: `session-group-${label.toLowerCase()}` (matches today's `session-group-active` / `session-group-recent`).
- `Group` (body) `data-testid`: `session-list` (active variant), `recent-list` (recent variant).
- Body container className (per variant, preserves today's Sidebar.tsx classes):
  - Active: `flex flex-col px-2`
  - Recent: `flex flex-col px-2 pb-1`
- Header className: `flex items-center justify-between pr-3` outer wrapper around `<h3 className="px-3 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-on-surface-variant/70">`.
- Empty-state rendering: when `sessions.length === 0`, render `emptyState` (caller wraps in a valid child element for the container — `<li>` for both variants since both containers are list elements). When `emptyState` is `undefined` and the body is empty, the container still renders (empty) but with no children. `List` chooses not to mount the Recent `Group` at all when its `recentGroup` is empty (mirrors today's behavior); the Active `Group` always mounts and supplies an `<li>` empty-state fixture.

### Implementation sketch

```tsx
const GroupHeader = ({
  label,
  headerAction = undefined,
}: GroupHeaderProps): ReactElement => (
  <div className="flex items-center justify-between pr-3">
    <h3
      data-testid={`session-group-${label.toLowerCase()}`}
      className="px-3 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-on-surface-variant/70"
    >
      {label}
    </h3>
    {headerAction}
  </div>
)

const GroupBody = (props: GroupProps): ReactElement => {
  // `emptyState` is optional on GroupProps; rest-destructure with explicit
  // default-undefined to match the project's `react/require-default-props`
  // convention even inside a body that pulls from `props`.
  const { sessions, variant, emptyState = undefined, children } = props
  const showEmpty = sessions.length === 0
  const items = showEmpty ? emptyState : children
  const containerClass =
    variant === 'active' ? 'flex flex-col px-2' : 'flex flex-col px-2 pb-1'
  const containerTestId = variant === 'active' ? 'session-list' : 'recent-list'

  if (variant === 'active') {
    return (
      <Reorder.Group
        axis="y"
        values={sessions}
        onReorder={props.onReorder}
        className={containerClass}
        data-testid={containerTestId}
      >
        {items}
      </Reorder.Group>
    )
  }

  return (
    <ul className={containerClass} data-testid={containerTestId}>
      {items}
    </ul>
  )
}

// Compound: `Group` is the body; `Group.Header` is the header.
export const Group = Object.assign(GroupBody, { Header: GroupHeader })
```

The `Object.assign` pattern is the standard React idiom for compound components (used by Radix, Headless UI, etc.). TypeScript types `Group.Header` correctly via inference from the assigned `GroupHeader` function.

### Test surface (`Group.test.tsx`)

Header tests:

- `<Group.Header label="Active" />` renders `<h3>` with text "Active" and `data-testid="session-group-active"`.
- `<Group.Header label="Recent" />` renders `data-testid="session-group-recent"`.
- `headerAction` ReactNode renders next to the `<h3>` when provided; absent slot renders nothing.

Body tests:

- Active variant: container has `data-testid="session-list"` and `flex flex-col px-2` class. Renders inside a `Reorder.Group` (assert via mock-friendly DOM assertion or framer-motion mock — see §List test surface).
- Recent variant: container is a `<ul>` with `data-testid="recent-list"` and `flex flex-col px-2 pb-1` class.
- Renders `children` when `sessions.length > 0`.
- Renders `emptyState` when `sessions.length === 0` and `emptyState` is provided; renders nothing in the items slot when both are absent.
- TypeScript: omitting `onReorder` for Active variant is a compile error (asserted via `// @ts-expect-error` smoke in the test file). _If the project has no type-tests setup today, this assertion can be skipped — TypeScript catches it at build._

### What `Group` does NOT do

- Does not render or import `Card` directly. `List` composes cards and passes them as children.
- Does not know about `activeSessionId` or per-card callbacks (`onClick` / `onRemove` / `onRename`). Those live on `Card`.
- Does not bridge cross-group reorder. `List` does the `mediateReorder(reorderedActive, recent)` concatenation before bubbling up.
- Does not own header placement. `List` decides whether `Group.Header` renders inside or outside the scroll region.

## Workspace session module — `List`

### File: `src/features/workspace/sessions/components/List.tsx`

`List` is the workspace orchestrator that owns:

- Active/recent split (filtered via `isOpenSessionStatus` from `workspace/utils/pickNextVisibleSessionId.ts`).
- The scroll element (`motion.div` with `layoutScroll`) — per the scroll-ownership decision in §"Sidebar API".
- Cross-group reorder mediation (the `recentGroupRef` pattern that bubbles up a full sessions array even when a session transitions mid-drag).
- Remove-flow handler (next-id selection + focus restoration on the new active row's overlay button).
- The Active group's header `+` action (calls `onNewInstance`).

`List` is the only `Sidebar.content` consumer in this PR. WorkspaceView mounts `<List ... />` inside the slot.

### Props

```ts
import type { Session } from '../../types'

export interface ListProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (id: string) => void
  onNewInstance?: () => void
  onRemoveSession?: (id: string) => void
  onRenameSession?: (id: string, name: string) => void
  onReorderSessions?: (sessions: Session[]) => void
}
```

These mirror the pre-refactor `Sidebar`'s session-related props verbatim, minus `agentStatus` (which moves to the chrome's `header` slot via `SidebarStatusHeader`) and `activeCwd` / `onFileSelect` (which move to the chrome's `bottomPane` slot via `FileExplorer`).

### Implementation sketch

```tsx
import { useRef } from 'react'
import type { ReactElement } from 'react'
import { motion } from 'framer-motion'
import { Group } from './Group'
import { Card } from './Card'
import {
  isOpenSessionStatus,
  pickNextVisibleSessionId,
} from '../../utils/pickNextVisibleSessionId'
import { mediateReorder } from '../utils/mediateReorder'
import type { Session } from '../../types'

export const List = ({
  sessions,
  activeSessionId,
  onSessionClick,
  onNewInstance = undefined,
  onRemoveSession = undefined,
  onRenameSession = undefined,
  onReorderSessions = undefined,
}: ListProps): ReactElement => {
  const activeGroup = sessions.filter((s) => isOpenSessionStatus(s.status))
  const recentGroup = sessions.filter((s) => !isOpenSessionStatus(s.status))

  // Mirror `recentGroup` synchronously every render so framer-motion's
  // `onReorder` closure reads current values rather than a stale capture.
  // See PR #174's drag-mid-transition note for the failure mode this
  // guards against.
  const recentGroupRef = useRef(recentGroup)
  recentGroupRef.current = recentGroup

  const handleRemoveSession = onRemoveSession
    ? (id: string): void => {
        const nextId =
          id === activeSessionId
            ? pickNextVisibleSessionId(sessions, id, activeSessionId)
            : undefined
        onRemoveSession(id)
        if (nextId !== undefined) {
          onSessionClick(nextId)
          queueMicrotask(() => {
            document.getElementById(`sidebar-activate-${nextId}`)?.focus()
          })
        }
      }
    : undefined

  const handleActiveReorder = (reordered: Session[]): void => {
    onReorderSessions?.(mediateReorder(reordered, recentGroupRef.current))
  }

  const headerAction = onNewInstance ? (
    <button
      type="button"
      onClick={onNewInstance}
      className="material-symbols-outlined text-base text-on-surface-variant/60 transition-colors hover:text-primary"
      aria-label="Add session"
      title="Add session"
    >
      add
    </button>
  ) : undefined

  const emptyActive = (
    <li
      data-testid="active-empty"
      className="px-3 py-3 text-center font-label text-xs text-on-surface-variant/50"
    >
      No active sessions
    </li>
  )

  // Active `Group.Header` renders OUTSIDE the scroll motion.div — mirrors
  // PR #174's behavior where the "ACTIVE" label stays put while the list
  // scrolls. Recent `Group.Header` (and its body) render INSIDE the
  // motion.div, also mirroring PR #174.
  return (
    <>
      <Group.Header label="Active" headerAction={headerAction} />

      <motion.div
        data-testid="session-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        layoutScroll
      >
        <Group
          variant="active"
          sessions={activeGroup}
          onReorder={handleActiveReorder}
          emptyState={emptyActive}
        >
          {activeGroup.map((session) => (
            <Card
              key={session.id}
              session={session}
              variant="active"
              isActive={session.id === activeSessionId}
              onClick={onSessionClick}
              onRemove={handleRemoveSession}
              onRename={onRenameSession}
            />
          ))}
        </Group>

        {recentGroup.length > 0 && (
          <>
            <Group.Header label="Recent" />
            <Group variant="recent" sessions={recentGroup}>
              {recentGroup.map((session) => (
                <Card
                  key={session.id}
                  session={session}
                  variant="recent"
                  isActive={session.id === activeSessionId}
                  onClick={onSessionClick}
                  onRemove={handleRemoveSession}
                  onRename={onRenameSession}
                />
              ))}
            </Group>
          </>
        )}
      </motion.div>
    </>
  )
}
```

`List`'s outer element is a fragment: the Active `Group.Header` and the scroll `motion.div` are both direct children of `Sidebar`'s content wrapper. Inside `Sidebar.tsx`, the content slot wrapper is `<div className="flex min-h-0 flex-1 flex-col">{content}</div>` — a flex column whose flex-1 + min-h-0 lets `motion.div` (with its own flex-1 + overflow-y-auto) take the remaining height after the Active `Group.Header` is laid out at intrinsic height.

### Why `List` owns `motion.div` + `layoutScroll`

- Generic `Sidebar` is framer-motion-free (Decision per §Sidebar API).
- `layoutScroll` is required for framer-motion to compute drag positions correctly when the parent scroll position changes (the cards inside the Active group use `Reorder.Item` with `layout="position"`; without `layoutScroll`, dragging while the list is scrolled produces stutter).
- Putting the wrapper on `List`'s outer element keeps drag behavior identical to PR #174 while moving the wrapper out of the chrome.

### Mid-drag transition invariant (why `mediateReorder` doesn't dedup)

A reasonable concern: if a session transitions `running → completed` while the user is mid-drag, could the bubbled array end up with duplicates or drops? The answer is no, given three properties that hold simultaneously:

1. **Framer-motion's `Reorder.Group.values` is reactive.** When the `values` prop changes (because `activeGroup` shrinks after a status transition removes the transitioning session), framer-motion reconciles immediately. The next `onReorder` it fires carries a permutation of the LATEST `values` — not a stale copy.
2. **`recentGroupRef.current` is mirrored synchronously every render.** The line `recentGroupRef.current = recentGroup` runs in `List`'s render body, before any commit. By the time framer-motion calls `onReorder` (always post-commit), `recentGroupRef.current` already reflects the post-transition `recentGroup`.
3. **Refs share identity across renders.** Even if framer-motion is holding a closure over an `onReorder` from a previous render, that closure reads `recentGroupRef.current` — and `current` is the live, just-mutated value. There is no stale capture.

Combine the three: `onReorder(reorderedActive)` always fires with `reorderedActive` ⊆ the post-transition `activeGroup`, and `recentGroupRef.current` is the post-transition `recentGroup`. Concatenation `[...reorderedActive, ...recentGroupRef.current]` produces the post-transition full sessions array. The transitioned session appears exactly once — in `recent` — never duplicated.

This is the algorithmic justification for `mediateReorder` being a pure 2-argument concatenation (no dedup, no filter). Adding a defensive dedup (e.g., by `session.id`) would mask a future bug where one of the three properties breaks; clarity and correctness are better served by making the invariant explicit and trusting it. The "Mid-drag transition guard" test in `List.test.tsx` exercises exactly the framer-motion-reactive-values + ref-mirror seam to keep the guarantee verified.

### Test surface (`List.test.tsx`) — integration tests

`List.test.tsx` carries the cross-component flow tests that don't fit at the leaf level:

- **Group split.** Running/paused sessions render in the Active group; completed/errored render in Recent. Both `data-testid="session-group-active"` and `session-group-recent` present when both groups non-empty.
- **Recent group hidden when empty.** When `recentGroup.length === 0`, `session-group-recent` is NOT rendered (matches today's behavior).
- **Active empty state.** When `activeGroup.length === 0`, the `<li data-testid="active-empty">No active sessions</li>` renders inside the active body container.
- **Active `Group.Header` is OUTSIDE the scroll wrapper.** Assert via DOM topology: `getByTestId('session-group-active')` is NOT a descendant of `getByTestId('session-scroll')`. Recent header (when present) IS a descendant. This is the regression-guard for the asymmetric placement contract.
- **Remove-active flow + focus restoration.** Clicking remove on the active session calls `onRemoveSession(id)` first, then `onSessionClick(nextId)`. `queueMicrotask` lands focus on `#sidebar-activate-${nextId}`. Test: render `List`, click remove on active, `await Promise.resolve()` to drain microtasks, assert `document.activeElement` is the next overlay button.
- **Header `+` button calls `onNewInstance`.** Click the "Add session" button → `onNewInstance` fires.
- **Header `+` button hidden when `onNewInstance` undefined.** Smoke check that the headerAction slot is empty.
- **Scroll wrapper.** `data-testid="session-scroll"` renders on the motion.div.
- **Mid-drag transition guard.** Render `List` with `active=[A, B]`, `recent=[]`. Capture (or extract via the `mediateReorder` seam) the value that would be passed to `onReorderSessions` if the active group's `onReorder` fires. Re-render `List` with `sessions` such that B has transitioned `running → completed` (so `active=[A]`, `recent=[B]`). Now invoke the previously-captured `onReorder([A])`. Assert `onReorderSessions` is called with `[A, B]` — recent reflects the post-transition value (read via `recentGroupRef.current`), NOT the closure's pre-transition `[]`. This regression-guards the synchronous-mirror pattern (`recentGroupRef.current = recentGroup` written every render) against stale-closure capture.

The cross-group reorder DATA TRANSFORMATION lives in `mediateReorder.test.ts` (pure function unit test — see §"Utility extractions"). `List.test.tsx` covers the WIRING between `Reorder.Group.onReorder` and `mediateReorder`/`onReorderSessions` — done as a smoke test that asserts `Reorder.Group` (or its mock) is rendered with the expected `values={activeGroup}` and that `handleActiveReorder` is bound. If a project-wide `framer-motion` mock is acceptable (replacing `Reorder.Group` with `<ul>` and `Reorder.Item` with `<li>` in tests), use it; otherwise this assertion can be reduced to a render smoke and trust the `mediateReorder` unit test for correctness.

Tests that DO NOT belong in `List.test.tsx`:

- Per-card rendering details (status dot, subtitle, state pill, line-delta) — covered in `Card.test.tsx`.
- Per-group structural details (Reorder.Group container, `<ul>` for recent, header label, header action slot) — covered in `Group.test.tsx`.
- Sidebar slot composition (slot wrappers, resize handle, `bottomPane` absence) — covered in `Sidebar.test.tsx`.
- The `mediateReorder` data transformation — covered in `sessions/utils/mediateReorder.test.ts`.

### Why no separate hook

`List` does not extract its `handleRemoveSession` + `recentGroupRef` + `handleActiveReorder` logic into a hook — they're all tightly coupled to `List`'s render output (DOM ids, callback shapes) and would not be reused. Keeping them as inline consts inside the component body matches the rest of the codebase's pattern (see `WorkspaceView.tsx` for the same convention). Unifying with `Tabs.handleClose` is explicit non-goal per §"Non-goals". The pure data transformation `mediateReorder` IS extracted, however — it has no DOM coupling and benefits from isolated unit-testing.

## Workspace session module — `Tabs` + `Tab`

### Files

- `src/features/workspace/sessions/components/Tabs.tsx` — strip orchestrator (was `src/features/workspace/components/SessionTabs.tsx`).
- `src/features/workspace/sessions/components/Tab.tsx` — per-tab leaf (extracted from `Tabs`).

### Why mirror the `Card` extraction

Today's `SessionTabs.tsx` is 279 lines, with the per-tab JSX (status dot + name + close-button + agent-accent top stripe) inlined in a `.map(...)` body. After PR #174's cycle 6, that JSX shares structural concerns with `Card`'s row markup — both render a status dot, a name, and a close button — but on a different shape (horizontal strip, narrower width, no rename). Pulling the per-tab markup into `Tab.tsx` keeps `Tabs.tsx` a thin orchestrator (visible-set computation, ARIA roving focus, close handler) and makes future per-tab visual changes a one-file touch.

### `Tab` props

```ts
import type { Session } from '../../types'
import type { Agent } from '../../../../agents/registry'

export interface TabProps {
  session: Session
  isActive: boolean
  /**
   * Drives `tabIndex=0` for the WAI-ARIA roving-focus entry point. Equal
   * to `isActive` in the steady state; differs only when `activeSessionId`
   * is null and we fall back to the first visible tab so the keyboard
   * still has a way into the tablist. Computed by `Tabs` (not derivable
   * from `isActive` alone).
   */
  isFocusEntryPoint: boolean
  agent: Agent // resolved by Tabs via agentForSession()
  onSelect: (id: string) => void
  onClose: (id: string) => void
}
```

`Tabs` resolves `agentForSession(session)` once per session in its render and passes `agent` down — keeping `Tab` free of utility imports and easier to test in isolation.

### `Tab` behavior contract

All preserved verbatim from the pre-refactor `SessionTab` (SessionTabs.tsx:142-279). Listed exhaustively here so the implementation has a precise checklist:

- **Outer element.** `<div role="tab" id={`session-tab-${session.id}`} data-testid="session-tab" data-session-id data-active>`. The id is consumed by `Tabs.handleClose` for focus restoration via `getElementById`.
- **`tabIndex`** = `isFocusEntryPoint ? 0 : -1`. WAI-ARIA roving focus: exactly one tab in the tablist is in the Tab order at any time.
- **`aria-selected`** = `isActive`.
- **`aria-controls`** = `` `session-panel-${session.id}` ``.
- **`aria-label`** = `session.name`, suffixed with `' (ended)'` when `session.status === 'completed' || session.status === 'errored'`. Without the suffix, keyboard-only users would hear the same label before and after the session exited and miss that the panel needs a Restart action.
- **Click handler.** Calls `onSelect(session.id)` ONLY when `!isActive`. The active-no-op guard avoids redundant `setActiveSession` IPC and prevents `useSessionManager`'s request-supersession rollback from interfering with a transient failure window.
- **Keyboard handler.** First, `if (e.target !== e.currentTarget) return` to ignore key events bubbled from focused descendants (the close button). Then (note: `e.key` for the spacebar is the single-character string `' '`, NOT `'Space'`):
  - `e.key === 'Enter' || e.key === ' '` → `e.preventDefault()`; same active-no-op guard, then `onSelect(session.id)`.
  - `e.key === 'Delete' || e.key === 'Backspace'` → `e.preventDefault()`; `onClose(session.id)`.
  - Arrow-key tab cycling intentionally NOT handled here (xterm.js holds focus inside the terminal; in-component arrow handlers never fire — see #177 for the global-keybinding follow-up).
- **Active accent stripe.** When `isActive`, render `<span aria-hidden className="absolute inset-x-1.5 top-0 h-0.5 rounded-b-sm" style={{ background: agent.accent }} />`. Top-edge stripe (NOT a left border).
- **Agent glyph.** `<span aria-hidden className="flex h-4 w-4 ... rounded font-mono text-[10px] font-bold" style={{ background: agent.accentDim, color: agent.accent }}>{agent.glyph}</span>`.
- **Name.** Truncated `<span className={..., isActive ? 'font-medium text-on-surface' : 'text-on-surface-variant'}>{session.name}</span>`.
- **StatusDot.** Rendered ONLY for `session.status === 'running' || session.status === 'paused'` (NOT for completed/errored — those tabs hide the live pip; restart parity is delivered via the panel's Restart UI and the `(ended)` aria-label suffix). Size 5, with `aria-label={`Status ${session.status}`}`.
- **Close button.** `<button type="button" tabIndex={-1} ...>`. WAI-ARIA tabs §3.27: the entire tablist is one Tab stop; interactive descendants are reached via shortcut, not Tab. `onClick` calls `e.stopPropagation()` then `onClose(session.id)`. `aria-label={`Close ${session.name}`}`.
- **Class branching.** Active: `-mb-px bg-surface border-outline-variant/30`. Inactive: `hover:bg-on-surface/[0.025]`. Focus: `focus-visible:ring-2 focus-visible:ring-primary/50`.

### Out of scope (deferred via follow-up issue)

- The `Delete` / `Backspace` close-on-focused-tab binding feels more naturally expressed as a global keyboard shortcut (cmd-palette-bound, like `Cmd+W`). Migrating this binding out of `Tab.tsx` and onto a global keymap is a behaviour change, not a refactor — out of scope for this PR. Tracked in #179; this spec preserves the current binding verbatim. _The implementation MUST add an inline comment in `Tab.tsx`'s keyboard handler referencing #179 so a future reader knows the binding is intentionally kept here pending migration._

### `Tabs` props (unchanged from current `SessionTabs`)

```ts
export interface TabsProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onNew: () => void
}
```

Internal logic preserved from `SessionTabs.tsx`:

- `getVisibleSessions(sessions, activeSessionId)` for the visible tab list.
- `hasFocusMatch` tie-breaker for the WAI-ARIA roving-focus invariant.
- `handleClose(id)` next-id selection + `getElementById('session-tab-${nextId}')?.focus()` focus restoration.
- The "+" new-tab button at the right end of the strip (calls `onNew`).

The only structural change is replacing the inline per-tab JSX with `<Tab session={s} isActive={...} isFocusEntryPoint={...} agent={...} onSelect={onSelect} onClose={handleClose} />`.

### Test redistribution within the strip

Today's `SessionTabs.test.tsx` covers a mix of strip orchestration and per-tab rendering. After the extraction:

- **`Tabs.test.tsx`** (orchestrator scope): visible-set rendering, ARIA roving focus tabIndex assignment, `handleClose` next-id + focus-restore, "+" button calls `onNew`, empty-visible-set behavior (the strip shell + "+" button render even when the tablist itself is empty — `SessionTabs` does not hide the strip). The current test file's tests in this category move with `Tabs.tsx`.
- **`Tab.test.tsx`** (leaf scope, NEW): per-tab markup — status dot conditional rendering (running/paused only), name + truncate, close button visibility, agent glyph + accent stripe, `aria-label` ended-suffix for completed/errored, `aria-selected` reflects `isActive`, `aria-controls` references the panel id, `tabIndex` follows `isFocusEntryPoint`, click + keyboard activation guards (active-no-op), Delete/Backspace close, descendant key-event suppression (`e.target !== e.currentTarget`), close-button `tabIndex={-1}`. New file populated either by extraction from `SessionTabs.test.tsx` or by writing fresh tests for the new component.

The migration plan (§"Migration plan") lists the redistribution as a single sub-step within step "Tabs co-location."

### What stays out of scope for this PR

- No change to `Tabs`'s ARIA / focus / visibility logic. Those stay verbatim.
- No unification with `List.handleRemoveSession`'s next-id logic (different focus targets — see Non-goal).
- The per-tab visual-cycle work (e.g. agent-accent color refresh) is a separate concern; this refactor preserves PR #174's per-tab look exactly.

## Workspace session utilities — extractions

Four small modules under `src/features/workspace/sessions/utils/`. Each is a pure value or function with no React or framer-motion imports. Co-located test files unit-test each in isolation.

### `statePill.ts`

Three lookup tables consumed by `Card` for the state-pill rendering. Extracted verbatim from the current `Sidebar.tsx`.

```ts
import type { Session } from '../../types'

export const STATE_PILL_LABEL: Record<Session['status'], string> = {
  running: 'running',
  paused: 'awaiting',
  completed: 'completed',
  errored: 'errored',
}

// Bright pills — Active group rows. Vivid bg + saturated text.
export const STATE_PILL_TONE: Record<Session['status'], string> = {
  running: 'text-success bg-success/10',
  paused: 'text-warning bg-warning/10',
  completed: 'text-success-muted bg-success-muted/10',
  errored: 'text-error bg-error/15',
}

// Dim pills — Recent group rows.
export const STATE_PILL_TONE_DIM: Record<Session['status'], string> = {
  running: 'text-success/70 bg-success/5',
  paused: 'text-warning/70 bg-warning/5',
  completed: 'text-success-muted/70 bg-success-muted/5',
  errored: 'text-error/80 bg-error/8',
}
```

Test surface (`statePill.test.ts`) — minimal: assert the three records have the expected keys (one per `SessionStatus`) and that the `errored` mapping carries the higher-saturation `bg-error/15` (regression guard against the cycle-5 dim-treatment getting reverted into Active by accident).

### `lineDelta.ts`

Pure tally over a session's file changes. Extracted verbatim; renamed from `sessionLineDelta` to `lineDelta` (per the naming convention).

```ts
import type { Session } from '../../types'

export const lineDelta = (
  session: Session
): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const change of session.activity.fileChanges) {
    added += change.linesAdded
    removed += change.linesRemoved
  }
  return { added, removed }
}
```

Test surface (`lineDelta.test.ts`):

- Empty `fileChanges` → `{ added: 0, removed: 0 }`.
- Single change with `linesAdded: 10`, `linesRemoved: 3` → `{ added: 10, removed: 3 }`.
- Multiple changes → sum.
- Negative values left as-is (no clamping; the data shape doesn't admit them, but document the unchecked behavior).

### `subtitle.ts`

Pure derivation of the row's secondary line: agent action when present, else the last 1–2 segments of the session's `workingDirectory`. Extracted verbatim; renamed `sessionSubtitle` → `subtitle`.

```ts
import type { Session } from '../../types'

export const subtitle = (session: Session): string => {
  if (session.currentAction !== undefined && session.currentAction !== '') {
    return session.currentAction
  }
  const normalized = session.workingDirectory.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) {
    return session.workingDirectory || '~'
  }
  if (parts.length === 1) {
    return parts[0]
  }
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}
```

Test surface (`subtitle.test.ts`) — port the three subtitle-related tests from today's `Sidebar.test.tsx` (lines 543, 569, 590):

- `currentAction` (non-empty) takes priority over the cwd derivation.
- Windows backslash path normalises correctly (`C:\Users\alice\repo` → `alice/repo`).
- POSIX shallow path returns parent/basename (`/home/will` → `home/will`).
- Empty `workingDirectory` falls back to `~` (race-window safety).

### `mediateReorder.ts`

Pure helper consumed by `List`'s `handleActiveReorder`. Concatenates a freshly reordered active subset with the (synchronously-mirrored) recent group to produce the full sessions array bubbled to `onReorderSessions`.

```ts
import type { Session } from '../../types'

export const mediateReorder = (
  reorderedActive: Session[],
  recent: Session[]
): Session[] => [...reorderedActive, ...recent]
```

Two-line implementation; the documentation value is the existence of a tested seam. Test surface (`mediateReorder.test.ts`):

- Empty active + empty recent → empty array.
- Reordered active preserves order in the prefix; recent unchanged in the suffix.
- Mid-transition guard (a session moved from active → recent between renders): mediator does NOT deduplicate. Document this as expected: `List` re-derives both groups every render, so the transitioning session appears in `recent` for the next render's call, not this one. The mediator is a pure concatenation; correctness across transitions depends on `List` mirroring `recent` synchronously via `recentGroupRef` (covered in `List.test.tsx`).

### Why these four together

All four are pure value-or-function modules with co-located unit tests, tiny enough that one section covers them. They share the "no React, no framer-motion, depends only on `Session` (and friends)" discipline — making them safe to extract first in the migration plan (§"Migration plan") before any component restructuring touches the source file.

## Test redistribution map

Two source test files redistribute across leaf + integration files. This section enumerates every test, its destination, and the rationale.

### From `Sidebar.test.tsx` (25 tests)

| #   | Test (today)                                                                     | Destination                                   | Notes                                                                                                                                              |
| --- | -------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | renders with full width (sized by parent grid)                                   | `Sidebar.test.tsx`                            | Slot composition smoke. Replace `getByTestId('sidebar')` → assertion on the new `data-testid="sidebar"` div.                                       |
| 2   | renders the sidebar status header in the top slot                                | `Sidebar.test.tsx`                            | Becomes "renders `header` slot fixture." Use `<div data-testid="header-fixture" />` rather than importing `SidebarStatusHeader`.                   |
| 3   | renders "Active" group header with add button                                    | `List.test.tsx`                               | Asserts `getByTestId('session-group-active')` and `getByRole('button', { name: 'Add session' })`.                                                  |
| 4   | renders "Recent" group header when completed/errored sessions exist              | `List.test.tsx`                               | Conditional Recent rendering.                                                                                                                      |
| 5   | add session button changes color on hover                                        | `List.test.tsx`                               | Header-action button styling assertion.                                                                                                            |
| 6   | calls onNewInstance when add session button is clicked                           | `List.test.tsx`                               | Header `+` plumbing.                                                                                                                               |
| 7   | renders running/paused in Active list, completed in Recent                       | `List.test.tsx`                               | Group-split correctness.                                                                                                                           |
| 8   | each session row carries a StatusDot reflecting its status                       | `Card.test.tsx`                               | Per-variant: Active uses default-size dot, Recent uses size-6 dim.                                                                                 |
| 9   | active row paints lavender-tinted background per handoff §4.2                    | `Card.test.tsx`                               | Active-variant styling.                                                                                                                            |
| 10  | inactive session items have on-surface-variant styling                           | `Card.test.tsx`                               | Inactive-variant styling.                                                                                                                          |
| 11  | calls onSessionClick with session id when session is clicked                     | `Card.test.tsx`                               | Click plumbing on the activation overlay button.                                                                                                   |
| 12  | uses design tokens for colors                                                    | `Card.test.tsx`                               | Token-class smoke.                                                                                                                                 |
| 13  | renders empty state when no active sessions                                      | `List.test.tsx`                               | Active empty-state `<li data-testid="active-empty">`.                                                                                              |
| 14  | renders FileExplorer section                                                     | DELETE (obsolete)                             | Sidebar no longer mounts FileExplorer; WorkspaceView does (via `bottomPane` slot). Slot smoke covered by test #1+#2 pattern in `Sidebar.test.tsx`. |
| 15  | renders "New Instance" button at bottom                                          | `Sidebar.test.tsx` + `WorkspaceView.test.tsx` | `Sidebar.test.tsx` asserts `footer` slot fixture renders. WorkspaceView test asserts the gradient button is mounted in `Sidebar.footer`.           |
| 16  | "New Instance" button has bolt icon                                              | `WorkspaceView.test.tsx` (or DELETE)          | The button is now inline JSX in WorkspaceView. Could move to a smoke test there or be deleted as low-value.                                        |
| 17  | calls onNewInstance when "New Instance" button is clicked                        | `WorkspaceView.test.tsx`                      | Click → `createSession` plumbing in the inline footer button.                                                                                      |
| 18  | "New Instance" button has shadow effects                                         | DELETE (obsolete)                             | Visual-class smoke; not load-bearing. Style assertions on inline JSX add little value.                                                             |
| 19  | handles null activeSessionId gracefully                                          | `List.test.tsx`                               | Null guard in the composer.                                                                                                                        |
| 20  | removing the active session pre-selects the next visible Active row              | `List.test.tsx`                               | The remove-flow + focus-restore integration test.                                                                                                  |
| 21  | without onRemoveSession, the remove button is hidden on Recent rows              | `Card.test.tsx`                               | Callback-driven hover-action visibility (variant-agnostic).                                                                                        |
| 22  | Active + Recent groups share a single scroll region                              | `List.test.tsx`                               | Scroll-wrapper invariant. Renamed: "Active group's body + Recent group share the `session-scroll` motion.div; Active `Group.Header` is OUTSIDE."   |
| 23  | subtitle renders the last 2 segments of the cwd, normalizing Windows backslashes | `subtitle.test.ts`                            | Pure-utility unit test.                                                                                                                            |
| 24  | subtitle renders 2-segment POSIX cwd as parent/basename                          | `subtitle.test.ts`                            | Same.                                                                                                                                              |
| 25  | subtitle falls back to "~" when workingDirectory is empty                        | `subtitle.test.ts`                            | Same.                                                                                                                                              |

Net: 25 tests → 0 stay in old location, ~3 deleted as obsolete, ~3 move to WorkspaceView, ~9 to `List.test.tsx`, ~6 to `Card.test.tsx`, 3 to `subtitle.test.ts`, 4 to new `Sidebar.test.tsx`.

### New tests added (per the spec)

| New test                                                                                                                                                                                                  | Lives in                       | Source section |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------- |
| `bottomPane` absent: resize handle + bottom region not rendered; `content` flexes                                                                                                                         | `Sidebar.test.tsx`             | §3 Sidebar API |
| Slot wrapper: `header` / `footer` slots render their wrappers when prop is non-`null`/`undefined`/`false`; explicitly NOT suppressed for `0` or `''` (matches the slot-absence semantics in §Sidebar API) | `Sidebar.test.tsx`             | §3 Sidebar API |
| `useResizable` initial-clamp regression (initial > max → clamps; initial < min → clamps)                                                                                                                  | `useResizable.test.ts` (moved) | §3 Sidebar API |
| Active `Group.Header` rendered OUTSIDE `session-scroll`; Recent `Group.Header` INSIDE                                                                                                                     | `List.test.tsx`                | §6 List        |
| Single-click on title `<span>` activates the row (regression guard for `pointer-events-auto`)                                                                                                             | `Card.test.tsx`                | §4 Card        |
| `mediateReorder([a,b], [c]) === [a,b,c]`; empty inputs degenerate                                                                                                                                         | `mediateReorder.test.ts`       | §8 Utilities   |
| `Group.Header` renders label + headerAction; `Group` body renders children or emptyState                                                                                                                  | `Group.test.tsx`               | §5 Group       |
| `Card` rename input: Enter commits, Escape cancels, Blur commits (NEW — no rename tests exist in `Sidebar.test.tsx` today; this is fresh coverage on the extracted component)                             | `Card.test.tsx`                | §4 Card        |

### From `SessionTabs.test.tsx` (31 tests)

The strip's tests split per the orchestrator-vs-leaf line. Tests targeting the strip wrapper, visibility filter, ARIA tablist semantics, and `handleClose` go to `Tabs.test.tsx`. Tests targeting per-tab markup, ARIA per-tab attributes, keyboard handlers, click guards, and visual stripes go to `Tab.test.tsx`.

| Test (today)                                                                            | Destination                                                                                                                         |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| renders the strip at 38px tall per handoff §4.3                                         | `Tabs.test.tsx`                                                                                                                     |
| exposes a tablist for assistive navigation                                              | `Tabs.test.tsx`                                                                                                                     |
| each tab carries aria-controls + id pointing at its TerminalZone panel                  | `Tab.test.tsx`                                                                                                                      |
| tab has explicit aria-label so descendant labels do not pollute its name                | `Tab.test.tsx`                                                                                                                      |
| exited active tab appends "(ended)" to the accessible name                              | `Tab.test.tsx`                                                                                                                      |
| tablist owns ONLY tab children (WAI-ARIA §3.27)                                         | `Tabs.test.tsx`                                                                                                                     |
| renders one tab per open session (running + paused)                                     | `Tabs.test.tsx`                                                                                                                     |
| marks the active tab with aria-selected and the lift offset                             | `Tab.test.tsx`                                                                                                                      |
| active tab paints the agent accent stripe along the top                                 | `Tab.test.tsx`                                                                                                                      |
| clicking a tab calls onSelect with the session id                                       | `Tab.test.tsx`                                                                                                                      |
| close button calls onClose without selecting the tab                                    | `Tab.test.tsx`                                                                                                                      |
| + button calls onNew                                                                    | `Tabs.test.tsx`                                                                                                                     |
| keyboard activation: Enter/Space on a focused tab calls onSelect                        | `Tab.test.tsx`                                                                                                                      |
| clicking the already-active tab does NOT call onSelect (active-no-op guard)             | `Tab.test.tsx`                                                                                                                      |
| only the active tab carries tabIndex=0 (roving focus)                                   | `Tabs.test.tsx`                                                                                                                     |
| null activeSessionId falls back to the first visible tab                                | `Tabs.test.tsx`                                                                                                                     |
| stale (non-null) activeSessionId after flushSync removeSession also falls back to first | `Tabs.test.tsx`                                                                                                                     |
| close buttons are always tabIndex=-1                                                    | `Tab.test.tsx`                                                                                                                      |
| Delete on the focused tab calls onClose                                                 | `Tab.test.tsx`                                                                                                                      |
| Backspace on the focused tab also calls onClose                                         | `Tab.test.tsx`                                                                                                                      |
| renders a status pip alongside the running session title                                | `Tab.test.tsx`                                                                                                                      |
| agent glyph chip shows the registry glyph (claude → ∴)                                  | `Tab.test.tsx`                                                                                                                      |
| falls back to shell glyph for unknown agent types                                       | `agentForSession.test.ts` (the helper that resolves the fallback; `Tab` receives a resolved `agent` prop and never runs the lookup) |
| with no open sessions and no active id, only the + button renders                       | `Tabs.test.tsx`                                                                                                                     |
| keyboard close moves DOM focus to the new active tab (WAI-ARIA §4.4.3)                  | `Tabs.test.tsx`                                                                                                                     |
| closing the active tab pre-selects the next VISIBLE tab                                 | `Tabs.test.tsx`                                                                                                                     |
| closing an inactive tab does NOT change selection                                       | `Tabs.test.tsx`                                                                                                                     |
| keeps the active session in the strip even after its PTY exits                          | `Tabs.test.tsx`                                                                                                                     |
| ArrowLeft / ArrowRight do nothing inside a focused tab                                  | `Tab.test.tsx`                                                                                                                      |
| Enter on a focused inactive tab activates it (manual activation)                        | `Tab.test.tsx`                                                                                                                      |
| Enter on a focused close button closes that tab without re-selecting                    | `Tab.test.tsx`                                                                                                                      |

All 31 tests are enumerated above.

Net: 31 tests → roughly 16 to `Tab.test.tsx`, ~15 to `Tabs.test.tsx`. None deleted.

### Test count summary (approximate)

| File                                                           | Test count after refactor                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/components/sidebar/Sidebar.test.tsx`                      | ~6 (slot composition + bottomPane absence + slot wrapper conditionals) |
| `src/features/workspace/sessions/components/Card.test.tsx`     | ~10 (variant matrix + rename + activation)                             |
| `src/features/workspace/sessions/components/Group.test.tsx`    | ~6 (Group.Header + body variants + empty state)                        |
| `src/features/workspace/sessions/components/List.test.tsx`     | ~9 (group split + remove flow + scroll wrapper invariant + header `+`) |
| `src/features/workspace/sessions/components/Tabs.test.tsx`     | ~15 (orchestrator scope from SessionTabs.test.tsx)                     |
| `src/features/workspace/sessions/components/Tab.test.tsx`      | ~16 (leaf scope from SessionTabs.test.tsx)                             |
| `src/features/workspace/sessions/utils/statePill.test.ts`      | 2                                                                      |
| `src/features/workspace/sessions/utils/lineDelta.test.ts`      | 4                                                                      |
| `src/features/workspace/sessions/utils/subtitle.test.ts`       | 4 (3 ported + 1 new)                                                   |
| `src/features/workspace/sessions/utils/mediateReorder.test.ts` | 3                                                                      |
| `src/hooks/useResizable.test.ts`                               | existing + 2 new clamp tests                                           |
| `src/features/workspace/WorkspaceView.test.tsx`                | existing + ~2 new (New Instance button click)                          |

Net: 25 + 31 = 56 source tests → ~75 destination tests (split + new tests required by the spec). Several of the new tests are tiny smokes (single-line assertions); the absolute count growth doesn't reflect proportional code growth.

## Migration plan

The refactor lands as one PR with a sequence of clean, individually-passing commits. Each commit keeps the test suite green at HEAD; type-check and lint pass; the visible app is unchanged at every step. The order follows the dependency graph — pure utilities first, then leaves, then composers, then chrome promotion.

### Commit order

1. **`refactor(sessions/utils): extract pure utilities`**
   - Add `src/features/workspace/sessions/utils/{statePill,lineDelta,subtitle,mediateReorder}.ts` + tests.
   - Old `Sidebar.tsx` still uses its inline definitions; the new utils exist but are unused.
   - DoD: 4 utility files exist with co-located tests; `npm run test` passes; no consumer changes yet.

2. **`refactor(hooks): promote useResizable to src/hooks`**
   - Move `useResizable.ts` + `useResizable.test.ts` from `features/workspace/hooks/` to `src/hooks/`.
   - Add the `initial` clamp fix + 2 regression tests.
   - Bump consumer import paths: `WorkspaceView.tsx`, `BottomDrawer.tsx`.
   - Bump test mock paths: `WorkspaceView.command-palette.test.tsx` (both `vi.mock` AND `await import` sites).
   - DoD: `npm run test` + `npm run type-check` pass; `useResizable` is reachable from both `src/components/` (future) and `src/features/`.

3. **`refactor(sessions): extract Card component`**
   - Add `sessions/components/Card.tsx` with the variant matrix (single component, `variant: 'active' | 'recent'`).
   - Add `sessions/components/Card.test.tsx` with the per-variant test matrix.
   - Replace inline `SessionRow` + `RecentSessionRow` in `Sidebar.tsx` with `<Card variant=... />`.
   - DoD: `Sidebar.test.tsx` still passes (no behavior change); `Card.test.tsx` passes.

4. **`refactor(sessions): extract Group compound component`**
   - Add `sessions/components/Group.tsx` exporting compound `Group` (body) + `Group.Header`.
   - Add `sessions/components/Group.test.tsx`.
   - Replace inline `GroupHeader` + `Reorder.Group`/`<ul>` containers in `Sidebar.tsx` with `Group.Header` + `<Group variant=...>...</Group>`. Active `Group.Header` stays outside the scroll motion.div; Recent stays inside (mirrors current behavior).
   - DoD: `Sidebar.test.tsx` still passes; `Group.test.tsx` passes.

5. **`refactor(sessions): extract List composer`**
   - Add `sessions/components/List.tsx` taking the session-related props that Sidebar took today.
   - Move active/recent split, `recentGroupRef`, `handleRemoveSession`, `handleActiveReorder`, `headerAction`, and `emptyActive` from `Sidebar.tsx` into `List.tsx`.
   - Move the `motion.div` + `layoutScroll` wrapper from `Sidebar.tsx` into `List.tsx`.
   - Add `sessions/components/List.test.tsx` with the integration tests (group split, recent-empty hidden, active-empty rendered, remove-flow + focus-restore, scroll-wrapper invariant, header-`+` plumbing).
   - In `Sidebar.tsx` (still at its old `features/workspace/components/` path), replace the now-extracted JSX with a single `<List ... />` wired to the same props the workspace passes.
   - Migrate the corresponding tests from `Sidebar.test.tsx` to `List.test.tsx` per the redistribution map.
   - DoD: `Sidebar.test.tsx` (still at old path) shrinks to chrome-shell tests (header wrapper, scroll boundary, FileExplorer mount, New Instance footer) — slot-composition tests are NOT added here; `List.test.tsx` carries the integration tests; all green.

6. **`refactor(sidebar): promote Sidebar to src/components/sidebar`**
   - Add `src/components/sidebar/Sidebar.tsx` as the new content-agnostic, named-slot chrome.
   - Add `src/components/sidebar/Sidebar.test.tsx` with the slot-composition + bottomPane-absence + slot-wrapper-conditional tests (plain `ReactNode` fixtures only — no `SidebarStatusHeader` import).
   - Update `WorkspaceView.tsx`:
     - Import the new `Sidebar` from `../../components/sidebar/Sidebar`.
     - Import `SidebarStatusHeader`, `FileExplorer`, and `List` directly.
     - Pass 4 slots: `header={<SidebarStatusHeader ... />}`, `content={<List ... />}`, `bottomPane={<FileExplorer cwd={activeSession?.workingDirectory ?? '~'} ... />}`, `footer={<button>...New Instance...</button>}`.
   - Update mock paths in `WorkspaceView.command-palette.test.tsx` and `WorkspaceView.subscription.test.tsx` (both string paths AND the subscription test's assertion cleanup per the move-table notes).
   - Delete `src/features/workspace/components/Sidebar.tsx` and `src/features/workspace/components/Sidebar.test.tsx`.
   - DoD: `npm run test`, `npm run lint`, `npm run type-check` pass; the running app is visually and behaviorally unchanged from PR #174.

7. **`refactor(sessions): co-locate session-tab strip + extract Tab leaf`**
   - Move `SessionTabs.tsx` → `sessions/components/Tabs.tsx`. Rename the exported component from `SessionTabs` to `Tabs`.
   - Extract the inline per-tab JSX into a new `sessions/components/Tab.tsx` exporting `Tab` (props + behavior contract per §"Tabs + Tab co-location").
   - Move `SessionTabs.test.tsx` → `sessions/components/Tabs.test.tsx`. Add new `sessions/components/Tab.test.tsx`. Redistribute tests per the map.
   - Add an inline comment in `Tab.tsx`'s `onKeyDown` referencing #179 next to the Delete/Backspace branch.
   - Update `WorkspaceView.tsx` import: `./components/SessionTabs` → `./sessions/components/Tabs`. Update the JSX usage from `<SessionTabs ...>` → `<Tabs ...>`.
   - DoD: all checks pass; `npm run test` still green; the strip renders identically.

### Why this order

- **Pure utilities first** (commit 1) so subsequent commits can reference them without each having to introduce its own utility extraction. Zero behavior change.
- **`useResizable` promotion early** (commit 2) so the Sidebar promotion (commit 6) can use the shared path immediately. Done before component restructure.
- **Card → Group → List** (commits 3-5) follows the leaf-up dependency: `Card` is referenced by `Group` (well, by `List` passing children — but the test files make the dependency clear). Writing Card and its tests first means later commits can lean on the verified Card API.
- **Sidebar promotion** (commit 6) is intentionally late: by this point, `List` exists and is tested, so the chrome can become content-agnostic without leaving session logic stranded.
- **Tabs co-location last** (commit 7) is independent of the sidebar tree but lives in the same `sessions/` subtree; doing it last avoids interleaving its diff with the sidebar restructuring (cleaner per-commit review).

### Commit-by-commit verification gate

Every commit MUST pass these locally before being included in the PR:

```
npm run lint
npm run type-check
npm run test
```

The pre-push hook already enforces `vitest run` (per `CLAUDE.md` §Git Hooks); the lint + type-check additions are owner discipline.

### What this PR does NOT include

- Visual-cycle changes (token tweaks, accent refresh, etc.).
- Any new feature or behavior change beyond what PR #174 already shipped.
- The #179 keyboard-shortcut migration.
- The #175 SESSIONS / FILES / CONTEXT switcher.

## Acceptance criteria + verification

### Acceptance criteria

The PR is mergeable when ALL of the following hold:

**Structural**

- [ ] `src/components/sidebar/Sidebar.tsx` exists and exports a content-agnostic component matching the §"Sidebar API" prop contract (named slots: `header`, `content`, `bottomPane`, `footer`).
- [ ] `src/components/sidebar/Sidebar.tsx` does NOT import any module under `src/features/`, nor any framer-motion symbol.
- [ ] `src/features/workspace/sessions/` exists with the file layout in §"File layout" — `components/{Card,Group,List,Tab,Tabs}.tsx` + co-located `*.test.tsx` siblings; `utils/{statePill,lineDelta,subtitle,mediateReorder}.ts` + co-located `*.test.ts` siblings.
- [ ] `src/features/workspace/components/Sidebar.tsx`, `Sidebar.test.tsx`, `SessionTabs.tsx`, `SessionTabs.test.tsx` are deleted (the old paths).
- [ ] `src/hooks/useResizable.ts` + test exists at the new path; `src/features/workspace/hooks/useResizable.ts` is deleted.
- [ ] All file names + exported symbols inside `sessions/` follow the "no `Session` prefix duplication" naming rule (Decision #7).

**Behavioral (no regression vs PR #174)**

- [ ] The running app renders the sidebar identically to PR #174 — by visual inspection at `npm run dev` (chrome region: bg, padding; status header: text + status; Active group: header + add button position + cards; Recent group: dim cards; FileExplorer: scroll + height + drag handle; New Instance gradient button).
- [ ] Active `Group.Header` stays OUTSIDE the scroll region (does not scroll out of view when Active list overflows). Recent `Group.Header` STAYS INSIDE the scroll region (scrolls with its body).
- [ ] Drag-reorder of Active sessions works; reordered ordering bubbles up via `onReorderSessions`. A session that transitions from running → completed mid-drag does not strand state.
- [ ] Remove-active-session flow: closing the active session pre-selects the next visible Active row; DOM focus lands on `#sidebar-activate-${nextId}`.
- [ ] Single-clicking the title `<span>` in a card activates the row (regression guard for the `pointer-events-auto` interception path).
- [ ] Session-tab strip (`Tabs`) renders identically to PR #174 — top-edge agent accent stripe, glyph chip, ARIA labels (with `(ended)` suffix for completed/errored), Delete/Backspace close, click guard, etc.
- [ ] FileExplorer mounts inside `Sidebar.bottomPane` with `cwd={activeSession?.workingDirectory ?? '~'}` — the `'~'` fallback preserved.

**Tests + tooling**

- [ ] `npm run lint` passes (zero warnings, zero errors) on the final commit AND on every intermediate commit.
- [ ] `npm run type-check` passes on every commit.
- [ ] `npm run test` (Vitest) passes; all 25+31 pre-existing tests have a destination per the redistribution map.
- [ ] The pre-push hook (which runs `npm test`, defined as `vitest --passWithNoTests`) passes.
- [ ] Test count summary matches §"Test count summary" within ±2 (small drift OK; large drift means a test got dropped silently).
- [ ] No `console.log` in committed code (`no-console: error` per `eslint.config.js`).
- [ ] No `any` types added to public APIs in the new modules.

**Codex-review trail**

- [ ] This spec carries the codex-reviewed footer (added by `lifeline:planner`'s end-of-spec pass — see Step 8 of the planner skill).

### Verification commands

```bash
# Pre-push gate (every commit):
npm run lint
npm run type-check
npm run test

# Full pre-PR gate:
npm run format:check
npm run review                  # Local Codex code review on the diff (optional but recommended)

# Visual regression (manual):
npm run dev                     # Start Vite dev server
# - Click through: open multiple sessions, drag-reorder Active list, transition some sessions to completed, verify Recent group renders, click + button, click New Instance gradient, drag the explorer split handle, scroll the session list with the explorer minimised.
# - Compare against a PR #174 build via a separate worktree (does NOT touch HEAD's src):
#       git worktree add ../vimeflow-pr174 ab1b888
#       (cd ../vimeflow-pr174 && npm install && npm run dev -- --port 5174)
#       # ...compare side-by-side with HEAD's `npm run dev` on default port
#       git worktree remove ../vimeflow-pr174   # when done
#   Do NOT use `git checkout ab1b888 -- src` — it overwrites HEAD's working tree.
```

### What "no visual regression" means precisely

For this PR, "no visual regression" means: a user opening the app at HEAD-of-PR sees the same chrome, the same session-list layout (Active above Recent, both groups-styled identically), the same color tones (bright Active pills, dim Recent pills), the same hover affordances, the same drag behavior, and the same keyboard accessibility as in PR #174's `feat(ui): step 3 — sidebar sessions list + browser-style session tabs` build.

It does NOT mean character-for-character DOM equivalence — `Card` introduces a single component where `SessionRow` + `RecentSessionRow` were two; some test selectors (e.g., `data-testid="session-row"` vs `recent-session-row`) survive verbatim per the variant matrix; framer-motion may produce slightly different intermediate render tree shapes. Visual + behavior parity is the binding contract; DOM shape parity is not.

### Codex review of this spec

The end-of-spec codex pass (Step 8 of the `lifeline:planner` skill) MUST run after the last per-section iteration and any findings handled per the per-finding apply mode the user picked. Findings deferred during per-section passes (none recorded as of this draft, but check `.lifeline-planner/deferrals.md`) get re-raised by the whole-spec pass; deferred items survive only if explicitly tracked via a follow-up issue.

## Out of scope (deferred to follow-ups)

This spec is a structural refactor with zero behavior change beyond preserving PR #174 verbatim. The items below are explicitly NOT addressed here; each links to its own issue (or notes that one should be filed if it doesn't already exist).

### Tracked follow-ups

| Issue | Title (paraphrased)                                                      | Relationship to this PR                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #175  | SESSIONS / FILES / CONTEXT three-tab switcher in the sidebar             | The new named-slot Sidebar API is designed so #175 can swap the `content` slot without touching `Sidebar.tsx`.                                                                                                         |
| #176  | Double scrollbar in the FileExplorer area                                | Independent — affects the FileExplorer that this PR moves into the `bottomPane` slot but does not modify.                                                                                                              |
| #177  | Global keybinding for session-tab cycling (Cmd+Shift+]/[)                | Independent — covers the arrow-key cycling stub mentioned in `Tabs.tsx`.                                                                                                                                               |
| #179  | Migrate Tab Delete/Backspace close binding to a global keyboard shortcut | Filed during this spec's clarifying-question pass. `Tab.tsx` preserves the current binding and adds an inline comment referencing #179.                                                                                |
| #180  | Keyboard adjustment for the explorer split-resize separator (a11y)       | Filed during this spec's whole-spec codex review. Pre-existing gap inherited from PR #174; the new `Sidebar` preserves it verbatim. `useResizable.adjustBy(±step)` is already exposed for the eventual implementation. |

### Items deliberately NOT in this PR (no follow-up needed yet)

- **Hoisting `handleRemoveSession` next-id-and-focus into a shared hook** — `List.handleRemoveSession` and `Tabs.handleClose` both compute next-id + restore focus, but their focus targets differ (`#sidebar-activate-${id}` vs `#session-tab-${id}`). The unification is non-trivial and not load-bearing for #178. If a third consumer with similar logic appears, file an issue then.
- **Promoting `IconRail` to `src/components/`** — issue #178 explicitly defers this to a separate refactor: "for this refactor, focus on Sidebar."
- **Visual-cycle changes** — token tweaks, accent refresh, hover state polish, etc. The handoff migration roadmap (`docs/roadmap/ui-update-roadmap.md`, if it tracks this) carries the visual evolution; this PR preserves PR #174's visuals exactly.
- **`SidebarStatusHeader` decomposition** — the status header has its own design spec (`docs/superpowers/specs/2026-04-30-sidebar-status-header-design.md`). Its internal structure is out of scope here; it's mounted as a black-box ReactNode in `Sidebar.header`.
- **Test-level changes to `WorkspaceView.integration.test.tsx`** beyond the mock-path bumps mandated by the move tables. Integration tests for the new slot wiring are scoped to the listed test files; broader integration-test rework is a separate concern.

### Forward-compat hooks the spec leaves intact

- **`Sidebar.bottomPane?` as `ReactNode`** — supports any future bottom region (settings panel, search palette stub, etc.) without an API change.
- **`Group.Header` as a separate compound part** — supports future "filter / search" affordances inside the header row of any group.
- **`Card` `variant` prop as a string union** — adding a third variant (e.g., `'archived'`) is a one-string-union edit + a column in the variant matrix. The wrapping-element conditional (currently `if variant === 'active'`) becomes a switch.
- **`mediateReorder` as a 2-arg pure helper** — adding a third group (e.g., a future "pinned" group) extends the signature but doesn't change the call site beyond passing the new group.

## Glossary

- **Active group** — sessions whose status is `running` or `paused` (the canonical `isOpenSessionStatus` predicate).
- **Recent group** — the complement: `completed`, `errored`, plus any future non-open status.
- **Slot (in `Sidebar`)** — a named prop carrying `ReactNode` content that the chrome wraps in its own layout primitive (header padding, footer padding, scroll-eligible content region, resizable bottom pane).
- **Compound component** — a React pattern where a parent component carries static sub-components as properties (e.g., `Group.Header`). Used here to keep the header and body of a group as separate JSX siblings while sharing a module + import statement.
- **`recentGroupRef` mirror pattern** — the synchronous ref-write inside `List`'s render body that lets framer-motion's `onReorder` closure read the current `recentGroup` rather than a stale capture from a prior render.
- **Activation overlay button** — the absolute-positioned `<button>` that covers each card; clicking anywhere on the card (except the rename input or hover actions) routes through this button. Solves the HTML-validity problem of nesting an `<input>` inside a `<button>`.

<!-- codex-reviewed: 2026-05-07T10:15:02Z -->
