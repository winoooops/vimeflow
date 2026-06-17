# BrowserPane Overlay Hierarchy — PR1 Plan

> **For agentic workers:** this is PR1 in the `feat/browser-pane-overlay-hierarchy`
> umbrella stack. PR1 is planning + accepted decision docs only. Implementation PRs
> stack after this branch lands into the umbrella branch.

**Linear:** VIM-129 — BrowserPane overlay hierarchy (epic)

**Umbrella branch:** `feat/browser-pane-overlay-hierarchy`

**PR1 branch:** `feat/browser-pane-overlay-hierarchy-pr1-plan`

**Goal:** Replace the parent-maintained BrowserPane overlay gate
(`areBrowserPanesOccluded`) with a shared workspace overlay/native-surface
hierarchy, while preserving the working Electron `WebContentsView` browser host.

## Decision

Accepted decision record:

- `docs/decisions/2026-06-15-browser-pane-overlay-hierarchy.html`
- `docs/decisions/2026-06-15-browser-pane-overlay-hierarchy.zh-CN.html`

The decision keeps technical API terms in English in both versions:
`BrowserPane`, `WebContentsView`, `overlay`, `native view`, `OverlayStackProvider`,
`IPC`, `renderer`, `main process`, and `IDEA`.

## Stack

### PR1 — decision docs + stack plan

Target: `feat/browser-pane-overlay-hierarchy`

Files:

- Move the English and zh-CN technical notes into `docs/decisions/`.
- Add the decision index entry in `docs/decisions/CLAUDE.md`.
- Add this plan document.
- Create/link the Linear epic and attach branch-scoped GitHub links to both
  decision HTML files.

Verification:

- `npx prettier --check docs/decisions/2026-06-15-browser-pane-overlay-hierarchy.html docs/decisions/2026-06-15-browser-pane-overlay-hierarchy.zh-CN.html docs/decisions/CLAUDE.md docs/superpowers/plans/2026-06-15-browser-pane-overlay-hierarchy-pr1.md`
- `npm --ignore-scripts run format:check`
- `npm --ignore-scripts run lint`

### PR2 — overlay stack substrate

Target: `feat/browser-pane-overlay-hierarchy`

Files:

- Create `src/features/workspace/overlays/OverlayStackProvider.tsx`.
- Create `src/features/workspace/overlays/useOverlayRegistration.ts`.
- Create `src/features/workspace/overlays/useNativeSurface.ts`.
- Create co-located tests for plane ordering, descriptor lifecycle, rect
  intersection, global occlusion, and unregister cleanup.

Contracts:

```ts
type OverlayPlane =
  | 'pane-chrome'
  | 'popover'
  | 'dialog'
  | 'palette'
  | 'drag'
  | 'toast'

type NativeOcclusionPolicy = 'none' | 'intersects' | 'global'

interface OverlayDescriptor {
  id: string
  plane: OverlayPlane
  isOpen: boolean
  nativeOcclusion: NativeOcclusionPolicy
  getRect?: () => DOMRectReadOnly | null
}

interface NativeSurfaceDescriptor {
  id: string
  owner: 'browser-pane'
  getRect: () => DOMRectReadOnly | null
  belowPlane: OverlayPlane
}
```

Verification:

- `npx vitest run src/features/workspace/overlays`
- `npm run lint`
- `npm run type-check`

### PR3 — register existing overlay sources

Target: `feat/browser-pane-overlay-hierarchy`

Overlay sources to register:

- `CommandPalette` as `{ plane: 'palette', nativeOcclusion: 'global' }`.
- `UnsavedChangesDialog` as `{ plane: 'dialog', nativeOcclusion: 'global' }`.
- Burner terminal popup as `{ plane: 'dialog', nativeOcclusion: 'global' }`.
- Pane rename overlay as `{ plane: 'popover', nativeOcclusion: 'intersects' }`.
- Workspace drag covers as `{ plane: 'drag', nativeOcclusion: 'global' }`.
- File error / info banners as `{ plane: 'toast', nativeOcclusion: 'intersects' }`.

Verification:

- Existing component tests updated to assert registration when open and cleanup when
  closed/unmounted.
- `npm run lint`
- `npm run type-check`
- Focused Vitest files for touched components.

### PR4 — convert BrowserPane to a native-surface subscriber

Target: `feat/browser-pane-overlay-hierarchy`

Scope:

- Remove `areBrowserPanesOccluded` from `WorkspaceView`, `TerminalZone`, and
  `SplitView`.
- Register the BrowserPane page region through `useNativeSurface()`.
- Use derived `nativeSurface.occluded` inside `BrowserPane.syncBounds()`.
- Keep `setBrowserPaneBounds()` and `BrowserPaneController.applyRecordBounds()` as
  the main-process projection boundary.
- Preserve existing focus guards and active-tab bounds behavior.

Verification:

- `BrowserPane.test.tsx` covers `visible: false` when the native surface is
  occluded and `visible: true` when it clears.
- Tests prove inactive panes and inactive browser tabs remain hidden by the existing
  active-tab projection.
- `npm run lint`
- `npm run type-check`
- `npx vitest run src/features/browser/components/BrowserPane.test.tsx src/features/workspace/components/TerminalZone.test.tsx src/features/terminal/components/SplitView/SplitView.test.tsx`

### PR5 — Electron/native integration verification

Target: `feat/browser-pane-overlay-hierarchy`

Scope:

- Add or extend Electron integration coverage for a real `WebContentsView` browser
  pane under at least one DOM overlay.
- Verify command palette, unsaved dialog, burner popup, drag cover, and banner
  behavior in the running app.
- Decide, with evidence, whether `view.setVisible(false)` should replace or augment
  zero-bounds hiding in `BrowserPaneController`.

Verification:

- Electron test or e2e smoke proving a DOM overlay hides native browser content.
- Manual screenshot checklist for one active BrowserPane with command palette open
  and one with overlay closed.
- `npm run lint`
- `npm run type-check`
- Relevant Electron/e2e test command documented in the PR body.

## Guardrails

- Do not move BrowserPane to `<webview>`.
- Do not implement offscreen rendering for the durable browser pane.
- Do not add new `@floating-ui/react` imports outside the existing allowed
  component boundary.
- Do not make new overlay sources edit a BrowserPane-specific list.
- Keep all `WebContentsView` permission/navigation/popup hardening in main process.

## PR1 Done Criteria

- VIM-129 exists and links to both decision HTML files.
- The decision docs live under `docs/decisions/`.
- `docs/decisions/CLAUDE.md` indexes the decision.
- This stack plan exists.
- Formatting and lint checks pass for the docs/planning change set.
