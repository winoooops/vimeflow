# DockPanel Refactor — design spec

**Issue:** #166
**Step:** UI Handoff Migration Step 7 (originally "BottomDrawer §4.8 restyle")
**Date:** 2026-05-16

## Goal

Replace `src/features/workspace/components/BottomDrawer.tsx` (Editor + Diff
tabs, bottom-only, 48px tab strip) with a `DockPanel` component matching the
runnable prototype: three tabs (Editor / Diff Viewer / Files), a dock-position
switcher (bottom / left / right), and rounded-chip active-tab styling. The
panel is positionable inside the main canvas, not just bottom-anchored.

## Why now

The original §4.8 spec in `docs/design/handoff/README.md` calls for "Tab strip
at top (28 px) + 26 px peek button when collapsed." A narrow CSS fix on those
two numbers (PR-archive tag `archive/166-narrow-fix`, sha `f789ec0`) was
attempted and reverted on 2026-05-16 because the prototype shows a
substantially richer component — Files tab, a `DockSwitcher` layout group,
rounded-chip tabs, 34px header (not 28px), repositionable in the main canvas.
§4.8 was incomplete; the prototype is the real target.

## Source of truth

Authority order for this work:

1. **Prototype `DockPanel`** — `docs/design/handoff/prototype/src/views.jsx:1055-1190`.
   Renders the tab strip + content + collapse caret, and (via
   `views.jsx:1148-1154`) embeds the layout-switcher subcomponent below.
2. **Prototype `DockSwitcher`** — `docs/design/handoff/prototype/src/splitview.jsx:757-804`.
   This is the actual layout button group visible in the issue screenshot
   (DockPanel renders `<window.DockSwitcher position={…} onPick={…} compact />`,
   not the separately-exported `DockPositionMenu` in `views.jsx:1193-1241` —
   that one is an alternate variant the prototype defines but doesn't wire
   into DockPanel). Button glyphs come from `DockGlyph`
   (`splitview.jsx:806+`). Online preview:
   https://claude.ai/design/p/e9c4e751-f5ca-40eb-9ce7-611948803ce4
3. **Prototype state-wiring** — `docs/design/handoff/prototype/src/app.jsx:340-517`
   shows how `dockPosition` / `bottomPanelOpen` / `dockSize` drive layout
   reactivity: outer flex-direction (column/row), terminal/dock flex ratio,
   `dockBefore` order (`pos === 'top' || pos === 'left'`), AND the closed-state
   peek button rendering for both vertical and side docks.
4. **UNIFIED.md** — still the 5-zone layout authority (icon rail · sidebar ·
   main canvas · activity panel · status bar). DockPanel lives **inside** the
   main canvas; this work does NOT re-open the 5-zone debate.
5. **handoff/README.md §4.8** — superseded for sizing/structure. Cited only
   for historical context.

## State domain for `dockPosition`

The prototype's `dockPosition` admits five values (`'bottom' | 'top' | 'left' |
'right' | 'hidden'`), but the user-visible `DockSwitcher` in `compact` mode
(which is what DockPanel renders) **excludes `hidden`** and never shows `top`
— it offers only `bottom` / `left` / `right`. We mirror that user surface:

- **Implementation `dockPosition`:** `'bottom' | 'left' | 'right'`. No `top`,
  no `hidden`.
- **Show/hide** is a separate boolean **`isDockOpen`** (mirrors the
  prototype's `bottomPanelOpen` but renamed to match the new component
  name). State shape is locked here — §5 covers wiring, not naming.
- **`top` dock** is treated as a deferred prototype artifact; not implemented
  in this PR. Tracked in the "Out of scope" subsection.

## Scope

### In scope (this PR)

- **Rename** `src/features/workspace/components/BottomDrawer.tsx` →
  `src/features/workspace/components/DockPanel.tsx`, paired with the
  test file (`BottomDrawer.test.tsx` → `DockPanel.test.tsx`). Verified
  import / mock / reference sites (`grep -rln "BottomDrawer\|bottom-drawer"
src/features/workspace/`):
  - **1 import** — `WorkspaceView.tsx:22`.
  - **2 `vi.mock` sites** — `WorkspaceView.command-palette.test.tsx:41`,
    `WorkspaceView.subscription.test.tsx:182`.
  - **4 string-mention sites** that name BottomDrawer in assertions or
    comments without mocking — `WorkspaceView.test.tsx`,
    `WorkspaceView.visual.test.tsx`, `WorkspaceView.integration.test.tsx`,
    `WorkspaceView.verification.test.tsx`. Each needs the same
    rename treatment.
  - **`WorkspaceView.notifyInfo.test.tsx`** has no references — skip.

  Total: 9 file edits (2 renames + 1 import + 2 mocks + 4 mention sites).

- **Three tabs**: `Editor`, `Diff Viewer`, **`Files`** (new). The Files tab
  is wired to a new `DockFilesPanel` component (see §4); we do NOT reuse
  the sidebar's existing `FilesPanel.tsx` directly because that component
  is shaped for the 272 px sidebar context, not a full-width dock pane.
- **`DockSwitcher` subcomponent** (mirrors the prototype's
  `splitview.jsx:757-804` shape but lives in our codebase). Three glyph
  buttons (bottom / left / right). Active state styling per prototype.
- **Global state additions in `WorkspaceView`**: `dockPosition`,
  `isDockOpen`. Sizes default to fixed initial values (left/right
  horizontal resize is deferred — see "Out of scope").
- **Reactive outer-canvas layout**: WorkspaceView's main-canvas flex
  container switches `flex-direction` (column for `'bottom'`, row for
  `'left'`/`'right'`) and dock order (`dockBefore` for `'left'`).
- **Edge-aware closed-state peek button**: when `!isDockOpen`, render
  a 26 px-thick button along the edge of the terminal facing the
  collapsed dock. Glyph follows the prototype convention:
  - **`bottom` dock collapsed** → peek at terminal's bottom edge, glyph
    `▴` (or material `expand_less`), label `show panel`.
  - **`left` dock collapsed** → peek at terminal's left edge, glyph
    `chevron_left`, label hidden or vertically oriented.
  - **`right` dock collapsed** → peek at terminal's right edge, glyph
    `chevron_right`, label hidden or vertically oriented.
    Vertical-edge variants ship icon-only in v1; vertical text layout is
    a polish ticket. Label was previously `▴ show editor & diff` but is
    now `show panel` to reflect the third (Files) tab.
- **Active-tab styling**: rounded chip (bg `rgba(226,199,255,0.08)`,
  1 px border `rgba(203,166,247,0.3)`, color `#e2c7ff`, 26 px tall,
  `border-radius: 6px`, `JetBrains Mono` 10.5px). Replaces the current
  `border-b-2` underline.
- **Header**: 34 px, bg `#0d0d1c`, 1 px bottom border `rgba(74,68,79,0.25)`,
  padding `0 8px`, gap `4px`.
- **Test refactor**: `BottomDrawer.test.tsx` → `DockPanel.test.tsx`. New
  test files: `DockSwitcher.test.tsx`, `DockFilesPanel.test.tsx`. Existing
  `WorkspaceView.*.test.tsx` mocks of `BottomDrawer` updated to `DockPanel`.

### Renames + import-site updates

The complete inventory is enumerated in §In scope above (9 file edits total).
Variable renames inside `WorkspaceView.tsx` worth calling out:

- `bottomDrawerTab` → `dockTab`
- `setBottomDrawerTab` → `setDockTab`
- `isBottomDrawerCollapsed` → `!isDockOpen` (state-shape flip — see §State
  domain for `dockPosition`)
- `setIsBottomDrawerCollapsed` → `setIsDockOpen` (with semantics flipped:
  the new boolean is the open-not-closed sense)

### Out of scope (deferred to follow-up issues)

- **`top` dock position** — `DockSwitcher` in compact mode doesn't expose
  it; the prototype's `app.jsx` tolerates `'top'` but no UI emits it.
  Open a separate issue if/when needed.
- **Horizontal resize when docked left/right** — `useResizable` is
  vertical-only. Side docks ship with a fixed initial width (e.g. 40%)
  in v1; horizontal resize is a follow-up.
- **Persisting `dockPosition` across sessions** — first version reads
  default `'bottom'` on mount and forgets on reload.
- **Dock-position keyboard shortcuts** — separate keymap ticket
  (#177-family).
- **`DockPositionMenu` (the non-compact prototype variant with the
  `Hidden` button)** — DockSwitcher compact mode is enough for v1.

## DockPanel — component contract

### Props

```tsx
type DockPosition = 'bottom' | 'left' | 'right'
type DockTab = 'editor' | 'diff' | 'files'

interface DockPanelBaseProps {
  /** Which edge of the main canvas the panel docks to. */
  position: DockPosition

  /** Active content tab. */
  tab: DockTab
  /** Tab-change callback (controlled). */
  onTabChange: (tab: DockTab) => void

  /** Layout-switcher pick callback. Caller updates `position`. */
  onPositionChange: (position: DockPosition) => void

  /** Collapse callback. Caller flips `isDockOpen` to false. */
  onClose: () => void

  /** Existing BottomDrawer props that survive the rename. */
  selectedFilePath: string | null
  content: string
  onContentChange?: (content: string) => void
  onSave?: () => void
  isDirty?: boolean
  isLoading?: boolean
  cwd?: string
  gitStatus?: UseGitStatusReturn

  /** New for Files tab. Forwarded to DockFilesPanel as `onFileSelect`.
   *  Signature matches WorkspaceView's existing guarded handler. */
  filesOnFileSelect: (node: { id: string; type: 'file' | 'folder' }) => void
}
type SelectedDiffControl =
  | { selectedDiffFile?: undefined; onSelectedDiffFileChange?: undefined }
  | {
      selectedDiffFile: SelectedDiffFile | null
      onSelectedDiffFileChange: (file: SelectedDiffFile | null) => void
    }
type DockPanelProps = DockPanelBaseProps & SelectedDiffControl
```

The `SelectedDiffControl` discriminated union preserves the existing
BottomDrawer invariant: callers either pass BOTH `selectedDiffFile` and
`onSelectedDiffFileChange` (controlled) or NEITHER (uncontrolled fallback
inside `DiffPanelContent`). Splitting them into two independent optionals
would let a caller pass `selectedDiffFile` without its setter and silently
freeze the diff selection — the existing test in
`BottomDrawer.test.tsx:300-345` (lines for the two render branches) catches
this regression today and must keep doing so after the rename.

The component is **fully controlled** for `tab` and `position` — there is no
uncontrolled-fallback variant. (BottomDrawer had discriminated-union
controlled/uncontrolled pairs; DockPanel drops the uncontrolled side because
every call site already feeds controlled props from WorkspaceView. Simpler
type, smaller surface area.)

### Structure

```
<section data-testid="dock-panel" data-position={position}>
  ├─ Header (34 px, bg #0d0d1c, border facing terminal)
  │    ├─ Tab strip (left, gap 4)
  │    │     ├─ Editor   (rounded chip)
  │    │     ├─ Diff Viewer
  │    │     └─ Files
  │    ├─ Spacer (flex: 1)
  │    ├─ DockSwitcher (compact, mr-1)
  │    └─ Close button (24×24, collapse caret icon by position)
  └─ Content area (flex: 1)
       ├─ Editor → CodeEditor
       ├─ Diff → DiffPanelContent
       └─ Files → DockFilesPanel  (§4)
```

### Visual tokens (mirror prototype exactly)

- **Panel container**: bg `#121221`, `display: flex`, `flex-direction: column`.
  Border faces terminal — `border-top` for `position=bottom`,
  `border-right` for `left`, `border-left` for `right`. Color
  `rgba(74,68,79,0.3)`.
- **Sizing**:
  - `position === 'bottom'` → height driven by the **lifted** `useResizable`
    hook. State is **lifted to WorkspaceView** as `dockBottomHeight: number`
    - `setDockBottomHeight` so the user's resized height survives a
      close/reopen cycle (the previous `BottomDrawer` collapsed in place via
      `effectiveHeight`, so the height never had to survive unmount; the new
      DockPanel unmounts on close — see DockPeekButton — so we have to lift).
      Range: 150-640 px (matches the existing BottomDrawer `DRAWER_MIN=150`,
      not 200 as a draft note erroneously had); default 400 px.
  - `position === 'left' | 'right'` → `flex: 0 0 40%` (fixed 40% width).
    Horizontal resize is deferred (see "Out of scope"); the 40% literal
    lives in `DockPanel.tsx` as a `SIDE_DOCK_BASIS = '40%'` constant
    that the follow-up resize PR will replace with a `dockSize` prop.
- **Header**: height 34, bg `#0d0d1c`, `border-bottom: 1px solid rgba(74,68,79,0.25)`,
  padding `0 8px`, gap 4.
- **Tab button (chip)**:
  - Height 26, padding `0 11px`, `border-radius: 6px`.
  - Font `'JetBrains Mono', monospace`, size 10.5 (use `text-[10.5px]`).
  - Inactive: bg transparent, border `1px solid transparent`, color `#8a8299`.
    Icon 12 px, color `#6c7086`.
  - Active: bg `rgba(226,199,255,0.08)`, border `1px solid rgba(203,166,247,0.3)`,
    color `#e2c7ff`. Icon color `#cba6f7`.
- **Close button** (rightmost): 24×24, `border-radius: 5px`, transparent bg,
  color `#8a8299`. Icon size 14. Glyph by position:
  - `position=bottom` → `expand_more`
  - `position=left` → `chevron_left`
  - `position=right` → `chevron_right`
  - Hover: bg `rgba(255,255,255,0.05)`, color `#e2c7ff`.

## DockSwitcher — component contract

A separate file `src/features/workspace/components/DockSwitcher.tsx`
mirrors the prototype's `splitview.jsx:757-804` shape (compact mode only —
the user-visible variant the prototype uses).

### Props

```tsx
interface DockSwitcherProps {
  position: DockPosition
  onPick: (next: DockPosition) => void
}
```

Compact-only: the v1 component does not expose a `compact` prop. If we
ever need the non-compact (Hidden-included) variant, add the prop then.

### Visual

- Container: `inline-flex`, gap 2, padding 3, bg `rgba(13,13,28,0.6)`,
  border `1px solid rgba(74,68,79,0.3)`, `border-radius: 8px`.
- Each button: 26×22, `border-radius: 5px`, `cursor: pointer`.
  - Active (`position === o.id`): bg `rgba(203,166,247,0.15)`,
    border `1px solid rgba(203,166,247,0.45)`, color `#cba6f7`.
  - Inactive: bg transparent, border `1px solid transparent`, color `#8a8299`.
- Glyph: `DockGlyph` SVG mirroring `splitview.jsx:806+`. We port the SVG
  directly. Three glyphs only (no `hidden`).
- Title attribute: `Dock: ${label}` for tooltip accessibility.

### Glyph implementation

Port the prototype's `DockGlyph` (`splitview.jsx:806+`) verbatim as a
local `<DockGlyph position={...} />` in `DockSwitcher.tsx`. Three cases:
`bottom`, `left`, `right`. The function is ~30 lines of inline SVG; do
not over-engineer (no glyph component library, no separate file).

Sketch (mirror this shape — strip the `hidden` case):

```tsx
const DockGlyph = ({ position }: { position: DockPosition }): ReactElement => {
  const sw = 1.4
  const r = 1.4
  // 14×11 viewBox; outer 12×9 rect at (1,1); a shaded sub-rect represents the dock side.
  const subRect =
    position === 'bottom'
      ? { x: 2, y: 6.5, width: 10, height: 3 }
      : position === 'left'
        ? { x: 2, y: 2, width: 4, height: 7 }
        : /* right */ { x: 8, y: 2, width: 4, height: 7 }

  return (
    <svg width="14" height="11" viewBox="0 0 14 11">
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
      <rect {...subRect} rx={0.6} fill="currentColor" opacity={0.55} />
    </svg>
  )
}
```

The implementer copies the prototype's exact sub-rect coordinates for
`left` and `right` from `splitview.jsx:851-905`. The sketch above is
illustrative — not a binding contract on every coordinate.

## State model

### New global state in `WorkspaceView`

```tsx
type DockPosition = 'bottom' | 'left' | 'right'
type DockTab = 'editor' | 'diff' | 'files'

// Inside WorkspaceView:
const [dockPosition, setDockPosition] = useState<DockPosition>('bottom')
const [isDockOpen, setIsDockOpen] = useState(true)
const [dockTab, setDockTab] = useState<DockTab>('editor')

// Bottom-dock height is lifted so it survives DockPanel unmount on close.
// `useResizable` returns `{ size, isDragging, handleMouseDown, adjustBy }`;
// we pass `size` and `setSize`/`adjustBy` into DockPanel as controlled props.
const dockHeightResize = useResizable({
  initial: 400,
  min: 150,
  max: 640,
  direction: 'vertical',
  invert: true,
})
```

Horizontal dock size (`dockSize` in the prototype, `flex: 0 0 40%` here) is
**not lifted in v1** — side docks use a fixed 40% width and have no resize
handle. Lifting `dockSize` is a follow-up for the horizontal-resize work
called out under "Out of scope."

### Main-canvas layout reactivity

The current `WorkspaceView.tsx:638-681` renders `Tabs`, `TerminalZone`,
and `BottomDrawer` as direct children of one column flex container. The
session-tab strip must stay above the dock-position shuffle — only the
terminal-plus-dock pair gets the column/row flip.

Solution: introduce an **inner flex wrapper** below `Tabs` that hosts
TerminalZone + DockPanel + DockPeekButton, and apply
`flex-direction` + `dockBefore` ordering only inside that wrapper:

```tsx
const isVertical = dockPosition === 'bottom'   // (top excluded in v1)
const flexDir: CSSProperties['flexDirection'] = isVertical ? 'column' : 'row'
const dockBefore = dockPosition === 'left'     // mirrors app.jsx:352

// JSX (inside the existing relative flex-col container, after <Tabs />):
<div
  className="flex flex-1 min-h-0 min-w-0 overflow-hidden"
  style={{ flexDirection: flexDir }}
>
  {dockBefore && isDockOpen && <DockPanel position={dockPosition} ... />}
  {dockBefore && !isDockOpen && (
    <DockPeekButton position={dockPosition} onOpen={openDock} />
  )}

  {/* TerminalZone wrapper — must include min-w-0 alongside min-h-0
      so that side-dock row flex doesn't let the terminal expand past
      its 60% remaining basis and squeeze the dock out of its 40%. */}
  <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
    <TerminalZone ... />
  </div>

  {!dockBefore && isDockOpen && <DockPanel position={dockPosition} ... />}
  {!dockBefore && !isDockOpen && (
    <DockPeekButton position={dockPosition} onOpen={openDock} />
  )}
</div>
```

The peek button participates in the same `dockBefore` ordering as the open
DockPanel: for `dockPosition === 'left'`, it sits on the terminal's left
edge (so clicking it expands the dock back out to the left). For `right`
and `bottom`, it sits after TerminalZone.

## DockFilesPanel — new docked Files tab

`src/features/workspace/components/panels/DockFilesPanel.tsx`. Separate
from the sidebar's `FilesPanel.tsx` (which is shaped for the 272 px
sidebar context). The docked variant:

- Uses the full panel width — no 272 px constraint.
- Shares the underlying `FileTree` component
  (`src/features/files/components/FileTree.tsx`) for the actual tree
  rendering. Only the wrapper / context-menu actions differ.
- Initial implementation: same data source as `FilesPanel.tsx`
  (`mockFileTree` from `src/features/files/data/mockFileTree.ts`).
  Future PR wires it to the real filesystem service.

### Props + file-open callback path

```tsx
interface DockFilesPanelProps {
  /** Fires when the user activates a file (click / Enter).
   *  Signature matches WorkspaceView's `handleFileSelect`: `node.id`
   *  must be the **full filesystem path**, not the FileTree internal
   *  stable ID (which is just the leaf name, e.g. `node-auth-ts`).
   *  See "Path mapping" below. */
  onFileSelect: (node: { id: string; type: 'file' | 'folder' }) => void
}
```

### Path mapping

`FileTree` (the shared rendering primitive) emits
`onNodeSelect: (node, fullPath) => void` where `node.id` is the leaf
name and `fullPath` is the resolved filesystem path. `WorkspaceView`'s
`handleFileSelect` expects `node.id` to BE the filesystem path
(it does `const filePath = node.id`).

`DockFilesPanel` MUST bridge the two by mirroring the sidebar
`FilesPanel` pattern (`FilesPanel.tsx:27-28`):

```tsx
<FileTree
  nodes={...}
  contextMenuActions={...}
  onNodeSelect={(node, fullPath) =>
    onFileSelect({ ...node, id: fullPath })
  }
/>
```

If `DockFilesPanel` forwards the raw `node` without remapping `id`,
the dirty-state guard in `handleFileSelect` runs against a bogus path
and `openFileSafely` fails. The mock-tree case is identical: the
mock IDs are stable strings like `'node-auth-ts'`, and the spec test
`'click on a leaf file calls onFileSelect with the node'` asserts the
remapped `{ ...node, id: fullPath }` payload, not the raw node.

`WorkspaceView` passes its existing **`handleFileSelect`** (the
unsaved-changes-guarded handler at `WorkspaceView.tsx:401-420` already
wired to the sidebar `<FileExplorer onFileSelect={handleFileSelect} />`)
as `onFileSelect`. Concretely:

```tsx
<DockPanel
  ...
  filesOnFileSelect={handleFileSelect}
/>
```

`handleFileSelect` takes `{ id, type }`, checks for unsaved changes via
`editorBuffer.isDirty`, and either shows the unsaved-changes dialog or
calls `openFileSafely(filePath)`. DockPanel forwards `filesOnFileSelect`
to `<DockFilesPanel onFileSelect={...} />` when the active tab is
`files`. This preserves the existing unsaved-changes dialog flow —
clicking a file in the docked tree triggers the same guard as clicking
in the sidebar tree. The raw `openFileSafely` is **not** used directly
here because it bypasses the dirty-state check.

Tests live alongside as `DockFilesPanel.test.tsx`.

## Closed-state peek button — `DockPeekButton`

A small sibling component, not part of DockPanel itself (DockPanel
unmounts when closed). Lives next to TerminalZone in WorkspaceView's
render.

### Shape

```tsx
interface DockPeekButtonProps {
  position: DockPosition
  onOpen: () => void
}
```

### Visual

- 26 px on the edge facing the collapsed dock.
- Glyph by position:
  - `position=bottom` → up-arrow (`expand_less` material icon).
  - `position=left` → `chevron_left` (panel will fly out from the left).
  - `position=right` → `chevron_right`.
- Color `#8a8299`, hover bg `rgba(203,166,247,0.10)`, hover color
  `#e2c7ff`.
- Border facing terminal (`border-top` for bottom-dock peek,
  `border-right` for left-dock peek, `border-left` for right-dock peek).
- For `bottom`: full-width, 26 × \*, label `show panel` (left-aligned,
  padding `0 14px`, JetBrains Mono 10.5).
- For `left` / `right`: full-height, \* × 26, icon-only in v1
  (vertical text layout is a polish ticket).

### `aria-label`

- bottom: `"Show panel"`
- left: `"Show panel docked left"`
- right: `"Show panel docked right"`

The labels disambiguate for screen readers when only the glyph differs.

## Test strategy

TDD ordering per `rules/typescript/testing/CLAUDE.md`. Tests go RED first,
implementation goes GREEN, then refactor.

### `DockPanel.test.tsx` (replaces `BottomDrawer.test.tsx`)

Carry forward the existing BottomDrawer tests that still make sense
under the fully-controlled contract, with renames. The uncontrolled
fallback assertions go away — they have no behavior in the new
component.

**Kept (with rename / minor adjustment):**

- Tab switching via controlled `tab` + `onTabChange` (the existing
  "Controlled mode" `describe` block).
- DiffPanelContent gitStatus pass-through (both render-branch tests).
- Selected file path + CodeEditor wiring.
- `selectedDiffFile` + `onSelectedDiffFileChange` discriminated-union
  enforcement (TypeScript-level — the test asserting the controlled
  pair is preserved verbatim under the new name).
- Resize-handle render + mouseDown integration (only when
  `position === 'bottom'`).
- Material Symbols icon presence for each tab.

**Dropped (no longer valid under controlled-only contract):**

- `'renders with Editor tab active by default'` — uncontrolled default.
- `'switches to Diff Viewer tab when clicked'` (uncontrolled flow).
- `'uncontrolled fallback: activeTab works without controlled props'`.
- `'uncontrolled fallback: isCollapsed works without controlled props'`.
- `'expanded tab strip is 28px tall (h-7)'` — superseded by the 34 px
  assertion below.
- 26 px peek-bar assertions — moved to `DockPeekButton.test.tsx`.

**New (added with this PR):**

- `renders header at 34 px tall` (assert the wrapping `<div>` has
  `h-[34px]`).
- `renders 3 tabs: Editor / Diff Viewer / Files`
  (`getAllByRole('tab').length === 3`).
- `active tab uses rounded-chip styling` — assert the active tab has
  the Tailwind classes that map to the prototype's
  `rgba(226,199,255,0.08)` bg + `rgba(203,166,247,0.3)` border.
  Note: Tailwind's `bg-primary-container/10` maps to
  `rgba(203,166,247,0.10)`, which is **not** the prototype token; the
  custom rgba is added as a new token in `tailwind.config.js` (call it
  `tab-chip-bg` or use an arbitrary-value class). The test asserts
  whichever class the implementation picks.
- `inactive tab has transparent border` (1 px border, color
  `rgba(0,0,0,0)`).
- `data-position attribute reflects position prop` — three cases.
- `Files tab routes to DockFilesPanel, not CodeEditor` —
  render with `tab="files"` (controlled), assert
  `getByTestId('dock-files-panel')`. Note: because `tab` is fully
  controlled, the test renders directly with the desired tab — there
  is no click-to-switch flow inside DockPanel itself. A separate
  test asserts that clicking the Files tab calls
  `onTabChange('files')`.
- `forwards filesOnFileSelect to DockFilesPanel when tab=files` —
  mock DockFilesPanel; assert the prop arrives identity-equal.

### `DockSwitcher.test.tsx` (new)

- `renders 3 buttons: bottom / left / right`
- `active button has lavender border styling`
- `clicking a button calls onPick with that position`
- `each button has Dock: <Label> tooltip via title attribute`
- `does not render a Hidden button` (compact-only invariant)

### `DockPeekButton.test.tsx` (new)

- `renders 'show panel' label and expand_less icon for position=bottom`
- `renders chevron_left icon (no label) for position=left`
- `renders chevron_right icon (no label) for position=right`
- `aria-label varies by position` (3 cases)
- `clicking calls onOpen`

### `DockFilesPanel.test.tsx` (new)

- `renders the file tree`
- `click on a leaf file calls onFileSelect with the node`
- `does NOT call onFileSelect when clicking a directory expander`
  (mirrors sidebar `FilesPanel.test.tsx` semantics).

### `WorkspaceView.*.test.tsx` updates

- Rename `BottomDrawer` mocks/strings → `DockPanel` in:
  `WorkspaceView.test.tsx`, `WorkspaceView.command-palette.test.tsx`,
  `WorkspaceView.subscription.test.tsx`, `WorkspaceView.integration.test.tsx`,
  `WorkspaceView.verification.test.tsx`, `WorkspaceView.visual.test.tsx`.
- Add a new test in `WorkspaceView.test.tsx`:
  `'dockPosition=left swaps DockPanel before TerminalZone'`.
- Add: `'!isDockOpen + dockPosition=left renders DockPeekButton on terminal left edge'`.

## Implementation plan

Ordered commits inside the PR. Each is its own commit so review can
follow the steps.

1. `refactor(workspace): rename BottomDrawer.tsx → DockPanel.tsx`
   (pure rename + import-site sweep, no behavior change). All 9 file
   edits enumerated in §Scope. Tests pass unchanged at this stage.
2. `feat(dock-panel): lift dock state into WorkspaceView`
   — introduces `dockPosition` / `isDockOpen` / `dockTab` in
   `WorkspaceView`, threads through DockPanel. No layout change yet
   (`dockPosition` is always `'bottom'`).
3. `feat(dock-panel): restyle header to 34px + rounded-chip tabs`
   — visual-only commit. Updates DockPanel.tsx + DockPanel.test.tsx.
4. `feat(dock-panel): add Files tab + DockFilesPanel`
   — new file + new tab + WorkspaceView wiring `filesOnFileSelect`.
5. `feat(dock-switcher): add DockSwitcher subcomponent`
   — new component + tests, not yet rendered in DockPanel.
6. `feat(dock-panel): mount DockSwitcher in DockPanel header`
   — wires DockSwitcher between tab strip and close button, but
   `onPositionChange` is a no-op for now.
7. `feat(workspace): make main canvas react to dockPosition`
   — adds the inner flex wrapper, `flex-direction` swap, `dockBefore`
   ordering. DockSwitcher now actually moves the panel.
8. `feat(dock-peek): add DockPeekButton + render when !isDockOpen`
   — new component + tests + WorkspaceView wiring for all 3 positions.

Last 3 commits unlock the side-dock UX; 1-4 are foundational.

## Risks + mitigations

- **`xterm`'s FitAddon mis-fits when its parent flex-direction flips.**
  The Terminal needs a `ResizeObserver`-triggered fit after the layout
  switch. Verify by docking left/right at runtime and checking the
  terminal isn't clipped. If broken, gate the layout flip with a
  `requestAnimationFrame` so xterm sees the new container before
  measuring.
- **`useResizable`-driven drag handle is vertical-only.** Side docks
  must NOT render the drag handle (it would mutate a `height` state
  that no longer drives the panel). Gate `<div data-testid="resize-handle"...>`
  on `position === 'bottom'`.
- **Test-mock regression risk.** Tests that `vi.mock('./components/BottomDrawer')`
  will silently keep passing after rename if the mock path string is
  not updated. Mitigation: each of the 6 reference sites is enumerated
  in §Scope; verify in commit 1 by running `vitest run` after the
  rename.
- **Visual diff vs prototype.** Final cycle should screenshot the
  rendered app against `https://claude.ai/design/p/e9c4e751-...` to
  catch token drift (esp. the `rgba(...)` borders that don't map
  cleanly to Tailwind defaults — they go in `tailwind.config.js`).
