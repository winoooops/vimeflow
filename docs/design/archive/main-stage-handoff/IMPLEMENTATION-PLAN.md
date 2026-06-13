# Main Stage Handoff Implementation Plan

## Stack Context

- Worktree: `worktrees/main-stage-handoff`
- Branch: `feat/main-stage-handoff`
- Stack base: `feat/vim-66-sidebar` at `d6066fa8`
- Target production file today: `src/features/workspace/WorkspaceView.tsx`
- Handoff source: `docs/design/main-stage-handoff/MAIN-STAGE-MIGRATION.md`
- Visual demo: `docs/design/main-stage-handoff/main-stage-demo.html`

The handoff names `src/app.jsx`, but this repository has already migrated the
workspace shell to `WorkspaceView.tsx`. The implementation should translate the
same visual contract onto the current VIM-66 sidebar branch instead of reviving
the older app shell shape.

## 100% Repetition Jobs

| ID  | Job                                                | App Target                                    | Acceptance                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| J0  | Preserve handoff and prototype                     | `docs/design/main-stage-handoff/`             | Static demo opens directly to the approved main-stage chrome without a separate preview-toggle harness.                                                                                                                                                                                                                                                            |
| J1  | Introduce floating stage wrapper                   | `WorkspaceView.tsx`                           | Sidebar remains flush; `main` and activity panel are wrapped together; open sidebar yields 14px left radii, clipped children, and sidebar-colored parent/background filling the clipped corners; collapsed sidebar yields square, shadowless, edge-to-edge stage.                                                                                                  |
| J2  | Remove main session-tab strip from the chrome path | `WorkspaceView.tsx`, tests                    | Main view no longer renders the horizontal session tab row; session switching remains sidebar-owned; new-session entry remains available from sidebar.                                                                                                                                                                                                             |
| J3  | Move layout controls into the 44px top chrome bar  | `WorkspaceView.tsx`, `TerminalZone.tsx`       | `TerminalZone` no longer renders its layout toolbar in the migrated shell; top bar is `#0d0d1c`, 44px, bottom hairline, right-aligned label-free layout pills plus a two-button top action group with one wrapping border; child buttons stay transparent with hover fill only.                                                                                    |
| J3a | Evaluate hover-revealed top chrome                 | `WorkspaceView.tsx`, visual QA                | Candidate interaction: hide the top chrome by default and reveal it as an overlay when the top 44px workspace area is hovered or focused. Add a sticky toggle in the top action group: pinned mode reserves a real 44px row so panes shrink instead of being covered, and should trigger the existing terminal fit path. No changes to `SplitView` pane semantics. |
| J4  | Implement collapsed-sidebar gutter                 | `WorkspaceView.tsx`                           | Collapsed state shows `SidebarToggle` at `left: 12px`, `top: 8px`; top chrome content uses `padding-left: 50px`; expanded state returns to `14px`; no overlap with layout pills.                                                                                                                                                                                   |
| J5  | Implement single-pane top chrome fallback          | `WorkspaceView.tsx`                           | When active layout is `single`, top chrome shows active agent glyph, active session title, and running pulse when live; do not mislabel the layout-display configuration button as a split command.                                                                                                                                                                |
| J6  | Preserve pane layout behavior                      | `WorkspaceView.tsx`, `TerminalZone.tsx`       | Do not change `SplitView` pane layout, pane add/remove, active-pane, or `activeSession.layout` semantics; top chrome only relocates existing layout controls and forwards existing layout picks.                                                                                                                                                                   |
| J6a | Round the floating-stage vertical edge             | `WorkspaceView.tsx`, CSS/test assertions      | The stage edge against the sidebar has rounded left corners and a sidebar-colored parent/background in the clipped corner area. Avoid seam pseudo-elements, detached line segments, translucent overlays, broad gradients, glow, or full-height shadow strips at the junction.                                                                                     |
| J7  | Redesign bottom action/status bar                  | `src/components/StatusBar.tsx`                | 24px bar, `#0d0d1c`, top hairline, command and dock icon actions anchored left, metrics anchored right; action buttons are transparent, borderless, compact icon affordances with hover fill only; brand/version/chip palette hint removed from this chrome treatment.                                                                                             |
| J8  | Add dock toggle state to bottom bar                | `WorkspaceView.tsx`, `StatusBar.tsx`          | Dock button uses icon color, not a persistent filled background, to indicate open/closed state; click closes dock and focuses terminal; click reopens previous dock position/tab and focuses dock.                                                                                                                                                                 |
| J9  | Keep live readouts exact                           | `StatusBar.tsx`, `WorkspaceView.tsx`          | Duration, context smiley, cache percentage with tone mapping, turns, and diff counts render only when backed by data; separators do not show dangling zero-state gaps.                                                                                                                                                                                             |
| J10 | Clip and align activity panel inside stage         | `WorkspaceView.tsx`, agent-status shell tests | Activity panel is a child of the floating stage, keeps current collapse width behavior, and participates in stage clipping/radius.                                                                                                                                                                                                                                 |
| J11 | Update tests for the new ownership model           | Workspace, TerminalZone, StatusBar tests      | Tests cover stage wrapper styles, no session tabs in main, top chrome split/single states, collapsed gutter, bottom actions, dock toggle behavior, and metric conditional rendering.                                                                                                                                                                               |
| J12 | Visual verification pass                           | screenshots / local app                       | Compare the real app against `main-stage-demo.html` at desktop and narrow widths; verify no overlaps, no accidental borders, no one-note palette drift, and correct collapsed-state snap.                                                                                                                                                                          |

## Step-By-Step PR Stack

### PR 0 - Handoff Prototype and Plan

Status: in progress on `feat/main-stage-handoff`.

- Add the static HTML demo.
- Add this implementation plan and backlog.
- Do not touch production React until the visual target is approved.

### PR 1 - Stage Wrapper Only

- Wrap `main` plus the activity panel in a `floating-stage` container.
- Keep existing `Tabs`, `TerminalZone`, and `StatusBar` temporarily.
- Add regression tests for open/collapsed stage radius, shadow, z-index, and
  activity panel child placement.
- This PR should be easy to rebase after `feat/vim-66-sidebar` lands in `main`.

### PR 2 - Top Chrome Ownership

- Replace the session tab strip with the 44px top chrome bar.
- Move `LayoutSwitcher` ownership from `TerminalZone` to `WorkspaceView`.
- Add the icon-only layout-display configuration control next to the layout
  pills; it is not a split-mode button.
- Add a `showLayoutToolbar` escape hatch or remove the toolbar once all callers
  are updated.
- Implement the collapsed 50px gutter and single-pane identity fallback.
- Preserve existing `SplitView` and session layout behavior; this PR changes
  chrome ownership only.
- Update workspace and terminal tests for the new layout-control location.

### PR 3 - Bottom Action Bar

- Extend `StatusBar` for left-side icon actions and right-side live readouts.
- Wire command palette and dock toggle actions from `WorkspaceView`.
- Remove brand/version/palette keyboard-chip segments from this treatment.
- Verify metric separators and zero-data suppression.

### PR 4 - Fidelity and Responsive Hardening

- Run the real app beside `main-stage-demo.html`.
- Tune CSS tokens, shadows, clipping, and narrow-width behavior until the app
  visually repeats the handoff.
- Add or update visual tests around the main workspace shell.
- Update `docs/roadmap/progress.yaml` only after production UI changes land.

### PR 5 - Main Rebase Gate

- After `feat/vim-66-sidebar` is officially in `main`, rebase the stack onto
  `main`.
- Resolve any stale sidebar/test assumptions.
- Run the full relevant test suite before final merge decision.

## Verification Checklist

- `npm run test -- WorkspaceView`
- `npm run test -- TerminalZone`
- `npm run test -- StatusBar`
- `npm run lint`
- `npm run typecheck`
- Manual desktop check: sidebar open, sidebar collapsed, existing split layout,
  existing single layout, dock open, dock closed, activity panel expanded,
  activity rail.
- Manual narrow-width check: no text overlap in the top chrome or bottom bar.
