---
title: Sidebar Top-Tab Switcher (SESSIONS / FILES) — Handoff §4.2
date: 2026-05-08
status: draft
owners: [winoooops]
related:
  - GitHub issue #175
  - docs/design/handoff/README.md §4.2 (sidebar tabs row + per-tab content)
  - docs/design/handoff/README.md §4.1 (icon rail — referenced for the active-state visual pattern only; rail integration is out of scope per project memory `project_iconrail_pending_design_pass`)
  - docs/design/UNIFIED.md §4.3 (Sessions tab grouping — Active vs Recent)
  - docs/superpowers/specs/2026-05-06-sidebar-refactor-design.md (#178 — promoted Sidebar to a global slot-based primitive)
  - src/components/sidebar/Sidebar.tsx (slot-based primitive: header / content / bottomPane / footer)
  - src/features/workspace/WorkspaceView.tsx (current Sidebar wiring)
---

# Sidebar Top-Tab Switcher (SESSIONS / FILES) — Handoff §4.2

## Context

After PRs #174, #178, and #184 the sidebar renders four slots simultaneously, every render:

- `header` → `SidebarStatusHeader` — agent activity card, or "No session" idle placeholder.
- `content` → `<List>` from `src/features/sessions/components/List.tsx` — Active + Recent groupings, per-row Card with state pill / line delta / rename.
- `bottomPane` → `<FileExplorer>` from `src/features/workspace/components/panels/FileExplorer.tsx` — Tauri-backed file tree, separated from `content` by a horizontal resize handle.
- `footer` → "+ New Instance" gradient lavender→purple button bound to `createSession`.

Handoff §4.2 specifies a different shape: a **top tabs row** (`SESSIONS / FILES / CONTEXT`) directly under the brand header, then the active tab's content fills the remaining sidebar height. There is no permanent file explorer below the sessions list — the file tree is what you see when you click `FILES`.

This spec closes the gap for two of the three tabs (SESSIONS, FILES). CONTEXT and the brand header are deferred (see §3 — Non-goals).

## Goals

1. **Add a `SidebarTabs` component** rendering the §4.2 tabs row — 11 px JetBrains Mono uppercase labels, `#cba6f7` active / `#6c7086` inactive, with a left-accent bar on the active tab (same `2px` lavender accent pattern §4.1 uses for the icon rail's active item).
2. **Add a `useSidebarTab` hook** (`src/hooks/useSidebarTab.ts`, peer to `useResizable`) owning the active-tab state. v1 is `useState`-backed only; localStorage persistence and IconRail integration land later by extending this hook in place.
3. **Wire two tab views inside the existing `content` slot** of the Sidebar primitive (Approach B in brainstorming):
   - `SessionsView` — the existing `<List>` plus the "+ New Instance" button (which moves out of `Sidebar.footer` into the SESSIONS view body).
   - `FilesView` — the existing `<FileExplorer>` lifted out of `Sidebar.bottomPane`.
4. **Preserve cross-tab state across pure tab switches** (no session change in between) by mounting both views and toggling visibility via the HTML `hidden` attribute, NOT by conditional render. A user navigating three folders deep in `FilesView` keeps that path when they bounce SESSIONS↔FILES without switching the active session. `useFileTree` does not re-fetch from Tauri on a pure tab switch. Note: `useFileTree(externalCwd)` already resets `currentPath` whenever `externalCwd` changes. Because both views are mounted, switching the active session in SESSIONS view bubbles a new `workingDirectory` through to `FilesView`'s `useFileTree` immediately and the reset effect fires _while `FilesView` is still hidden_ — the user observes the reset state on their next FILES tab visit. That behavior is pre-existing and intentionally not modified by this PR (see Future work for an optional lift).
5. **No agent/session functional regression** vs the cycle-6 sidebar that ships post-#184 — session lifecycle, agent observability, and file selection all behave identically. The PR DOES introduce **scoped UI/layout changes** (the things below) which are intentional, not regressions: a new tabs row at the top of the content slot, the file explorer is no longer permanently visible (it lives behind the FILES tab), the bottom-pane resize handle disappears, and the "+ New Instance" CTA moves from `Sidebar.footer` into the SESSIONS view body. Existing tests stay green where they cover unchanged behavior. Tests that **query, interact with, or assert anything about `FileExplorer`** (role queries like `getByRole('treeitem')`, text queries inside the file tree, `userEvent.click` on file rows, visibility assertions) must first switch to the FILES tab via `userEvent.click(getByRole('button', { name: 'FILES' }))`, OR move into `FilesView.test.tsx`. The `hidden` attribute makes the inactive subtree inert: role queries skip it, click targets are unreachable. Test count is **nondecreasing** vs main.

## Decisions (locked during brainstorming)

| #   | Decision                                                                                                                                                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Sidebar primitive API stays unchanged** — no new `tabs` slot                                                                                                                                    | The slot model was promoted in #178 weeks ago. Extending the contract for one feature dilutes the primitive's purpose. A future refactor to a `children`-based container is a separate question; deferred per `## Future work`.                                                                                                                                                                                                                                                                                                                                               |
| 2   | **Tabs and tab views compose inside the existing `content` slot** (Approach B)                                                                                                                    | Sidebar primitive is unaware of tabs. WorkspaceView's `content` is a fragment with the tabs row on top and both views (one shown, one `hidden`) below. Concrete shape in §6.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | **Both views always mounted; visibility toggled via `hidden` attribute**                                                                                                                          | `FileExplorer`'s `useFileTree` carries non-trivial local state (`currentPath`, `nodes`, scroll position, expanded folders). Conditional render unmounts the inactive view and loses all of it — including a Tauri roundtrip on remount. `hidden` preserves DOM mounting, scroll position, and React state with negligible memory cost. The hidden subtree is inert to assistive tech and tab navigation, so focus naturally lives in the visible view; if a future feature needs to restore focus on tab switch, the tabs row's `onChange` is the place to do it (Section 4). |
| 4   | **`SidebarTabs` is generic** — accepts a `tabs: { id, label }[]` array and `activeId` / `onChange`                                                                                                | CONTEXT lands later by appending one entry; the component never has to grow special-case logic for "the third tab." Same shape works for any future tab set.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | **`useSidebarTab` lives at `src/hooks/`** (peer to `useResizable`)                                                                                                                                | The hook is workspace-shell-aware but not session/file-feature-specific. Lifting it to `src/hooks/` matches `useResizable`'s precedent and gives the eventual IconRail-driven version a natural home — IconRail and SidebarTabs become co-equal consumers, not parent/child.                                                                                                                                                                                                                                                                                                  |
| 6   | **"+ New Instance" button moves into `SessionsView`**, out of `Sidebar.footer`                                                                                                                    | The button is logically part of the SESSIONS view (per §4.2 — bottom of the sessions list), not a chrome-level concern. After the move, `Sidebar.footer` is unused at this consumer; the slot stays in the primitive for future Sidebar consumers.                                                                                                                                                                                                                                                                                                                            |
| 7   | **`Sidebar.bottomPane` slot is unused at WorkspaceView after the refactor**                                                                                                                       | `FileExplorer` migrates to `FilesView` (full-height inside the tab view). The `bottomPane` slot remains in the Sidebar primitive — removing it would be an unrelated API breakage.                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | **Tabs row visual = §4.2 spec; left-accent bar mirrors §4.1's icon-rail active style** (`2 px` wide, vertical, top/bottom inset `8 px` from button edges, `border-radius: 2 px`, color `#cba6f7`) | Visual consistency between the two "active selector" surfaces (rail + tabs); inset matches §4.1 exactly so the bar reads as a punctuation mark, not a full edge.                                                                                                                                                                                                                                                                                                                                                                                                              |

## Scope

### In scope (this PR)

- New `SidebarTabs` component (`src/components/sidebar/SidebarTabs.tsx`) — generic, presentational, takes a `tabs` array + `activeId` + `onChange`; styling per §4.2.
- New `useSidebarTab` hook (`src/hooks/useSidebarTab.ts`) — `useState`-backed; returns `{ activeTab, setActiveTab }`; default `'sessions'`.
- New `SessionsView` component (`src/features/workspace/components/SessionsView.tsx`) — composes `<List>` + the relocated "+ New Instance" button.
- New `FilesView` component (`src/features/workspace/components/FilesView.tsx`) — thin wrapper around `<FileExplorer>` for symmetry with `SessionsView`.
- WorkspaceView wiring update — `Sidebar.content` becomes a fragment with `SidebarTabs` + the two views (one shown, one `hidden`); `Sidebar.bottomPane` and `Sidebar.footer` are no longer passed at this consumer.

### Out of scope (deferred to follow-ups)

| Concern                                                                                                                 | Why deferred                                                                                                                                                                                                        | Tracking                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **CONTEXT tab + content**                                                                                               | The CONTEXT view's data source is undecided — mock vs live wiring (editor buffers + agent activity + test results) is its own design conversation.                                                                  | Follow-up issue: "Wire CONTEXT tab content (handoff §4.2)".                                                       |
| **Brand header** (project name + branch above tabs row, per §4.2)                                                       | Decorative; agent status (existing `SidebarStatusHeader`) is functional and stays. Adding a brand header needs branch-resolution wiring (probably from `useGitStatus`).                                             | Follow-up issue: "Add brand header above SidebarStatusHeader (handoff §4.2)".                                     |
| **IconRail integration** (clicking rail icons drives sidebar tabs)                                                      | The rail's icon set itself is pending a separate design pass; wiring half of the rail now would be redone when that lands. `useSidebarTab` exposes the right shape so the integration is a one-call addition later. | Project memory `project_iconrail_pending_design_pass`; reopen #175 follow-up when rail design lands.              |
| **Persistence** (remember active tab across reloads)                                                                    | `useState`-only is enough to ship the UI; localStorage wiring needs a namespace decision (`vimeflow.sidebar.activeTab`) and migration tests. Easy to add later inside the hook without API changes.                 | Follow-up issue: "Persist sidebar active tab across reloads".                                                     |
| **Keyboard shortcuts** — global (Ctrl+1/2/3, ⌘K-style) AND strict-WAI-ARIA arrow-key navigation between tabs            | Not in §4.2; not in #175. v1 ships click + button-default Tab+Enter/Space activation only; strict roving-tabindex / arrow / Home / End is documented under §8 Future work.                                          | Follow-up issues: "Global keyboard shortcuts for sidebar tab switching" + "Strict WAI-ARIA Tabs roving tabindex". |
| **Removing unused `FilesPanel.tsx`** (`src/features/workspace/components/panels/FilesPanel.tsx` — currently unimported) | Pre-existing dead code unrelated to #175. Cleanup belongs in its own commit so the diff stays scoped.                                                                                                               | Follow-up issue: "Remove unused FilesPanel.tsx".                                                                  |
| **Refactor Sidebar primitive to a `children`-based container**                                                          | Architectural debate raised during brainstorming. Slot model works today; large refactor is its own design pass. See `## Future work`.                                                                              | Future work section in this spec.                                                                                 |
| **Dropping `Sidebar.bottomPane` / `Sidebar.footer` slots from the primitive**                                           | After #175, WorkspaceView no longer passes these slots, but the primitive keeps them — removing slots from a public component API is unrelated breakage.                                                            | Reopen if/when no consumer of `Sidebar` uses `bottomPane` / `footer`.                                             |

## Non-goals

- **No change to session domain types, hooks, or behavior.** `useSessionManager`, the `Session` type, restore data, and `createSession` / `removeSession` / `renameSession` semantics are untouched.
- **No change to session-feature components.** `SessionsView` only composes `<List>` (which itself owns `<Card>`, `<Group>`, `StatusDot`); these stay in lockstep with #181 and are not touched. The browser-style session tab strip — `<Tab>` / `<Tabs>` from `src/features/sessions/components/` — lives in the main-canvas region, not in `SessionsView`, and is not touched by this PR.
- **No change to `FileExplorer.tsx` or `useFileTree`.** Component is lifted, not modified.
- **No change to the `Sidebar` primitive's API** (decision #1 from §1).
- **No new mock data files.** No `mockContextItems.ts`, no expansion of `mockNavigation.ts`.

## File layout

### Before (after #181 + #184 land)

```
src/
├── components/
│   └── sidebar/
│       ├── Sidebar.tsx                 ← slot-based primitive (#178)
│       └── Sidebar.test.tsx
├── hooks/
│   └── useResizable.ts                 ← global UI hook precedent
├── features/
│   ├── sessions/
│   │   ├── components/{Card, Group, List, Tab, Tabs, StatusDot}.{tsx,test.tsx}
│   │   ├── hooks/{useSessionManager, useRenameState}.{ts,test.ts}
│   │   ├── types/index.ts
│   │   └── utils/{statePill, lineDelta, subtitle, mediateReorder, agentForSession, pickNextVisibleSessionId}.{ts,test.ts}
│   └── workspace/
│       ├── WorkspaceView.tsx           ← wires Sidebar with header / content / bottomPane / footer
│       ├── WorkspaceView.{test,integration.test,notifyInfo.test,command-palette.test}.tsx
│       ├── components/
│       │   ├── IconRail.tsx
│       │   ├── SidebarStatusHeader.tsx
│       │   ├── … (BottomDrawer, ContextSwitcher, InfoBanner, StatusBar, TerminalZone)
│       │   └── panels/{DiffPanel, EditorPanel, FileExplorer, FilesPanel}.tsx
│       └── data/, hooks/, etc. (unchanged)
```

### After (this PR)

```
src/
├── components/
│   └── sidebar/
│       ├── Sidebar.tsx                 ← unchanged (decision #1)
│       ├── Sidebar.test.tsx            ← unchanged
│       ├── SidebarTabs.tsx             ← NEW (generic tabs row, ~80 lines target)
│       └── SidebarTabs.test.tsx        ← NEW (tablist semantics + active styling + onChange)
├── hooks/
│   ├── useResizable.ts                 ← unchanged
│   ├── useSidebarTab.ts                ← NEW (useState wrapper + SidebarTab type, ~40 lines)
│   └── useSidebarTab.test.ts           ← NEW (initial/default + setActiveTab)
└── features/
    └── workspace/
        ├── WorkspaceView.tsx           ← MODIFIED — see §6 for the wiring delta
        ├── WorkspaceView.{test,integration.test,notifyInfo.test,command-palette.test}.tsx
        │                               ← MODIFIED — tests asserting FileExplorer visibility now click FILES tab first
        └── components/
            ├── SessionsView.tsx        ← NEW (composes <List> + "+ New Instance" button, ~50 lines)
            ├── SessionsView.test.tsx   ← NEW (List rendering + button onClick wiring)
            ├── FilesView.tsx           ← NEW (thin wrapper around <FileExplorer>, ~25 lines)
            ├── FilesView.test.tsx      ← NEW (FileExplorer rendering + cwd prop forwarding)
            ├── … (other components unchanged)
            └── panels/                 ← unchanged (FileExplorer untouched, still imported into FilesView)
```

### File-level deltas

| Action        | Path                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CREATE**    | `src/components/sidebar/SidebarTabs.tsx`                        | Generic presentational tabs row — see §4 for component contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **CREATE**    | `src/components/sidebar/SidebarTabs.test.tsx`                   | Unit tests: toolbar / toggle-button semantics (`role="toolbar"`, per-button `aria-pressed`), active styling (accent bar present), onChange firing on click + Enter/Space, default `aria-label` + override. ~10 tests; no arrow-key coverage (intentionally — see §4).                                                                                                                                                                                                                                                                                                                                                                |
| **CREATE**    | `src/hooks/useSidebarTab.ts`                                    | `useState`-backed; exports `useSidebarTab`, `SidebarTab` type, `DEFAULT_SIDEBAR_TAB` const. See §5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **CREATE**    | `src/hooks/useSidebarTab.test.ts`                               | Initial default tab, `setActiveTab` updates the value, `setActiveTab` reference is stable across renders (React state-setter guarantee). The returned object literal itself is fresh each render — that is not asserted.                                                                                                                                                                                                                                                                                                                                                                                                             |
| **CREATE**    | `src/features/workspace/components/SessionsView.tsx`            | Composes `<List>` + `<button>` for "+ New Instance". Owns layout (flex column, list flex-1, button shrink-0).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **CREATE**    | `src/features/workspace/components/SessionsView.test.tsx`       | Renders List with passed-through props, + button fires onCreateSession.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **CREATE**    | `src/features/workspace/components/FilesView.tsx`               | Thin: passes `cwd` and `onFileSelect` to `<FileExplorer>`. Reason for the wrapper: symmetry with SessionsView and a single test surface for FILES-tab-specific concerns.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **CREATE**    | `src/features/workspace/components/FilesView.test.tsx`          | Forwards `cwd` and `onFileSelect` to FileExplorer; mock FileExplorer to assert prop forwarding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **MODIFY**    | `src/features/workspace/WorkspaceView.tsx`                      | Replace `Sidebar` wiring — see §6 for the exact delta.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **MODIFY**    | `src/features/workspace/WorkspaceView.test.tsx`                 | Any test that **queries, interacts with, or asserts visibility on** `FileExplorer` (role/text queries, `userEvent.click` on file rows, "is in document" assertions) now clicks `getByRole('button', { name: 'FILES' })` first — `hidden` makes the FilesView subtree inert (role queries skip it, click targets unreachable). New tests: tab switching toggles which view is visible; both views remain mounted across switches (asserted via `getByTestId('files-view')` / `getByTestId('sessions-view')` — `ByTestId` queries find hidden DOM by default — and the inactive view's testid'd root carrying the `hidden` attribute). |
| **MODIFY**    | `src/features/workspace/WorkspaceView.integration.test.tsx`     | Same FILES-tab-click prefix where applicable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **MODIFY**    | `src/features/workspace/WorkspaceView.notifyInfo.test.tsx`      | Audit for FileExplorer assumptions; touch only if affected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **MODIFY**    | `src/features/workspace/WorkspaceView.command-palette.test.tsx` | Audit for FileExplorer assumptions; touch only if affected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **MODIFY**    | `src/features/workspace/WorkspaceView.visual.test.tsx`          | Audit for "File Explorer is in sidebar" assertions; click FILES tab first or move into FilesView visual coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **MODIFY**    | `src/features/workspace/WorkspaceView.verification.test.tsx`    | Audit for FileExplorer assumptions; touch only if affected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **MODIFY**    | `src/features/workspace/WorkspaceView.subscription.test.tsx`    | Audit for FileExplorer assumptions; touch only if affected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **UNCHANGED** | `src/components/sidebar/Sidebar.tsx`                            | Primitive API stays — decision #1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **UNCHANGED** | `src/features/sessions/components/List.tsx`                     | SessionsView consumes List as-is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **UNCHANGED** | `src/features/workspace/components/panels/FileExplorer.tsx`     | FilesView consumes FileExplorer as-is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **UNCHANGED** | `src/features/workspace/components/SidebarStatusHeader.tsx`     | Stays in `Sidebar.header` slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **UNCHANGED** | `src/features/files/hooks/useFileTree.ts`                       | Pre-existing cwd-reset behavior intentionally not modified (per Goal 4 note in §1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Approximate diff size

- **New code**: 4 source files + 4 test files (`SidebarTabs.{tsx,test.tsx}`, `useSidebarTab.{ts,test.ts}`, `SessionsView.{tsx,test.tsx}`, `FilesView.{tsx,test.tsx}`).
- **Modified code**: 1 source file (`WorkspaceView.tsx` — wiring delta only) + up to 7 test files (audit-and-update where `FileExplorer` visibility is assumed: `.test`, `.integration.test`, `.notifyInfo.test`, `.command-palette.test`, `.visual.test`, `.verification.test`, `.subscription.test`).
- **No deletions** — `FilesPanel.tsx` removal is deferred (out-of-scope follow-up issue).

## SidebarTabs component contract

`SidebarTabs` is a generic, presentational view-switcher rendered as **toggle buttons** (NOT WAI-ARIA Tabs). It renders a horizontal row of label buttons styled per handoff §4.2 and emits `onChange` on every tab click (consumers may no-op when the clicked tab is already active). It does NOT own the panels — those live in `WorkspaceView` (siblings inside the `Sidebar.content` slot) and are toggled via the `hidden` attribute.

Why toggle buttons instead of `role="tablist"` / `role="tab"`: the WAI-ARIA Tabs pattern implies roving-tabindex / arrow-key navigation, which v1 explicitly does not implement (per §3 — keyboard shortcuts deferred). Shipping `role="tab"` + `aria-selected` without the keyboard contract is a semantic mismatch. Toggle buttons (`role="toolbar"` container + `aria-pressed` per button) give honest semantics: each button is in tab order, click/Enter/Space activates, the active state is announced as "pressed". If a future PR ships strict WAI-ARIA Tabs (roving + arrows), the role swap is documented in §8 Future work.

### Props

The component is **generic over the tab-id type** so a typed consumer (e.g., one passing `useSidebarTab`'s `setActiveTab: (tab: SidebarTab) => void`) gets end-to-end type safety without casting at the boundary. Callers that don't want to specify a type get the default `string`.

```ts
export interface SidebarTabItem<TId extends string = string> {
  /** Stable id used for selection and as the React `key`. */
  id: TId
  /** Display label rendered inside the toggle button. Kept short — the
   *  visual sizing (11 px uppercase JetBrains Mono) assumes ≤ 8 chars. */
  label: string
}

export interface SidebarTabsProps<TId extends string = string> {
  /** Tabs to render, in left-to-right order. 1–4 entries. */
  tabs: readonly SidebarTabItem<TId>[]
  /** The currently active tab's id. Must be present in `tabs`. */
  activeId: TId
  /** Fires on every tab click; consumers may no-op when `id === activeId`. */
  onChange: (id: TId) => void
  /**
   * Accessible name for the tablist. Default `'Sidebar tabs'`. Override
   * when using SidebarTabs in a context where the default is ambiguous.
   */
  'aria-label'?: string
  /** Test hook id. Default `'sidebar-tabs'`. */
  'data-testid'?: string
}

// TypeScript usually infers TId from `tabs`; consumers can pin it
// explicitly when narrowing matters:
//
//   <SidebarTabs<SidebarTab>
//     tabs={SIDEBAR_TAB_ITEMS}
//     activeId={activeTab}
//     onChange={setActiveTab}
//   />
```

### Visual contract (§4.2)

- Container: horizontal flex row, `padding: 8px 12px`, `gap: 16px`. No border/background — sits flush in the `content` slot.
- Each tab button: `padding: 4px 0`, no fixed min-width (text-only). Text: 11 px JetBrains Mono uppercase, `letter-spacing: 0.08em`, `font-weight: 600`.
- **Inactive tab**: color `#6c7086` (no appropriate UI/surface token; `editor.syn.comment` in `tailwind.config.js` has the same hex but is a code-syntax-highlight token, wrong category for chrome — use a literal hex with a `// §4.2` comment). Hover: color `text-on-surface-variant` (`#cdc3d1`), `cursor: pointer`. No background change on hover.
- **Active tab**: color `text-primary-container` (`#cba6f7`), `position: relative`, `padding-left: 12 px` (overrides the default `padding: 4px 0` for active tabs to make room for the accent bar). The left accent bar is an absolutely-positioned `<span>` inside the active tab button: `2 px` wide, vertical, positioned at `left: 4 px`, top/bottom inset `8 px` from button edges, `border-radius: 2 px`, background `bg-primary-container` (`#cba6f7`) — mirrors §4.1's icon-rail active accent (Decision #8). Inactive tabs do NOT carry the extra left padding, so layout shifts on selection — that shift is intentional and matches the §4.2 spec sketch where the active label visually moves right by the bar's width.
- Disabled state: not specified for v1. If a tab needs disabling later (e.g., a CONTEXT tab waiting for data), add `disabled?: boolean` to `SidebarTabItem` and pair with `aria-disabled="true"` on the button.

Token mapping (verified against `tailwind.config.js`):

| §4.2 hex  | Token                                                                                                                                      | Use                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `#cba6f7` | `text-primary-container` / `bg-primary-container`                                                                                          | active tab text + accent bar fill |
| `#cdc3d1` | `text-on-surface-variant`                                                                                                                  | inactive-tab hover color          |
| `#6c7086` | (no UI/surface token — literal hex with `// §4.2` comment; `editor.syn.comment` shares the hex but is a code-syntax token, wrong category) | inactive-tab base color           |

Note: `text-primary` in this project is `#e2c7ff` (a lighter lavender), NOT `#cba6f7`. Use `text-primary-container` for the §4.2 active color.

### Accessibility contract (resolves F1 deferral)

Toggle buttons inside a toolbar role. No tablist / tab / tabpanel ARIA is emitted, so no implied keyboard contract is unfulfilled.

| Concern              | Behavior                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Container            | A `<div role="toolbar" aria-label={...}>`. The default `aria-label="Sidebar tabs"` is overridable via prop.                                                                                            |
| Toggle buttons       | Each rendered as `<button type="button" aria-pressed={id===activeId}>`. Default `tabIndex` (= `0`) — every button is in document tab order. No `role="tab"`, no `aria-selected`, no `aria-controls`.   |
| Activation           | Click → `onChange(tabId)`. `Enter` / `Space` on a focused button fires the default click → `onChange(tabId)`. No custom keyboard handler.                                                              |
| Screen-reader output | Active button is announced as "toggle button SESSIONS, pressed" / inactive as "toggle button FILES, not pressed". The container's `aria-label` provides the group name.                                |
| Focus on selection   | Browser default: clicking or pressing Enter/Space on a button focuses it. The consumer's view-toggle re-render does not steal focus because the activated button stays mounted with the same identity. |
| Inert hidden subtree | The `hidden` attribute on the inactive view (set on `SessionsView` / `FilesView`'s root, see §6) excludes its DOM from a11y trees and tab order. `SidebarTabs` itself does nothing about this.         |

What's intentionally NOT implemented in v1:

- Roving tabindex.
- `ArrowLeft` / `ArrowRight` / `Home` / `End` navigation.
- WAI-ARIA Tabs / Tabpanel roles (would require the missing keyboard contract for honest semantics — tracked in §8 Future work).

### Test plan

`SidebarTabs.test.tsx` covers:

1. Renders one toggle button per `tabs` entry, in order.
2. Active button carries `aria-pressed="true"`; inactive buttons carry `aria-pressed="false"`.
3. Every button has the default `tabIndex={0}` (no roving tabindex).
4. Click on a non-active button calls `onChange(id)` exactly once with the right id.
5. `Enter` keypress on a focused non-active button calls `onChange(id)`. `Space` does too. (Both via the `<button>`'s default activation; no custom handler asserted.)
6. Click on the already-active button still calls `onChange(id)` — implementations can opt for "no-op when same id" later, but the contract here is "fire on every click."
7. Container carries `role="toolbar"` and `aria-label` defaults to `'Sidebar tabs'` (overridable via prop).
8. The active accent bar element is present on the active button and absent on others (queried by a `data-testid` like `'sidebar-tabs-accent'`).
9. Buttons are queryable via `getByRole('button', { name: <label> })` — covers the consumer-facing query pattern documented in §1 Goal 5.

Snapshot tests are explicitly NOT in scope — visual regressions are caught by §6's WorkspaceView visual test once it renders the integrated sidebar.

### Implementation notes

- No `useRef`, no `useEffect`, no custom keyboard handler — clicks are the only activation path. `<button onClick={() => onChange(item.id)}>` is enough; `Enter` / `Space` get button-default activation for free.
- The accent bar is a `<span>` inside the active tab button styled `absolute left-1 top-2 bottom-2 w-0.5 rounded-sm bg-primary-container` (per the token-mapping table). Fits in one line of JSX behind `{isActive && <span ... />}`. The active button itself adds `pl-3` (12 px) to clear the bar.
- Component should be **memoized** (`React.memo`) when render frequency is a concern. WorkspaceView re-renders on every session change; if profiling shows SidebarTabs as a hotspot, memoize. Default v1 ships without `memo`.

## useSidebarTab hook contract

`useSidebarTab` owns the active-tab state for the sidebar. v1 is a thin `useState` wrapper; the hook exists so future capabilities (localStorage persistence, IconRail-driven sync, URL parameter binding) can be added in one place without touching consumers.

### API

```ts
// src/hooks/useSidebarTab.ts

import { useState } from 'react'

/**
 * Identifier for one of the sidebar's top tabs. The set is intentionally
 * a string-literal union (not a free `string`) so misspellings break at
 * compile time and IDE autocomplete suggests valid values.
 *
 * Adding CONTEXT later: extend this union AND append a matching entry
 * to `SIDEBAR_TAB_ITEMS` in `WorkspaceView` (§6) AND any consumer-side
 * switch that lacks an exhaustive default.
 */
export type SidebarTab = 'sessions' | 'files'

/**
 * Default tab for a fresh session — opens to SESSIONS so the user lands
 * on the activity surface they're most likely to want.
 */
export const DEFAULT_SIDEBAR_TAB: SidebarTab = 'sessions'

// Note: there is intentionally NO `SIDEBAR_TABS` array constant exported
// from this hook. The rendered tab list (with labels) is `SIDEBAR_TAB_ITEMS`
// in WorkspaceView (§6) — that's the single source of truth for tab order
// and labels. The `SidebarTab` union type above is the type-narrowing source
// of truth; both sites must stay in sync when CONTEXT is added.

export interface UseSidebarTabOptions {
  /** Initial tab. Defaults to `DEFAULT_SIDEBAR_TAB`. */
  initial?: SidebarTab
}

export interface UseSidebarTabReturn {
  /** Currently active tab. */
  activeTab: SidebarTab
  /**
   * Set the active tab. Reference identity is stable across renders
   * (React `setState` guarantee), so consumers can pass it as a prop /
   * effect dep without needing a `useCallback` wrapper.
   */
  setActiveTab: (tab: SidebarTab) => void
}

export const useSidebarTab = (
  options: UseSidebarTabOptions = {}
): UseSidebarTabReturn => {
  const [activeTab, setActiveTab] = useState<SidebarTab>(
    options.initial ?? DEFAULT_SIDEBAR_TAB
  )
  return { activeTab, setActiveTab }
}
```

### Behavior contract

- **Source of truth:** internal `useState`. No URL parsing, no localStorage, no IconRail subscription in v1 (tracked in §3 / §8).
- **Default tab:** `'sessions'`. The user lands on the session list on every fresh launch (until persistence is added).
- **Reference identity:** the returned `setActiveTab` is the React state-setter directly — its reference does not change across renders. The returned object literal IS fresh on every render; consumers that want stable identity for the wrapper object must memoize at their site (none in v1 do).
- **Type-narrowed input:** because `SidebarTab` is a string-literal union, calling `setActiveTab('foobar')` fails at compile time. This is the load-bearing reason for not using `string`.
- **No event surface:** v1 does NOT emit a "tab changed" event. Consumers that need to react (e.g., focus management, telemetry) wrap `setActiveTab` themselves.

### Test plan

`useSidebarTab.test.ts` covers (using `@testing-library/react`'s `renderHook`):

1. **Default initial value** — `useSidebarTab()` (no args) returns `activeTab === 'sessions'`.
2. **Custom initial value** — `useSidebarTab({ initial: 'files' })` returns `activeTab === 'files'`.
3. **`setActiveTab` updates the value** — `act(() => result.current.setActiveTab('files'))` then `result.current.activeTab === 'files'`.
4. **`setActiveTab` reference is stable across renders** — capture `setActiveTab` from the first render, force a re-render via a state change, assert the captured reference is `===` the new render's `setActiveTab`.
5. **Updating to the same tab does not change `activeTab` identity unnecessarily** — `setActiveTab('sessions')` when already on sessions: `activeTab` stays `'sessions'`. (Verifies React state-setter behavior; not a hook-specific assertion but the test pins the contract.)

The test count target is 5 tests in this single file. Across this PR, four new test files land (`useSidebarTab.test.ts` + `SidebarTabs.test.tsx` + `SessionsView.test.tsx` + `FilesView.test.tsx`) — total project test-file count goes up by exactly 4 vs main; total individual-test count is nondecreasing (and increases by ~30 when all the new files' assertions land).

### Future-extensibility shape

These extensions are all out-of-scope (§3) but listed so the v1 implementation doesn't paint itself into a corner:

| Future extension                                                    | How it lands inside this hook                                                                                                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CONTEXT tab**                                                     | Add `'context'` to the `SidebarTab` union here AND append `{ id: 'context', label: 'CONTEXT' }` to `SIDEBAR_TAB_ITEMS` in WorkspaceView (§6). The rendered tab appears automatically; no hook code change beyond the union. |
| **localStorage persistence**                                        | Replace the `useState` initializer with a `useState(() => readFromStorage() ?? DEFAULT_SIDEBAR_TAB)` and wrap `setActiveTab` to mirror writes to storage. Hook signature unchanged.                                         |
| **IconRail integration**                                            | The rail's `onClick` for the relevant icons calls `setActiveTab(...)` — no hook surface change. The shared instance lives at WorkspaceView, passed to both consumers.                                                       |
| **URL binding (`?tab=files`)**                                      | Wrap `useState` with `useSearchParams` (or whatever router shows up). Hook signature unchanged; consumers don't notice.                                                                                                     |
| **Cross-tab broadcast** (e.g., agent action wants to flip to FILES) | Expose `setActiveTab` from a context provider; this hook becomes its consumer. Or keep `useState` and lift the source of truth up — same return shape either way.                                                           |

## WorkspaceView wiring + tab views

This section is the consumer-side glue. It locks the exact JSX shape of the `Sidebar.content` slot, the prop wiring of `useSidebarTab`, and how the relocated "+ New Instance" button coexists with `<List>`'s pre-existing `onNewInstance` header `+` button (resolves F21 deferred from §5).

### WorkspaceView delta

```diff
 export const WorkspaceView = (): ReactElement => {
   // ...
+  const { activeTab, setActiveTab } = useSidebarTab()

-  return (
-    <Sidebar
-      header={<SidebarStatusHeader ... />}
-      content={
-        <List
-          sessions={sessions}
-          activeSessionId={activeSessionId}
-          onSessionClick={setActiveSessionId}
-          onNewInstance={createSession}
-          onRemoveSession={removeSession}
-          onRenameSession={renameSession}
-          onReorderSessions={reorderSessions}
-        />
-      }
-      bottomPane={
-        <FileExplorer
-          cwd={activeSession?.workingDirectory ?? '~'}
-          onFileSelect={handleFileSelect}
-        />
-      }
-      footer={
-        <button onClick={createSession} ...>
-          New Instance
-        </button>
-      }
-    />
-  )
+  return (
+    <Sidebar
+      header={<SidebarStatusHeader ... />}
+      content={
+        <div className="flex h-full min-h-0 flex-col">
+          <SidebarTabs<SidebarTab>
+            tabs={SIDEBAR_TAB_ITEMS}
+            activeId={activeTab}
+            onChange={setActiveTab}
+          />
+          <SessionsView
+            hidden={activeTab !== 'sessions'}
+            sessions={sessions}
+            activeSessionId={activeSessionId}
+            onSessionClick={setActiveSessionId}
+            onCreateSession={createSession}
+            onRemoveSession={removeSession}
+            onRenameSession={renameSession}
+            onReorderSessions={reorderSessions}
+          />
+          <FilesView
+            hidden={activeTab !== 'files'}
+            cwd={activeSession?.workingDirectory ?? '~'}
+            onFileSelect={handleFileSelect}
+          />
+        </div>
+      }
+    />
+  )
 }
```

Key shape points:

- The `content` slot becomes a single flex column. `min-h-0` on every flex layer is load-bearing — without it, a `flex-1` child would size to its content rather than the parent's bounded height, and the file tree (which has its own internal scroll) breaks.
- `SidebarTabs` is the row at the top — natural size, no flex-grow.
- Each view component (`SessionsView` / `FilesView`) takes a `hidden?: boolean` prop and applies it to its root `<div>` (the same element that carries the `data-testid`). The `hidden` HTML attribute, when present, sets `display: none` and excludes the subtree from a11y trees and tab order. React keeps the component mounted across `hidden` toggles. **No anonymous wrapper divs** — placing `hidden` on the view's testid'd root means tests can assert `expect(getByTestId('sessions-view')).toHaveAttribute('hidden')` directly.
- `Sidebar.bottomPane` and `Sidebar.footer` are NOT passed. The Sidebar primitive's slot-suppression rule (post-#178: `null`/`undefined`/`false`/`true` all suppress the wrapper) prevents phantom padded divs.

### `SIDEBAR_TAB_ITEMS` constant

A single static `const` lives in `WorkspaceView.tsx` (or a sibling constants file if a third consumer arrives):

```ts
import type { SidebarTab } from '../../hooks/useSidebarTab'
import type { SidebarTabItem } from '../../components/sidebar/SidebarTabs'

const SIDEBAR_TAB_ITEMS: readonly SidebarTabItem<SidebarTab>[] = [
  { id: 'sessions', label: 'SESSIONS' },
  { id: 'files', label: 'FILES' },
] as const
```

The `as const` plus the explicit `readonly SidebarTabItem<SidebarTab>[]` type annotation gives codex / TS narrowing on `id`, AND the const is hoisted out of the render function so re-renders don't churn its identity (avoids needless `SidebarTabs` prop diffs).

### `SessionsView` component

Composes the existing `<List>` plus a relocated "+ New Instance" gradient button. The two are SIBLINGS in a flex column, NOT a parent/child relationship. List keeps its existing `onNewInstance` prop (which drives a small `+` icon in the Active group header per cycle 6); the relocated big "New Instance" gradient button is a separate, more prominent control at the bottom of the SESSIONS view body.

Both buttons fire the same `onCreateSession` callback. The duplication is intentional — it's the pre-existing UX (cycle 6 ships both) and unifying them is out of scope.

```tsx
// src/features/workspace/components/SessionsView.tsx

export interface SessionsViewProps {
  /** When true, the view is `hidden` (display:none, inert). Default false. */
  hidden?: boolean
  sessions: Session[]
  activeSessionId: string | null
  onSessionClick: (id: string) => void
  onCreateSession: () => void
  onRemoveSession: (id: string) => void
  onRenameSession: (id: string, name: string) => void
  onReorderSessions: (reordered: Session[]) => void
}

export const SessionsView = ({
  hidden = false,
  sessions,
  activeSessionId,
  onSessionClick,
  onCreateSession,
  onRemoveSession,
  onRenameSession,
  onReorderSessions,
}: SessionsViewProps): ReactElement => (
  <div
    hidden={hidden}
    className="flex min-h-0 flex-1 flex-col"
    data-testid="sessions-view"
  >
    <List
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSessionClick={onSessionClick}
      onNewInstance={onCreateSession}
      onRemoveSession={onRemoveSession}
      onRenameSession={onRenameSession}
      onReorderSessions={onReorderSessions}
    />

    {/* "+ New Instance" — relocated from Sidebar.footer. The small `+`
        in List's group header (driven by onNewInstance above) stays;
        this prominent button is a sibling-level UX accelerator. Both
        call onCreateSession. */}
    <button
      type="button"
      onClick={onCreateSession}
      className="m-3 flex shrink-0 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-secondary py-2.5 font-label text-sm font-bold text-on-primary shadow-lg shadow-primary/10 transition-all hover:shadow-xl hover:shadow-primary/20"
      aria-label="New Instance"
      data-testid="sessions-view-new-instance"
    >
      <span className="material-symbols-outlined text-lg">bolt</span>
      <span>New Instance</span>
    </button>
  </div>
)
```

### `FilesView` component

Thin wrapper. Exists for symmetry with `SessionsView` and a single test surface for FILES-tab-specific concerns (e.g., the cwd prop forwarding).

```tsx
// src/features/workspace/components/FilesView.tsx

export interface FilesViewProps {
  /** When true, the view is `hidden` (display:none, inert). Default false. */
  hidden?: boolean
  cwd: string
  onFileSelect: (file: FileNode) => void
}

export const FilesView = ({
  hidden = false,
  cwd,
  onFileSelect,
}: FilesViewProps): ReactElement => (
  <div
    hidden={hidden}
    className="flex min-h-0 flex-1 flex-col"
    data-testid="files-view"
  >
    <FileExplorer cwd={cwd} onFileSelect={onFileSelect} />
  </div>
)
```

### Why two view components and not inline JSX

Keeping `SessionsView` and `FilesView` as named components instead of inline fragments:

- Gives each tab a stable `data-testid` (`sessions-view` / `files-view`) for "view is mounted" assertions independent of the inner List/FileExplorer test ids.
- Lets the WorkspaceView delta stay small (one prop list per view, not the full inner-component prop list) — the diff readers see "tab wiring" as the change, not "moved 8 props one indent deeper."
- Gives the integration tests a stable place to mock for layout-level testing (e.g., the visual test mocks `SessionsView` to a div and asserts the tabs row is positioned correctly without rendering 30 sessions).

If a future PR wants to inline these views back into `WorkspaceView`, it's a one-PR refactor — the components have no other consumers.

### Test coverage — WorkspaceView side

`WorkspaceView.test.tsx` adds:

1. **Initial render** — SidebarTabs container is in the DOM with `role="toolbar"` and `aria-label="Sidebar tabs"`; SESSIONS button is `aria-pressed="true"`; FILES button is `aria-pressed="false"`.
2. **Both views are mounted on initial render** — `getByTestId('sessions-view')` and `getByTestId('files-view')` both return truthy.
3. **Hidden toggle** — on initial render `getByTestId('files-view')` has the `hidden` attribute, `getByTestId('sessions-view')` does not. After `userEvent.click(getByRole('button', { name: 'FILES' }))`, the assertions flip: `sessions-view` has `hidden`, `files-view` does not.
4. **State preservation across switches** — render → switch to FILES → user navigates somewhere observable (e.g., asserts a child text inside the file tree) → switch to SESSIONS → switch back to FILES → the navigated state is still observable. (Exact assertion depends on what `FileExplorer` exposes; if needed, mock `useFileTree` to return a controlled state.)
5. **Sidebar primitive slot suppression** — `queryByTestId('sidebar-footer-wrapper')` returns `null` (the footer wrapper is suppressed when no `footer` prop is passed); `queryByTestId('explorer-resize-handle')` returns `null` (the bottom-pane region's resize handle, which is the only `bottomPane`-conditional element with a testid, is gone). Use `queryByTestId`, not `getByTestId` — the latter throws when absent.

Tests in `WorkspaceView.{integration,visual,verification,subscription,notifyInfo,command-palette}.test.tsx` get audited per §3 — anything asserting "FileExplorer is in the sidebar" must `userEvent.click(getByRole('button', { name: 'FILES' }))` first, OR get moved into `FilesView.test.tsx` as a focused test of the lifted wrapper.

### What about strict WAI-ARIA Tabs / Tabpanel ARIA?

For v1, neither `SidebarTabs` nor the views emit tab/tablist/tabpanel ARIA. The component ships as toggle buttons (`role="toolbar"` + `aria-pressed`); the hidden subtree's exclusion from a11y is enough for screen readers; the toolbar role + button-pressed semantics convey "this view is the current one" honestly without implying a keyboard contract we don't fulfil. If a follow-up needs strict WAI-ARIA Tabs conformance, the package is: (a) implement roving tabindex + arrow/Home/End in `SidebarTabs`, (b) swap container role from `toolbar` to `tablist`, (c) swap button role from `button` to `tab` + `aria-selected` (drop `aria-pressed`), (d) add `controls?` back to `SidebarTabItem`, (e) add `role="tabpanel" aria-labelledby={tabId}` to each view's outer div. All five steps go together. Tracked in §8 Future work.

## Phasing

Given the scope is small (~4 new source files + 4 test files, 1 modified file, audits across ~7 test files) and there's no behavior change, this is a **single-PR, single-commit** change. No phased breakdown.

### Why one commit, not phased

- **No transitional cross-feature paths.** Unlike #181's promotion (where Phase-1 sessions imports temporarily reached back into workspace), every consumer here is updated in one pass: WorkspaceView's `Sidebar` wiring is the only writer, and the tabs row + view components are all new.
- **No risk of leaving the codebase in an intermediate broken state.** A phased approach would split "add SidebarTabs" from "wire it into WorkspaceView" — but Phase-1 alone leaves the new component dead, and the old wiring remains. There's no green intermediate that ships meaningful value.
- **Single code-review surface.** Reviewer sees the full delta (component + hook + view wrappers + WorkspaceView delta + test audits) in one diff; the dependency story is self-contained.

This is **not "no behavior change"** — see §1 Goal 5 for the scoped UI deltas (FileExplorer behind FILES tab, no permanent bottom-pane resize handle, "+ New Instance" CTA relocated). Reviewers and QA should expect the layout shift; the "no regression" claim is specifically about agent/session functional behavior staying identical.

### Commit content

```
feat(sidebar): SESSIONS / FILES top-tab switcher (handoff §4.2)

Closes #175.

- New SidebarTabs component (src/components/sidebar/SidebarTabs.tsx) — generic, presentational, click+Enter/Space activation, role="toolbar" container + per-button aria-pressed (toggle-button pattern, not WAI-ARIA Tabs).
- New useSidebarTab hook (src/hooks/useSidebarTab.ts) — useState wrapper, default 'sessions', SidebarTab type narrowed for type safety.
- New SessionsView and FilesView components in src/features/workspace/components/ — take a hidden? prop for the always-mounted-toggle-visibility pattern.
- WorkspaceView wires SidebarTabs + both views inside Sidebar.content; Sidebar.bottomPane and Sidebar.footer are no longer passed (FileExplorer moves into FilesView; "+ New Instance" button moves into SessionsView body alongside the existing List header `+`).
- Test audits across 7 WorkspaceView test files for FileExplorer-visible assumptions; deferred follow-ups for CONTEXT, brand header, IconRail integration, persistence, and strict-WAI-ARIA Tabs are not in this PR.
```

### Verification gate (per-commit)

The same gate the project runs on every commit:

- `npm run lint` clean.
- `npm run type-check` clean.
- `npm run test` — all tests green; test count is **+ exactly 4 new test files** vs main; total individual-test count nondecreasing.
- `npm run review` (local codex review) returns no actionable HIGH/MEDIUM regressions.

### Branch + PR mechanics

- Branch: `feat/sidebar-tabs-switcher-175` (already created from main at the spec-write time).
- PR base: `main`.
- PR title: `feat(sidebar): SESSIONS / FILES top-tab switcher (handoff §4.2)`.
- PR body cites the spec path, the locked decisions, the deferred follow-ups, and links the codex review report.
- Manual smoke checklist in the PR body: open app, click FILES tab, navigate two folders deep, click SESSIONS, click FILES → assert path preserved; switch active session via SESSIONS tab → click FILES → assert path reset (intentional pre-existing behavior, see Goal 4).

## Future work

These are not in scope for #175 but are documented here so the v1 implementation doesn't make any of them harder to land later.

| Future change                                                                                   | Touches                                                                                                                                                                                                                                                                                                                                                                                            | Sized as                                                         |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **CONTEXT tab + content**                                                                       | Add `'context'` to `SidebarTab` union (§5); append `{ id: 'context', label: 'CONTEXT' }` to `SIDEBAR_TAB_ITEMS` (§6); create `ContextView` component; decide mock vs live data source.                                                                                                                                                                                                             | medium PR                                                        |
| **Brand header above SidebarStatusHeader**                                                      | New `BrandHeader.tsx`; WorkspaceView prepends it to the Sidebar.header slot's value (header becomes a fragment); branch resolution likely from `useGitStatus` (already wired).                                                                                                                                                                                                                     | small PR                                                         |
| **IconRail integration** (clicking rail icons drives tab state)                                 | Wait for the IconRail design pass (memory `project_iconrail_pending_design_pass`); when it lands, IconRail receives `activeTabId` + `onTabClick` props; WorkspaceView wires both to `useSidebarTab`.                                                                                                                                                                                               | small PR after rail design                                       |
| **localStorage persistence**                                                                    | Inside `useSidebarTab.ts`: replace `useState(initial)` with a `useState(() => readStorage('vimeflow.sidebar.activeTab') ?? initial)` plus a `useEffect` write. Hook signature unchanged.                                                                                                                                                                                                           | small PR                                                         |
| **Strict WAI-ARIA Tabs + Tabpanel** (roving tabindex + arrow keys + tab/tablist/tabpanel roles) | Five-part change to `SidebarTabs.tsx` and the views, all required together: (a) roving tabindex, (b) `onKeyDown` handler for ArrowLeft/Right/Home/End, (c) container `role="toolbar"` → `role="tablist"`, (d) button `aria-pressed` → `role="tab"` + `aria-selected`, (e) views add `role="tabpanel"` + `aria-labelledby`. Re-add `controls?` to `SidebarTabItem`. Test plan rewrites accordingly. | medium PR (the five steps must land together for ARIA coherence) |
| **Lift `FileExplorer.currentPath` out of `useFileTree`**                                        | Source-side change to `useFileTree` so `currentPath` survives `externalCwd` changes. Removes the cwd-reset behavior pre-existing today (Goal 4 note in §1).                                                                                                                                                                                                                                        | medium PR                                                        |
| **Sidebar primitive → `children`-based container** (architectural refactor)                     | Replace the slot props with a single `children` prop; consumers compose freely. Touches every Sidebar consumer + slot-suppression tests.                                                                                                                                                                                                                                                           | large PR                                                         |
| **Remove unused `FilesPanel.tsx`**                                                              | Delete `src/features/workspace/components/panels/FilesPanel.tsx` and its (unimported) test if present. Pre-existing dead code unrelated to #175.                                                                                                                                                                                                                                                   | trivial PR                                                       |
| **Drop `Sidebar.bottomPane` / `Sidebar.footer` slots from the primitive**                       | Audit consumers; if no one uses them after #175 lands, drop the slots from `Sidebar.tsx` and prune the slot-suppression test cases.                                                                                                                                                                                                                                                                | trivial PR                                                       |
| **Global keyboard shortcuts for tab switching** (Ctrl+1/2/3 / ⌘K-style)                         | New global keybinding handler (likely command-palette-adjacent); each shortcut calls `setActiveTab(...)`.                                                                                                                                                                                                                                                                                          | small PR                                                         |
