# DockPanel Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-05-16-dockpanel-refactor-design.md`](../specs/2026-05-16-dockpanel-refactor-design.md)
**Issue:** #166

**Goal:** Replace `BottomDrawer` (Editor + Diff, bottom-only) with a positionable `DockPanel` (Editor / Diff / Files, dockable bottom / left / right) that mirrors the handoff prototype.

**Architecture:** WorkspaceView holds all dock state (`dockPosition`, `isDockOpen`, `dockTab`) **plus the lifted `useResizable` hook for bottom-dock height** so the resized height survives `DockPanel` unmount on close. DockPanel is fully controlled — receives `position`, `tab`, `onTabChange`, `onPositionChange`, `onClose`, controlled height (`bottomHeight` + `bottomHeightResize`); it computes border-side + collapse-icon internally. An inner flex wrapper inside WorkspaceView switches `flex-direction` between `column` (for `'bottom'`) and `row` (for `'left'` / `'right'`) and respects `dockBefore` ordering. When `!isDockOpen`, DockPanel unmounts and a `DockPeekButton` renders on the matching edge.

**Prop-naming contract — locked here, used identically from Task 2 onward:**

- `tab: DockTab` (renamed from `activeTab` — matches spec §DockPanel — component contract).
- `onTabChange: (next: DockTab) => void` — survives the rename.
- `position: DockPosition` — new.
- `onPositionChange: (next: DockPosition) => void` — new.
- `onClose: () => void` — replaces the existing `isCollapsed` + `onCollapsedChange` discriminated pair. DockPanel never reads an `isOpen` prop because it unmounts when closed; `onClose` is the only close-direction signal.
- `bottomHeight: number` — new. Controlled height for bottom-dock; ignored for left/right.
- `onBottomHeightAdjust: (delta: number) => void` — new. Forwards `adjustBy` from the lifted `useResizable` so DockPanel's resize-handle keyboard arrows still work.

**Tech Stack:** TypeScript + React 18, Tailwind CSS, Vitest + Testing Library, ESLint (flat), Prettier, Husky pre-commit + commitlint.

**Tokens (load-bearing — define once, reuse):**

- Active-tab chip bg: `rgba(226,199,255,0.08)` — add as Tailwind arbitrary class `bg-[rgba(226,199,255,0.08)]` (no new config-level token in v1).
- Active-tab chip border: `rgba(203,166,247,0.3)` → `border-[rgba(203,166,247,0.3)]`.
- Active-tab chip color: `#e2c7ff` → `text-[#e2c7ff]`.
- DockSwitcher active bg / border / fg: `rgba(203,166,247,0.15)` / `rgba(203,166,247,0.45)` / `#cba6f7`.
- Panel container bg: `#121221`. Header bg: `#0d0d1c`. Header border: `rgba(74,68,79,0.25)`.

Use arbitrary-value Tailwind classes inline. The spec defers a `tailwind.config.js` token sweep — `Step 10` of the broader UI handoff migration owns it.

---

## File Structure

**Created:**

- `src/features/workspace/components/DockPanel.tsx` — replaces BottomDrawer (full controlled, position-aware)
- `src/features/workspace/components/DockPanel.test.tsx` — replaces BottomDrawer.test.tsx
- `src/features/workspace/components/DockSwitcher.tsx` — 3-button layout-switcher subcomponent
- `src/features/workspace/components/DockSwitcher.test.tsx`
- `src/features/workspace/components/DockPeekButton.tsx` — edge-aware peek when collapsed
- `src/features/workspace/components/DockPeekButton.test.tsx`
- `src/features/workspace/components/panels/DockFilesPanel.tsx` — full-width docked Files tab
- `src/features/workspace/components/panels/DockFilesPanel.test.tsx`

**Deleted (by rename):**

- `src/features/workspace/components/BottomDrawer.tsx`
- `src/features/workspace/components/BottomDrawer.test.tsx`

**Modified:**

- `src/features/workspace/WorkspaceView.tsx` — import, JSX layout, state additions, controlled wiring
- `src/features/workspace/WorkspaceView.test.tsx` — string-mention rename + new layout tests
- `src/features/workspace/WorkspaceView.command-palette.test.tsx` — `vi.mock` path update
- `src/features/workspace/WorkspaceView.subscription.test.tsx` — `vi.mock` path update
- `src/features/workspace/WorkspaceView.visual.test.tsx` — string-mention rename
- `src/features/workspace/WorkspaceView.integration.test.tsx` — string-mention rename
- `src/features/workspace/WorkspaceView.verification.test.tsx` — string-mention rename

---

## Task 1: Rename BottomDrawer → DockPanel (no behavior change)

**Goal:** Pure rename + import-site sweep. All existing tests must still pass.

**Files:**

- Rename: `src/features/workspace/components/BottomDrawer.tsx` → `DockPanel.tsx`
- Rename: `src/features/workspace/components/BottomDrawer.test.tsx` → `DockPanel.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx:22` (import)
- Modify: `src/features/workspace/WorkspaceView.command-palette.test.tsx:41` (`vi.mock` path)
- Modify: `src/features/workspace/WorkspaceView.subscription.test.tsx:182` (`vi.mock` path)
- Modify: `src/features/workspace/WorkspaceView.{test,visual.test,integration.test,verification.test}.tsx` (string mentions)

- [ ] **Step 1.1: Rename the source + test files**

```bash
git mv src/features/workspace/components/BottomDrawer.tsx src/features/workspace/components/DockPanel.tsx
git mv src/features/workspace/components/BottomDrawer.test.tsx src/features/workspace/components/DockPanel.test.tsx
```

- [ ] **Step 1.2: Update the default export name in DockPanel.tsx**

Open `src/features/workspace/components/DockPanel.tsx`. Rename the component constant and its default export:

Find:

```tsx
const BottomDrawer = ({
```

Replace with:

```tsx
const DockPanel = ({
```

At end of file, find:

```tsx
export default BottomDrawer
```

Replace with:

```tsx
export default DockPanel
```

Update the JSDoc above the component:
Find:

```tsx
/**
 * BottomDrawer - Editor and Diff Viewer panel below terminal
```

Replace with:

```tsx
/**
 * DockPanel - Editor and Diff Viewer panel (renamed from BottomDrawer; full
 * position-aware rewrite lands in later tasks of #166).
```

Also rename the `BottomDrawerProps` / `BottomDrawerBaseProps` type aliases:
Find:

```tsx
interface BottomDrawerBaseProps {
```

Replace with:

```tsx
interface DockPanelBaseProps {
```

Find:

```tsx
type BottomDrawerProps = BottomDrawerBaseProps &
```

Replace with:

```tsx
type DockPanelProps = DockPanelBaseProps &
```

Find:

```tsx
}: BottomDrawerProps): ReactElement => {
```

Replace with:

```tsx
}: DockPanelProps): ReactElement => {
```

- [ ] **Step 1.3: Update DockPanel.test.tsx import + describe block**

In `src/features/workspace/components/DockPanel.test.tsx`:

Find:

```tsx
import BottomDrawer from './BottomDrawer'
```

Replace with:

```tsx
import DockPanel from './DockPanel'
```

Find every occurrence of `<BottomDrawer ` and replace with `<DockPanel `.

Find:

```tsx
describe('BottomDrawer', () => {
```

Replace with:

```tsx
describe('DockPanel', () => {
```

- [ ] **Step 1.4: Update WorkspaceView.tsx import**

In `src/features/workspace/WorkspaceView.tsx`, find:

```tsx
import BottomDrawer from './components/BottomDrawer'
```

Replace with:

```tsx
import DockPanel from './components/DockPanel'
```

Find every JSX usage `<BottomDrawer ` and replace with `<DockPanel `. The `</BottomDrawer>` closing form should not exist (the current component is self-closing or wrapped); double-check via grep.

- [ ] **Step 1.5: Update the `vi.mock` paths in test files**

In `src/features/workspace/WorkspaceView.command-palette.test.tsx:41`:

Find:

```tsx
vi.mock('./components/BottomDrawer', () => ({
```

Replace with:

```tsx
vi.mock('./components/DockPanel', () => ({
```

Same edit in `src/features/workspace/WorkspaceView.subscription.test.tsx:182`.

- [ ] **Step 1.6: Update string mentions in remaining tests**

In each of:

- `src/features/workspace/WorkspaceView.test.tsx`
- `src/features/workspace/WorkspaceView.visual.test.tsx`
- `src/features/workspace/WorkspaceView.integration.test.tsx`
- `src/features/workspace/WorkspaceView.verification.test.tsx`

Find every comment / string / assertion-name containing `BottomDrawer` and rename to `DockPanel`. Sample queries to run:

```bash
grep -n 'BottomDrawer\|bottom-drawer\|bottom drawer' src/features/workspace/WorkspaceView.test.tsx src/features/workspace/WorkspaceView.visual.test.tsx src/features/workspace/WorkspaceView.integration.test.tsx src/features/workspace/WorkspaceView.verification.test.tsx
```

For each hit, apply the rename. Keep semantics identical (e.g. an assertion like `expect(getByRole('button', { name: /editor/i }))` doesn't need any string change — only the comment above it).

- [ ] **Step 1.7: Run the test suite**

```bash
npx vitest run src/features/workspace/
```

Expected: all tests pass with no string changes affecting behavior. Tab-strip + collapse tests stay green at their old 48 px assertions.

- [ ] **Step 1.8: Run lint + type-check**

```bash
npm run lint
npm run type-check
```

Expected: clean.

- [ ] **Step 1.9: Commit**

```bash
git add src/features/workspace/
git commit -m "refactor(workspace): rename BottomDrawer.tsx → DockPanel.tsx (#166)"
```

---

## Task 2: Lift dock state into WorkspaceView (no layout change yet)

**Goal:** Introduce `dockPosition`, `isDockOpen`, `dockTab`, `dockBottomHeight` global state in WorkspaceView. Thread it into DockPanel as controlled props. Layout still bottom-only.

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/components/DockPanel.tsx` (drop uncontrolled internal state)
- Modify: `src/features/workspace/components/DockPanel.test.tsx` (drop uncontrolled-fallback tests)

- [ ] **Step 2.1: Add a failing test for the controlled-only contract in DockPanel.test.tsx**

The previous tests had a "Controlled mode" `describe` block. We now make controlled the only mode. Add a new test at the top of the existing describe:

```tsx
test('renders without internal tab state — tab prop is required', () => {
  const onTabChange = vi.fn()

  render(
    <DockPanel
      selectedFilePath={null}
      content=""
      tab="diff"
      onTabChange={onTabChange}
      isCollapsed={false}
      onCollapsedChange={vi.fn()}
    />
  )

  // Diff tab is active because `tab="diff"` was provided, with no
  // uncontrolled-fallback path inside the component.
  expect(screen.getByRole('button', { name: /diff viewer/i })).toHaveClass(
    'text-primary'
  )
})
```

Note: at this stage we keep the prop names `activeTab` / `isCollapsed` / `onCollapsedChange` so the diff with Task 1's rename is small. We rename them in Task 3 along with the visual restyle.

- [ ] **Step 2.2: Run the test — expect failure**

```bash
npx vitest run src/features/workspace/components/DockPanel.test.tsx -t "tab prop is required"
```

Expected: FAIL — current component still supports the discriminated-union uncontrolled fallback, so the test passes for the wrong reason. Document the failure mode by deleting it after verifying the new file shape.

(If the test passes as-written, the spec mandates we still proceed to remove the uncontrolled branches.)

- [ ] **Step 2.3: Lift state to WorkspaceView (incl. bottom-dock height)**

In `src/features/workspace/WorkspaceView.tsx`, find:

```tsx
const [bottomDrawerTab, setBottomDrawerTab] = useState<'editor' | 'diff'>(
  'editor'
)
```

Replace with:

```tsx
type DockPosition = 'bottom' | 'left' | 'right'
type DockTab = 'editor' | 'diff' // Files added in Task 4

const [dockPosition, setDockPosition] = useState<DockPosition>('bottom')
const [isDockOpen, setIsDockOpen] = useState(true)
const [dockTab, setDockTab] = useState<DockTab>('editor')

// Bottom-dock height lifted from DockPanel so it survives close/reopen.
// Matches the existing DRAWER_MIN/MAX/initial constants in the current
// BottomDrawer component (150 / 640 / 400 px).
const dockBottomResize = useResizable({
  initial: 400,
  min: 150,
  max: 640,
  direction: 'vertical',
  invert: true,
})
```

Add the import at the top of the file (if not already present):

```tsx
import { useResizable } from '../../hooks/useResizable'
```

Find:

```tsx
const [isBottomDrawerCollapsed, setIsBottomDrawerCollapsed] = useState(false)
```

Delete this line — `isDockOpen` replaces it.

In the same file, find every reference to `bottomDrawerTab` and replace with `dockTab` (and `setBottomDrawerTab` → `setDockTab`). For `isBottomDrawerCollapsed` → `!isDockOpen` (the sense flips), and `setIsBottomDrawerCollapsed(x)` → `setIsDockOpen(!x)`.

- [ ] **Step 2.4: Update the DockPanel render-site in WorkspaceView**

Find the existing JSX (after Task 1's rename):

```tsx
<DockPanel
  ...
  activeTab={bottomDrawerTab}
  onTabChange={setBottomDrawerTab}
  isCollapsed={isBottomDrawerCollapsed}
  onCollapsedChange={setIsBottomDrawerCollapsed}
  ...
/>
```

Replace with the spec's prop names (`tab`, `onClose`, controlled height). This **drops** `isCollapsed` + `onCollapsedChange` entirely — DockPanel now renders only when `isDockOpen === true`, so it has no need to know about the closed state. Closing flows through `onClose`:

```tsx
{isDockOpen && (
  <DockPanel
    ...
    tab={dockTab}
    onTabChange={setDockTab}
    onClose={() => setIsDockOpen(false)}
    bottomHeight={dockBottomResize.size}
    onBottomHeightAdjust={dockBottomResize.adjustBy}
    // position + onPositionChange added in Task 6
    // filesOnFileSelect added in Task 4
  />
)}
```

Note: the unmount-when-closed flow lands here in Task 2 (not deferred to Task 8). Task 8 adds the `DockPeekButton` rendered alongside the conditional unmount. Until then, the closed state shows nothing — the close button is unreachable from a user standpoint anyway because we can't currently reopen. Task 2.6 below mitigates this with a temporary always-open guard so the test suite can run.

- [ ] **Step 2.5: Rewrite DockPanel.tsx prop interface (spec names + lifted height)**

In `DockPanel.tsx`, replace the entire discriminated-union prop typing block (the existing `TabControl` / `CollapseControl` / `SelectedDiffControl` unions plus the `BottomDrawerBaseProps` interface — every type declaration before the component function) with the spec-aligned shape:

```tsx
type TabType = 'editor' | 'diff' // 'files' joins in Task 4

interface DockPanelBaseProps {
  /** Active tab (controlled). */
  tab: TabType
  onTabChange: (next: TabType) => void

  /** Caller closes the dock; DockPanel unmounts on close. */
  onClose: () => void

  /** Controlled bottom-dock height + keyboard-arrow adjuster, both from
   *  WorkspaceView's lifted `useResizable`. Ignored for left/right docks. */
  bottomHeight: number
  onBottomHeightAdjust: (delta: number) => void

  // Pass-through props (unchanged).
  selectedFilePath: string | null
  content: string
  onContentChange?: (content: string) => void
  onSave?: () => void
  isDirty?: boolean
  isLoading?: boolean
  cwd?: string
  gitStatus?: UseGitStatusReturn
}

type SelectedDiffControl =
  | { selectedDiffFile?: undefined; onSelectedDiffFileChange?: undefined }
  | {
      selectedDiffFile: SelectedDiffFile | null
      onSelectedDiffFileChange: (file: SelectedDiffFile | null) => void
    }

type DockPanelProps = DockPanelBaseProps & SelectedDiffControl
```

In the component header destructure, replace the existing block with:

```tsx
const DockPanel = ({
  tab,
  onTabChange,
  onClose,
  bottomHeight,
  onBottomHeightAdjust,
  selectedFilePath,
  content,
  onContentChange = undefined,
  onSave = undefined,
  isDirty = false,
  isLoading = false,
  cwd = '.',
  gitStatus = undefined,
  selectedDiffFile,
  onSelectedDiffFileChange,
}: DockPanelProps): ReactElement => {
```

Delete every uncontrolled-state line in the function body:

```tsx
const [uncontrolledActiveTab, setUncontrolledActiveTab] = ...
const [uncontrolledIsCollapsed, setUncontrolledIsCollapsed] = ...

const COLLAPSED_HEIGHT = 48

const isTabControlled = controlledActiveTab !== undefined
const isCollapseControlled = controlledIsCollapsed !== undefined

const activeTab = isTabControlled ? controlledActiveTab : uncontrolledActiveTab
const isCollapsed = isCollapseControlled
  ? controlledIsCollapsed
  : uncontrolledIsCollapsed
```

Replace the existing `useResizable` call with direct use of the lifted props:

```tsx
const {
  size: height,
  isDragging,
  handleMouseDown,
  adjustBy,
} = useResizable({ ... })
```

becomes (DockPanel no longer owns the resize hook):

```tsx
const height = bottomHeight
const isDragging = false // owned by WorkspaceView's lifted hook from Task 7
const handleMouseDown = (): void => {
  // The resize-handle drag is owned by the lifted hook starting in Task 7;
  // until then, the handle's onMouseDown is a no-op so existing
  // "resize handle triggers mouse down handler" test still passes (it
  // only asserts the call doesn't throw, not that anything resized).
}
const adjustBy = onBottomHeightAdjust
```

Delete the line `const effectiveHeight = isCollapsed ? COLLAPSED_HEIGHT : height` — height is just `height` now (the panel is never rendered when closed).

In the JSX, find every body reference to `activeTab` and verify it now reads the destructured `tab` (or rename via search-and-replace: `activeTab` → `tab` inside this file only). Update the click handlers from:

```tsx
onClick={() => {
  if (isTabControlled) {
    onTabChange('editor')
  } else {
    setUncontrolledActiveTab('editor')
  }
}}
```

to:

```tsx
onClick={() => onTabChange('editor')}
```

(and the same for the Diff Viewer click).

Replace the collapse-toggle button. Find:

```tsx
<button
  type="button"
  aria-label={isCollapsed ? 'Expand drawer' : 'Collapse drawer'}
  aria-expanded={!isCollapsed}
  onClick={() => {
    if (isCollapseControlled) {
      onCollapsedChange(!isCollapsed)
    } else {
      setUncontrolledIsCollapsed((v) => !v)
    }
  }}
  className="material-symbols-outlined text-sm text-outline hover:text-on-surface cursor-pointer transition-colors"
>
  {isCollapsed ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
</button>
```

Replace with:

```tsx
<button
  type="button"
  aria-label="Collapse panel"
  onClick={onClose}
  className="material-symbols-outlined text-sm text-outline hover:text-on-surface cursor-pointer transition-colors"
>
  keyboard_arrow_down
</button>
```

(Task 6 makes the glyph position-aware; Task 3 restyles to the 24×24 button.)

Finally, change the `<section data-testid="bottom-drawer" ...>` to `data-testid="dock-panel"`. This testid migration was previously marked for Task 7, but doing it here in Task 2 makes it the same commit as the prop rename — atomic.

The existing `effectiveHeight` line in the `style={{ height: ... }}` attribute becomes:

```tsx
style={{ height: `${height}px` }}
```

- [ ] **Step 2.6: Drop the uncontrolled-fallback tests + migrate testid in DockPanel.test.tsx**

First, the testid migration. The component's `data-testid` changed from `bottom-drawer` → `dock-panel` (Step 2.5 tail). Every `getByTestId('bottom-drawer')` in the test file must update:

```bash
grep -n "bottom-drawer" src/features/workspace/components/DockPanel.test.tsx
```

For each hit, change `'bottom-drawer'` to `'dock-panel'`. Do the same sweep in the other WorkspaceView test files (the mocks define their own `data-testid`, so they're decoupled — but the assertion sites that select the real component need to update):

```bash
grep -rn "bottom-drawer" src/features/workspace/
```

Update each match. The WorkspaceView mocks of DockPanel (in `subscription.test.tsx` and `command-palette.test.tsx`) should set `data-testid="dock-panel"` on their stub root element.

Next, delete these tests by name from `DockPanel.test.tsx`:

- `'renders with Editor tab active by default'`
- `'uncontrolled fallback: activeTab works without controlled props'`
- `'uncontrolled fallback: isCollapsed works without controlled props'`

The `'switches to Diff Viewer tab when clicked'` test needs to be rewritten to use controlled props:

```tsx
test('clicking Diff Viewer tab calls onTabChange with "diff"', async () => {
  const user = userEvent.setup()
  const onTabChange = vi.fn()

  render(
    <DockPanel
      selectedFilePath={null}
      content=""
      activeTab="editor"
      onTabChange={onTabChange}
      isCollapsed={false}
      onCollapsedChange={vi.fn()}
    />
  )

  await user.click(screen.getByRole('button', { name: /diff viewer/i }))
  expect(onTabChange).toHaveBeenCalledWith('diff')
})
```

- [ ] **Step 2.7: Run the test suite**

```bash
npx vitest run src/features/workspace/
```

Expected: all tests pass. WorkspaceView.subscription.test.tsx may need its DockPanel mock updated to accept the now-required props; if so, add the missing `activeTab="editor" onTabChange={vi.fn()} isCollapsed={false} onCollapsedChange={vi.fn()}` to the test's render args.

- [ ] **Step 2.8: Run lint + type-check**

```bash
npm run lint
npm run type-check
```

Expected: clean.

- [ ] **Step 2.9: Commit**

```bash
git add src/features/workspace/
git commit -m "feat(dock-panel): lift dock state to WorkspaceView (#166)"
```

---

## Task 3: Restyle header to 34px + rounded-chip tabs

**Goal:** Visual-only change. Header height → 34 px, tabs → 26 px rounded chips with the prototype's color tokens.

**Files:**

- Modify: `src/features/workspace/components/DockPanel.tsx`
- Modify: `src/features/workspace/components/DockPanel.test.tsx`

- [ ] **Step 3.1: Write the failing tests for header / tab styling**

Append to `DockPanel.test.tsx`:

```tsx
describe('§4.8 prototype styling', () => {
  const baseProps = {
    selectedFilePath: null,
    content: '',
    activeTab: 'editor' as const,
    onTabChange: vi.fn(),
    isCollapsed: false,
    onCollapsedChange: vi.fn(),
  }

  test('header is 34px tall', () => {
    render(<DockPanel {...baseProps} />)

    // The header wrapper has the h-[34px] arbitrary class.
    const editorTab = screen.getByRole('button', { name: /editor/i })
    // eslint-disable-next-line testing-library/no-node-access -- structural check
    const header = editorTab.closest('div[class*="h-\\[34px\\]"]')
    expect(header).not.toBeNull()
  })

  test('active tab uses rounded-chip styling', () => {
    render(<DockPanel {...baseProps} activeTab="editor" />)

    const editorTab = screen.getByRole('button', { name: /editor/i })
    expect(editorTab).toHaveClass('rounded-md')
    expect(editorTab).toHaveClass('bg-[rgba(226,199,255,0.08)]')
    expect(editorTab).toHaveClass('border-[rgba(203,166,247,0.3)]')
    expect(editorTab).toHaveClass('text-[#e2c7ff]')
  })

  test('inactive tab has transparent border (chip invariant)', () => {
    render(<DockPanel {...baseProps} activeTab="editor" />)

    const diffTab = screen.getByRole('button', { name: /diff viewer/i })
    expect(diffTab).toHaveClass('border')
    expect(diffTab).toHaveClass('border-transparent')
  })

  test('each tab is 26px tall', () => {
    render(<DockPanel {...baseProps} />)

    expect(screen.getByRole('button', { name: /editor/i })).toHaveClass(
      'h-[26px]'
    )
    expect(screen.getByRole('button', { name: /diff viewer/i })).toHaveClass(
      'h-[26px]'
    )
  })
})
```

- [ ] **Step 3.2: Run the new tests — expect failure**

```bash
npx vitest run src/features/workspace/components/DockPanel.test.tsx -t "prototype styling"
```

Expected: 4 FAILs. The existing tab buttons still use `h-12` + `border-b-2 border-primary` — none of the chip classes are present.

- [ ] **Step 3.3: Update the header + tab JSX in DockPanel.tsx**

Find:

```tsx
{/* Tab Bar */}
<div className="flex items-center px-8 h-12 bg-surface-container justify-between">
```

Replace with:

```tsx
{/* Tab Bar — 34 px (prototype views.jsx:1103-1114) */}
<div className="flex items-center px-2 h-[34px] bg-[#0d0d1c] gap-1 border-b border-[rgba(74,68,79,0.25)]">
```

(`px-2` and `gap-1` map to the prototype's `padding: 0 8px` + `gap: 4`. Adjust if visual review reveals drift.)

Find the Editor tab `className`:

```tsx
className={`flex items-center space-x-2 font-mono text-xs h-12 px-2 transition-colors ${
  activeTab === 'editor'
    ? 'text-primary border-b-2 border-primary'
    : 'text-slate-400 hover:text-primary'
}`}
```

Replace with:

```tsx
className={`flex items-center gap-1.5 font-mono text-[10.5px] h-[26px] px-[11px] rounded-md border transition-colors ${
  activeTab === 'editor'
    ? 'bg-[rgba(226,199,255,0.08)] border-[rgba(203,166,247,0.3)] text-[#e2c7ff]'
    : 'bg-transparent border-transparent text-[#8a8299] hover:text-[#e2c7ff]'
}`}
```

Apply the same className replacement to the Diff Viewer tab button, substituting `activeTab === 'diff'` for the active branch.

Also update the icon spans inside each tab from:

```tsx
<span className="material-symbols-outlined text-sm">code</span>
```

to:

```tsx
<span
  className={`material-symbols-outlined text-[12px] ${
    activeTab === 'editor' ? 'text-[#cba6f7]' : 'text-[#6c7086]'
  }`}
  aria-hidden="true"
>
  code
</span>
```

And similarly for the `difference` icon span in the Diff tab.

(The `aria-hidden="true"` change is a small a11y win we pick up while editing — Material Symbols spans should not be in the accessibility tree per `rules/typescript/coding-style/CLAUDE.md`.)

Remove the existing collapse-toggle's `text-sm` for the moment — the close button restyle happens in Step 3.4.

- [ ] **Step 3.4: Restyle the close button (visual only — wiring done in Task 2)**

Task 2 already replaced the close button's `onClick` with `onClose` and dropped the `isCollapsed`-conditional behavior. This step is the visual restyle only: wrap the icon in a 24×24 button shell with the prototype's hover treatment.

Find (the post-Task-2 close button):

```tsx
<button
  type="button"
  aria-label="Collapse panel"
  onClick={onClose}
  className="material-symbols-outlined text-sm text-outline hover:text-on-surface cursor-pointer transition-colors"
>
  keyboard_arrow_down
</button>
```

Replace with:

```tsx
<button
  type="button"
  aria-label="Collapse panel"
  onClick={onClose}
  className="grid place-items-center w-6 h-6 rounded-[5px] bg-transparent text-[#8a8299] hover:bg-white/5 hover:text-[#e2c7ff] transition-colors cursor-pointer"
>
  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
    expand_more
  </span>
</button>
```

Note: `expand_more` is the bottom-dock glyph. Task 6 makes it position-aware (`chevron_left` / `chevron_right` for side docks).

- [ ] **Step 3.5: Run the test suite**

```bash
npx vitest run src/features/workspace/components/DockPanel.test.tsx
```

Expected: all tests pass. The new 4 styling tests are GREEN. Earlier tests that referenced `text-slate-400` etc. need fixing — find any `expect(tab).toHaveClass('text-slate-400')` and update to `'text-[#8a8299]'`. Similarly `'border-b-2'` → `'border'` and `'text-primary'` → `'text-[#e2c7ff]'` on the relevant assertions.

- [ ] **Step 3.6: Run lint + type-check**

```bash
npm run lint
npm run type-check
```

Expected: clean.

- [ ] **Step 3.7: Commit**

```bash
git add src/features/workspace/components/DockPanel.tsx src/features/workspace/components/DockPanel.test.tsx
git commit -m "feat(dock-panel): restyle header to 34px + rounded-chip tabs (#166)"
```

---

## Task 4: Add Files tab + DockFilesPanel

**Goal:** Wire the third tab. Files routes to a new `DockFilesPanel` component that mirrors the sidebar `FilesPanel` pattern (full path remapping) but at full panel width.

**Files:**

- Create: `src/features/workspace/components/panels/DockFilesPanel.tsx`
- Create: `src/features/workspace/components/panels/DockFilesPanel.test.tsx`
- Modify: `src/features/workspace/components/DockPanel.tsx`
- Modify: `src/features/workspace/components/DockPanel.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx`

- [ ] **Step 4.1: Write DockFilesPanel.test.tsx**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { DockFilesPanel } from './DockFilesPanel'

describe('DockFilesPanel', () => {
  test('renders the file tree', () => {
    render(<DockFilesPanel onFileSelect={vi.fn()} />)

    expect(screen.getByTestId('dock-files-panel')).toBeInTheDocument()
  })

  test('clicking a leaf file calls onFileSelect with { id: fullPath, type: "file" }', async () => {
    const user = userEvent.setup()
    const onFileSelect = vi.fn()
    render(<DockFilesPanel onFileSelect={onFileSelect} />)

    // The first leaf file in `mockFileTree`. The exact full path comes from the
    // tree fixture — confirm the format by running once and copying the
    // received arg into this expectation.
    const someFile = await screen.findByText('auth.ts')
    await user.click(someFile)

    expect(onFileSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'file',
        // node.id must be the fullPath, not the leaf-only id.
        id: expect.stringMatching(/auth\.ts$/),
      })
    )
    // The id MUST contain a '/' separator — proves it's the full path, not just leaf name.
    const arg = onFileSelect.mock.calls[0][0]
    expect(arg.id).toContain('/')
  })

  test('clicking a directory expander does NOT call onFileSelect', async () => {
    const user = userEvent.setup()
    const onFileSelect = vi.fn()
    render(<DockFilesPanel onFileSelect={onFileSelect} />)

    // Directories in the mock tree render as expand/collapse rows; clicking
    // them must not fire the file-open path.
    const folder = await screen.findByText('middleware')
    await user.click(folder)

    expect(onFileSelect).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4.2: Run the test — expect failure**

```bash
npx vitest run src/features/workspace/components/panels/DockFilesPanel.test.tsx
```

Expected: FAIL — DockFilesPanel doesn't exist.

- [ ] **Step 4.3: Create DockFilesPanel.tsx**

```tsx
import type { ReactElement } from 'react'
import { FileTree } from '../../../files/components/FileTree'
import {
  mockFileTree,
  contextMenuActions,
} from '../../../files/data/mockFileTree'

export interface DockFilesPanelProps {
  /**
   * Fires when the user activates a file (click on a leaf). `node.id` is
   * the resolved **full filesystem path** — the path-remap mirrors the
   * sidebar `FilesPanel` so `WorkspaceView.handleFileSelect` can use
   * `node.id` directly as the filePath.
   */
  onFileSelect: (node: { id: string; type: 'file' | 'folder' }) => void
}

/**
 * DockFilesPanel — Files tab content for the docked panel (full panel
 * width). Distinct from the sidebar's FilesPanel which is shaped for
 * the 272 px sidebar context. Shares the FileTree rendering primitive.
 *
 * Filters folder activations: `FileTree.onNodeSelect` fires for both
 * leaf files and directory expanders, but `handleFileSelect` upstream
 * needs only the file events. Filtering here keeps the contract tight
 * — `onFileSelect` is called exclusively with `type === 'file'`.
 */
export const DockFilesPanel = ({
  onFileSelect,
}: DockFilesPanelProps): ReactElement => (
  <div
    className="flex flex-1 flex-col overflow-y-auto px-4 py-3"
    data-testid="dock-files-panel"
  >
    <FileTree
      nodes={mockFileTree}
      contextMenuActions={contextMenuActions}
      onNodeSelect={(node, fullPath) => {
        if (node.type !== 'file') {
          return
        }
        onFileSelect({ ...node, id: fullPath })
      }}
    />
  </div>
)
```

- [ ] **Step 4.4: Run the new tests — expect green**

```bash
npx vitest run src/features/workspace/components/panels/DockFilesPanel.test.tsx
```

Expected: 3 PASS.

- [ ] **Step 4.5: Add Files tab to DockPanel.tsx**

In `DockPanel.tsx`:

Find:

```tsx
type TabType = 'editor' | 'diff'
```

Replace with:

```tsx
type TabType = 'editor' | 'diff' | 'files'
```

Add a new prop to `DockPanelBaseProps`:

```tsx
/** Fires when the user activates a file in the Files tab. */
filesOnFileSelect: (node: { id: string; type: 'file' | 'folder' }) => void
```

Destructure it in the component header:

```tsx
filesOnFileSelect,
```

Import DockFilesPanel at the top:

```tsx
import { DockFilesPanel } from './panels/DockFilesPanel'
```

Add the third tab button in the JSX, after the Diff Viewer button. Use the same `className` template:

```tsx
{
  /* Files Tab */
}
;<button
  type="button"
  onClick={() => onTabChange('files')}
  className={`flex items-center gap-1.5 font-mono text-[10.5px] h-[26px] px-[11px] rounded-md border transition-colors ${
    activeTab === 'files'
      ? 'bg-[rgba(226,199,255,0.08)] border-[rgba(203,166,247,0.3)] text-[#e2c7ff]'
      : 'bg-transparent border-transparent text-[#8a8299] hover:text-[#e2c7ff]'
  }`}
  aria-label="Files"
>
  <span
    className={`material-symbols-outlined text-[12px] ${
      activeTab === 'files' ? 'text-[#cba6f7]' : 'text-[#6c7086]'
    }`}
    aria-hidden="true"
  >
    folder_open
  </span>
  <span>Files</span>
</button>
```

In the content-area conditional, add a third branch. Find:

```tsx
{activeTab === 'editor' ? (
  <div data-testid="editor-panel" ... >
    <CodeEditor ... />
  </div>
) : (
  <div data-testid="diff-panel" ... >
    ...DiffPanelContent...
  </div>
)}
```

Replace with:

```tsx
{
  activeTab === 'editor' && (
    <div
      data-testid="editor-panel"
      className="flex min-h-0 flex-1 overflow-hidden"
    >
      <CodeEditor
        filePath={selectedFilePath}
        content={content}
        onContentChange={onContentChange}
        onSave={onSave}
        isDirty={isDirty}
        isLoading={isLoading}
      />
    </div>
  )
}
{
  activeTab === 'diff' && (
    <div
      data-testid="diff-panel"
      className="flex min-h-0 flex-1 overflow-hidden"
    >
      {selectedDiffFile !== undefined ? (
        <DiffPanelContent
          cwd={cwd}
          gitStatus={gitStatus}
          selectedFile={selectedDiffFile}
          onSelectedFileChange={onSelectedDiffFileChange}
        />
      ) : (
        <DiffPanelContent cwd={cwd} gitStatus={gitStatus} />
      )}
    </div>
  )
}
{
  activeTab === 'files' && <DockFilesPanel onFileSelect={filesOnFileSelect} />
}
```

- [ ] **Step 4.6: Add a DockPanel-level test for Files routing**

Append to `DockPanel.test.tsx` inside the existing `describe`:

```tsx
test('Files tab routes to DockFilesPanel, not CodeEditor', () => {
  const filesOnFileSelect = vi.fn()
  render(
    <DockPanel
      selectedFilePath={null}
      content=""
      activeTab="files"
      onTabChange={vi.fn()}
      isCollapsed={false}
      onCollapsedChange={vi.fn()}
      filesOnFileSelect={filesOnFileSelect}
    />
  )

  expect(screen.getByTestId('dock-files-panel')).toBeInTheDocument()
  expect(screen.queryByTestId('codemirror-container')).not.toBeInTheDocument()
})

test('forwards filesOnFileSelect down to DockFilesPanel', async () => {
  const user = userEvent.setup()
  const filesOnFileSelect = vi.fn()
  render(
    <DockPanel
      selectedFilePath={null}
      content=""
      activeTab="files"
      onTabChange={vi.fn()}
      isCollapsed={false}
      onCollapsedChange={vi.fn()}
      filesOnFileSelect={filesOnFileSelect}
    />
  )

  await user.click(await screen.findByText('auth.ts'))
  expect(filesOnFileSelect).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'file' })
  )
})
```

Every existing `<DockPanel ... />` render call in this file now needs the `filesOnFileSelect={vi.fn()}` prop added (TypeScript will tell you where).

- [ ] **Step 4.7: Wire Files in WorkspaceView**

In `src/features/workspace/WorkspaceView.tsx`:

Find:

```tsx
type DockTab = 'editor' | 'diff' // Files added in Task 4
```

Replace with:

```tsx
type DockTab = 'editor' | 'diff' | 'files'
```

In the DockPanel render-site, add the new prop:

```tsx
<DockPanel
  ...
  filesOnFileSelect={handleFileSelect}
/>
```

`handleFileSelect` is the existing function at `WorkspaceView.tsx:401-420`; it accepts `{ id, type }` and handles the unsaved-changes guard.

- [ ] **Step 4.8: Run the full workspace test suite**

```bash
npx vitest run src/features/workspace/
```

Expected: all tests pass. WorkspaceView mocks in `command-palette.test.tsx` and `subscription.test.tsx` may need `filesOnFileSelect: vi.fn()` added to their mock `MockBottomDrawerProps` shapes — search for the mock interface and extend it.

- [ ] **Step 4.9: Run lint + type-check**

```bash
npm run lint
npm run type-check
```

Expected: clean.

- [ ] **Step 4.10: Commit**

```bash
git add src/features/workspace/
git commit -m "feat(dock-panel): add Files tab + DockFilesPanel (#166)"
```

---

## Task 5: Add DockSwitcher subcomponent

**Goal:** Build the 3-button layout switcher (not yet rendered in DockPanel).

**Files:**

- Create: `src/features/workspace/components/DockSwitcher.tsx`
- Create: `src/features/workspace/components/DockSwitcher.test.tsx`

- [ ] **Step 5.1: Write the failing tests**

`DockSwitcher.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { DockSwitcher } from './DockSwitcher'

describe('DockSwitcher', () => {
  test('renders three buttons: bottom / left / right', () => {
    render(<DockSwitcher position="bottom" onPick={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /dock: bottom/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /dock: left/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /dock: right/i })
    ).toBeInTheDocument()
  })

  test('does NOT render a Hidden button (compact-only invariant)', () => {
    render(<DockSwitcher position="bottom" onPick={vi.fn()} />)

    expect(
      screen.queryByRole('button', { name: /dock: hidden/i })
    ).not.toBeInTheDocument()
  })

  test('active button (matching position) uses lavender styling', () => {
    render(<DockSwitcher position="left" onPick={vi.fn()} />)

    const active = screen.getByRole('button', { name: /dock: left/i })
    expect(active).toHaveClass('text-[#cba6f7]')
    expect(active).toHaveClass('bg-[rgba(203,166,247,0.15)]')
  })

  test('inactive button has muted color', () => {
    render(<DockSwitcher position="bottom" onPick={vi.fn()} />)

    const inactive = screen.getByRole('button', { name: /dock: left/i })
    expect(inactive).toHaveClass('text-[#8a8299]')
  })

  test('clicking a button calls onPick with that position', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<DockSwitcher position="bottom" onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: /dock: right/i }))
    expect(onPick).toHaveBeenCalledWith('right')
  })
})
```

- [ ] **Step 5.2: Run — expect failure**

```bash
npx vitest run src/features/workspace/components/DockSwitcher.test.tsx
```

Expected: 5 FAILs — `DockSwitcher` module does not exist.

- [ ] **Step 5.3: Create DockSwitcher.tsx**

```tsx
import type { ReactElement } from 'react'

export type DockPosition = 'bottom' | 'left' | 'right'

interface DockSwitcherProps {
  position: DockPosition
  onPick: (next: DockPosition) => void
}

const OPTIONS: { id: DockPosition; label: string }[] = [
  { id: 'bottom', label: 'Bottom' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
]

/**
 * DockSwitcher — compact 3-button layout-position picker for the DockPanel
 * header. Mirrors the prototype's `splitview.jsx:757-804` in `compact` mode
 * (the user-visible variant; `hidden` is excluded — see spec §State domain).
 */
export const DockSwitcher = ({
  position,
  onPick,
}: DockSwitcherProps): ReactElement => (
  <div className="inline-flex items-center gap-0.5 p-[3px] rounded-lg bg-[rgba(13,13,28,0.6)] border border-[rgba(74,68,79,0.3)]">
    {OPTIONS.map((opt) => {
      const active = opt.id === position
      return (
        <button
          key={opt.id}
          type="button"
          title={`Dock: ${opt.label}`}
          aria-label={`Dock: ${opt.label}`}
          aria-pressed={active}
          onClick={() => onPick(opt.id)}
          className={`inline-flex items-center justify-center w-[26px] h-[22px] rounded-[5px] border cursor-pointer transition-colors ${
            active
              ? 'bg-[rgba(203,166,247,0.15)] border-[rgba(203,166,247,0.45)] text-[#cba6f7]'
              : 'bg-transparent border-transparent text-[#8a8299] hover:text-[#e2c7ff]'
          }`}
        >
          <DockGlyph position={opt.id} />
        </button>
      )
    })}
  </div>
)

// ---- DockGlyph: 14×11 SVG mirroring splitview.jsx:806-905 ----
// 12×9 outer rect, plus a shaded sub-rect representing the dock side.
const DockGlyph = ({ position }: { position: DockPosition }): ReactElement => {
  const subRect =
    position === 'bottom'
      ? { x: 2, y: 6.5, width: 10, height: 3 }
      : position === 'left'
        ? { x: 1.6, y: 2, width: 4, height: 7 }
        : /* right */ { x: 8.4, y: 2, width: 4, height: 7 }

  return (
    <svg
      width="14"
      height="11"
      viewBox="0 0 14 11"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width="12"
        height="9"
        rx={1.4}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <rect {...subRect} rx={0.6} fill="currentColor" opacity={0.55} />
    </svg>
  )
}
```

- [ ] **Step 5.4: Run the tests — expect green**

```bash
npx vitest run src/features/workspace/components/DockSwitcher.test.tsx
```

Expected: 5 PASS.

- [ ] **Step 5.5: Run lint + type-check**

```bash
npm run lint
npm run type-check
```

Expected: clean.

- [ ] **Step 5.6: Commit**

```bash
git add src/features/workspace/components/DockSwitcher.tsx src/features/workspace/components/DockSwitcher.test.tsx
git commit -m "feat(dock-switcher): add DockSwitcher subcomponent (#166)"
```

---

## Task 6: Mount DockSwitcher in DockPanel header

**Goal:** Render `<DockSwitcher />` between the tab strip and the close button. DockPanel gets a `position` prop + `onPositionChange` callback (caller is responsible for updating `dockPosition`).

**Files:**

- Modify: `src/features/workspace/components/DockPanel.tsx`
- Modify: `src/features/workspace/components/DockPanel.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx`

- [ ] **Step 6.1: Write the failing test in DockPanel.test.tsx**

```tsx
test('mounts DockSwitcher in header with current position', () => {
  render(
    <DockPanel
      selectedFilePath={null}
      content=""
      activeTab="editor"
      onTabChange={vi.fn()}
      isCollapsed={false}
      onCollapsedChange={vi.fn()}
      filesOnFileSelect={vi.fn()}
      position="left"
      onPositionChange={vi.fn()}
    />
  )

  const leftSwitcherButton = screen.getByRole('button', {
    name: /dock: left/i,
  })
  expect(leftSwitcherButton).toBeInTheDocument()
  expect(leftSwitcherButton).toHaveClass('text-[#cba6f7]') // active
})

test('clicking a DockSwitcher button calls onPositionChange', async () => {
  const user = userEvent.setup()
  const onPositionChange = vi.fn()
  render(
    <DockPanel
      selectedFilePath={null}
      content=""
      activeTab="editor"
      onTabChange={vi.fn()}
      isCollapsed={false}
      onCollapsedChange={vi.fn()}
      filesOnFileSelect={vi.fn()}
      position="bottom"
      onPositionChange={onPositionChange}
    />
  )

  await user.click(screen.getByRole('button', { name: /dock: right/i }))
  expect(onPositionChange).toHaveBeenCalledWith('right')
})
```

Existing DockPanel render-call test sites need `position="bottom"` + `onPositionChange={vi.fn()}` added.

- [ ] **Step 6.2: Run — expect failure**

```bash
npx vitest run src/features/workspace/components/DockPanel.test.tsx -t "DockSwitcher"
```

Expected: FAIL (or TypeScript error — `position` is not a known prop yet).

- [ ] **Step 6.3: Add the props to DockPanelBaseProps**

In `DockPanel.tsx`, import:

```tsx
import { DockSwitcher, type DockPosition } from './DockSwitcher'
```

Add to `DockPanelBaseProps`:

```tsx
/** Which edge of the main canvas the panel docks to. */
position: DockPosition
/** Layout-switcher pick callback. Caller updates dock position. */
onPositionChange: (next: DockPosition) => void
```

Destructure in the component header:

```tsx
position,
onPositionChange,
```

- [ ] **Step 6.4: Render DockSwitcher in the header**

In the tab-bar `<div>` between the tab buttons and the right-side controls, insert:

Find:

```tsx
{/* Right: File Path + Collapse Toggle */}
<div className="flex items-center space-x-4">
```

Replace with:

```tsx
{/* Spacer so DockSwitcher pushes right */}
<div className="flex-1" />

{/* DockSwitcher (compact, bottom/left/right) */}
<DockSwitcher position={position} onPick={onPositionChange} />

{/* Right: File Path + Collapse Toggle */}
<div className="flex items-center gap-3 ml-2">
```

Also update the close-button glyph to be position-aware. Find:

```tsx
<span className="material-symbols-outlined text-[14px]" aria-hidden="true">
  expand_more
</span>
```

Replace with:

```tsx
<span className="material-symbols-outlined text-[14px]" aria-hidden="true">
  {position === 'bottom'
    ? 'expand_more'
    : position === 'left'
      ? 'chevron_left'
      : 'chevron_right'}
</span>
```

- [ ] **Step 6.5: Wire the new props in WorkspaceView**

In `src/features/workspace/WorkspaceView.tsx`, find the DockPanel render-site. Add:

```tsx
<DockPanel
  ...
  position={dockPosition}
  onPositionChange={setDockPosition}
/>
```

- [ ] **Step 6.6: Run the test suite**

```bash
npx vitest run src/features/workspace/
```

Expected: all tests pass. Update the test-file mocks of `DockPanel` (in `WorkspaceView.command-palette.test.tsx` and `WorkspaceView.subscription.test.tsx`) to accept the new props in their `MockBottomDrawerProps` interface.

- [ ] **Step 6.7: Run lint + type-check**

```bash
npm run lint
npm run type-check
```

Expected: clean.

- [ ] **Step 6.8: Commit**

```bash
git add src/features/workspace/
git commit -m "feat(dock-panel): mount DockSwitcher in header (#166)"
```

---

## Task 7: Make main canvas react to dockPosition

**Goal:** Wrap TerminalZone + DockPanel in an inner flex container that swaps `flex-direction` and respects `dockBefore` ordering. Clicking DockSwitcher buttons now actually moves the panel.

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.test.tsx` (add layout assertions)
- Modify: `src/features/workspace/components/DockPanel.tsx` (side-dock sizing)

- [ ] **Step 7.1: Write the failing test in WorkspaceView.test.tsx**

Append:

```tsx
describe('Dock position layout (Task 7 of #166)', () => {
  test('with dockPosition=left, DockPanel renders BEFORE TerminalZone in the inner flex', async () => {
    const user = userEvent.setup()
    renderWorkspaceView() // existing helper

    // Switch to left dock
    await user.click(screen.getByRole('button', { name: /dock: left/i }))

    const inner = screen.getByTestId('dock-canvas-wrapper')
    expect(inner).toHaveStyle({ flexDirection: 'row' })

    // DOM order: DockPanel before TerminalZone (testid migrated in Task 2.5)
    const children = Array.from(inner.children)
    const dockIdx = children.findIndex(
      (c) => c.getAttribute('data-testid') === 'dock-panel'
    )
    const termIdx = children.findIndex(
      (c) => c.getAttribute('data-testid') === 'terminal-zone-wrapper'
    )
    expect(dockIdx).toBeLessThan(termIdx)
  })

  test('with dockPosition=bottom, inner flex direction is column', () => {
    renderWorkspaceView()

    const inner = screen.getByTestId('dock-canvas-wrapper')
    expect(inner).toHaveStyle({ flexDirection: 'column' })
  })
})
```

(`renderWorkspaceView` should match the existing helper or be inlined per the file's conventions. The `'dock-panel'` testid is the new one; keeping `bottom-drawer` as a fallback during rename transitions.)

- [ ] **Step 7.2: Run — expect failure**

```bash
npx vitest run src/features/workspace/WorkspaceView.test.tsx -t "Dock position layout"
```

Expected: FAIL — no `dock-canvas-wrapper` element exists.

- [ ] **Step 7.3: Introduce the inner flex wrapper in WorkspaceView.tsx**

Find (around line 638):

```tsx
{/* Main workspace area - TerminalZone + BottomDrawer. ... */}
<div className="relative flex flex-col overflow-hidden">
  <Tabs ... />

  <TerminalZone ... />

  {/* Bottom Drawer - Editor + Diff Viewer */}
  <DockPanel ... />
```

Replace with:

```tsx
{/* Main workspace area — Tabs above, then dock-canvas-wrapper hosting
    TerminalZone + DockPanel in a flex container whose direction +
    child order depend on dockPosition (#166). */}
<div className="relative flex flex-col overflow-hidden">
  <Tabs ... />

  {(() => {
    const isVertical = dockPosition === 'bottom'
    const flexDir = isVertical ? 'column' : 'row'
    const dockBefore = dockPosition === 'left'

    const terminal = (
      <div
        data-testid="terminal-zone-wrapper"
        className="flex flex-1 min-h-0 min-w-0 overflow-hidden"
      >
        <TerminalZone ... />
      </div>
    )

    const dock = isDockOpen ? (
      <DockPanel
        ...
        position={dockPosition}
        onPositionChange={setDockPosition}
        onCollapsedChange={(collapsed) => setIsDockOpen(!collapsed)}
        ...
      />
    ) : null

    return (
      <div
        data-testid="dock-canvas-wrapper"
        className="flex flex-1 min-h-0 min-w-0 overflow-hidden"
        style={{ flexDirection: flexDir }}
      >
        {dockBefore ? dock : null}
        {terminal}
        {!dockBefore ? dock : null}
      </div>
    )
  })()}
```

Move all the existing TerminalZone props into the `<TerminalZone ... />` placeholder above; same for DockPanel props.

- [ ] **Step 7.4: Add side-dock sizing inside DockPanel.tsx**

After Tasks 2-6, the `<section data-testid="dock-panel" style={{ height: ... }}>` element drives bottom-dock height only. For side docks, swap the style to a flex-basis. Find:

```tsx
return (
  <section
    data-testid="dock-panel"
    style={{ height: `${height}px` }}
    className="shrink-0 bg-slate-900/95 backdrop-blur-2xl border-t border-white/5 flex flex-col z-30 relative"
  >
```

Replace with:

```tsx
const SIDE_DOCK_BASIS = '40%'

const containerStyle =
  position === 'bottom'
    ? { height: `${height}px` }
    : { flex: `0 0 ${SIDE_DOCK_BASIS}` as const }

const borderClass =
  position === 'bottom'
    ? 'border-t border-[rgba(74,68,79,0.3)]'
    : position === 'left'
      ? 'border-r border-[rgba(74,68,79,0.3)]'
      : 'border-l border-[rgba(74,68,79,0.3)]'

return (
  <section
    data-testid="dock-panel"
    data-position={position}
    style={containerStyle}
    className={`shrink-0 bg-[#121221] flex flex-col z-30 relative ${borderClass}`}
  >
```

Also gate the resize handle on `position === 'bottom'`. Find the resize-handle `<div data-testid="resize-handle" ... />` and wrap it:

```tsx
{position === 'bottom' && (
  <div data-testid="resize-handle" ... />
)}
```

(The exact existing block is ~30 lines around `role="separator"`; preserve its contents and just wrap the whole thing in the conditional.)

- [ ] **Step 7.5: Update the WorkspaceView mocks with new layout-related props**

Task 2 already renamed `MockBottomDrawerProps` → `MockDockPanelProps` and set `data-testid="dock-panel"` on the mock root. Task 6 added `position` / `onPositionChange`. Task 4 added `filesOnFileSelect`. After Task 7, the only addition is none new — but verify the mock interfaces in both files now match the live DockPanel signature:

```bash
grep -n "MockDockPanelProps\|interface Mock" src/features/workspace/WorkspaceView.subscription.test.tsx src/features/workspace/WorkspaceView.command-palette.test.tsx
```

Each `MockDockPanelProps` should declare every required prop from `DockPanelBaseProps` (the v1 set: `tab`, `onTabChange`, `onClose`, `bottomHeight`, `onBottomHeightAdjust`, `position`, `onPositionChange`, `filesOnFileSelect`, `selectedFilePath`, `content`). If TypeScript complains, add the missing prop to the mock interface.

- [ ] **Step 7.6: Run all WorkspaceView tests**

```bash
npx vitest run src/features/workspace/
```

Expected: all pass. The new `'Dock position layout'` tests are GREEN. The existing `'BottomDrawer is present below TerminalZone'` test in `WorkspaceView.test.tsx` may need updating: the panel is now inside `dock-canvas-wrapper`, not a direct sibling of `Tabs`. Update its query.

- [ ] **Step 7.7: Manual verification (xterm fit) — BLOCKING**

Run the app:

```bash
npm run dev
```

Open three sessions. Click each DockSwitcher button in turn (bottom → left → right → bottom). Verify both:

- The terminal does not clip / overflow when the panel docks left or right.
- Switching layouts triggers an xterm fit (the prompt re-renders correctly without manual resize).

**If xterm clips:** do one of the two below — do NOT commit while the clipping reproduces.

1. **Preferred (fix in this PR):** Wrap the layout transition with a one-frame defer so xterm sees the new container before measuring:

   ```tsx
   useEffect(() => {
     const frame = requestAnimationFrame(() => {
       // Trigger a no-op resize on every TerminalPane so FitAddon re-fits.
       paneRefs.current.forEach((ref) => ref?.refit())
     })
     return () => cancelAnimationFrame(frame)
   }, [dockPosition, isDockOpen])
   ```

   Add a `refit()` method on TerminalPane that calls its FitAddon. Include the call signature in the same commit as Task 7.

2. **Fallback (explicit deferral):** If the rAF approach doesn't resolve the issue, open a new GitHub issue titled `fix(terminal): re-fit xterm after dock-position change` referencing this plan, label `bug`, and add a `// TODO(#NNN)` comment at the dockPosition state-change site. Commit `feat(workspace): main canvas reacts to dockPosition` WITHOUT the bug present — meaning if it ships broken, revert Task 7's WorkspaceView edit and pause the plan. Do not ship a known clipping regression.

- [ ] **Step 7.8: Run lint + type-check**

```bash
npm run lint
npm run type-check
```

Expected: clean.

- [ ] **Step 7.9: Commit**

```bash
git add src/features/workspace/
git commit -m "feat(workspace): main canvas reacts to dockPosition (#166)"
```

---

## Task 8: Add DockPeekButton + render when !isDockOpen

**Goal:** When `isDockOpen` is false, DockPanel unmounts and `DockPeekButton` renders on the edge facing the (now-collapsed) dock. Clicking opens.

**Files:**

- Create: `src/features/workspace/components/DockPeekButton.tsx`
- Create: `src/features/workspace/components/DockPeekButton.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/WorkspaceView.test.tsx`

- [ ] **Step 8.1: Write the failing tests**

`DockPeekButton.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { DockPeekButton } from './DockPeekButton'

describe('DockPeekButton', () => {
  test('bottom: renders "show panel" label + expand_less icon', () => {
    render(<DockPeekButton position="bottom" onOpen={vi.fn()} />)

    const button = screen.getByRole('button', { name: /show panel/i })
    expect(button).toHaveTextContent(/show panel/i)
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon
    const icon = button.querySelector('.material-symbols-outlined')
    expect(icon).toHaveTextContent('expand_less')
  })

  test('left: renders chevron_left, no label', () => {
    render(<DockPeekButton position="left" onOpen={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: /show panel docked left/i,
    })
    expect(button).not.toHaveTextContent(/show panel/i)
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon
    const icon = button.querySelector('.material-symbols-outlined')
    expect(icon).toHaveTextContent('chevron_left')
  })

  test('right: renders chevron_right, no label', () => {
    render(<DockPeekButton position="right" onOpen={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: /show panel docked right/i,
    })
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon
    const icon = button.querySelector('.material-symbols-outlined')
    expect(icon).toHaveTextContent('chevron_right')
  })

  test('clicking calls onOpen', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<DockPeekButton position="bottom" onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: /show panel/i }))
    expect(onOpen).toHaveBeenCalled()
  })

  test('bottom: width spans full available, height is 26px (h-[26px])', () => {
    render(<DockPeekButton position="bottom" onOpen={vi.fn()} />)

    expect(screen.getByRole('button', { name: /show panel/i })).toHaveClass(
      'h-[26px]',
      'w-full'
    )
  })

  test('left: height spans full available, width is 26px (w-[26px])', () => {
    render(<DockPeekButton position="left" onOpen={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /show panel docked left/i })
    ).toHaveClass('w-[26px]', 'h-full')
  })
})
```

- [ ] **Step 8.2: Run — expect failure**

```bash
npx vitest run src/features/workspace/components/DockPeekButton.test.tsx
```

Expected: 6 FAILs — module doesn't exist.

- [ ] **Step 8.3: Create DockPeekButton.tsx**

```tsx
import type { ReactElement } from 'react'
import type { DockPosition } from './DockSwitcher'

interface DockPeekButtonProps {
  position: DockPosition
  onOpen: () => void
}

const ICON: Record<DockPosition, string> = {
  bottom: 'expand_less',
  left: 'chevron_left',
  right: 'chevron_right',
}

const ARIA: Record<DockPosition, string> = {
  bottom: 'Show panel',
  left: 'Show panel docked left',
  right: 'Show panel docked right',
}

/**
 * DockPeekButton — edge-of-canvas affordance rendered in place of DockPanel
 * when `isDockOpen` is false. Lives next to TerminalZone in WorkspaceView's
 * inner flex wrapper and follows the same `dockBefore` ordering as the open
 * panel. Clicking re-opens the dock.
 */
export const DockPeekButton = ({
  position,
  onOpen,
}: DockPeekButtonProps): ReactElement => {
  const isVertical = position === 'bottom'

  const sizeClass = isVertical ? 'w-full h-[26px]' : 'h-full w-[26px]'
  const borderClass =
    position === 'bottom'
      ? 'border-t border-[rgba(74,68,79,0.25)]'
      : position === 'left'
        ? 'border-r border-[rgba(74,68,79,0.25)]'
        : 'border-l border-[rgba(74,68,79,0.25)]'

  return (
    <button
      type="button"
      aria-label={ARIA[position]}
      onClick={onOpen}
      className={`flex items-center justify-center gap-2 bg-[#0d0d1c] text-[#8a8299] hover:bg-[rgba(203,166,247,0.10)] hover:text-[#e2c7ff] transition-colors cursor-pointer ${sizeClass} ${borderClass}`}
    >
      <span
        className="material-symbols-outlined text-[14px]"
        aria-hidden="true"
      >
        {ICON[position]}
      </span>
      {isVertical && (
        <span className="font-mono text-[10.5px] tracking-wide">
          show panel
        </span>
      )}
    </button>
  )
}
```

- [ ] **Step 8.4: Run the new tests — expect green**

```bash
npx vitest run src/features/workspace/components/DockPeekButton.test.tsx
```

Expected: 6 PASS.

- [ ] **Step 8.5: Wire DockPeekButton into WorkspaceView**

In the inner-flex IIFE from Task 7, replace:

```tsx
const dock = isDockOpen ? (
  <DockPanel ... />
) : null
```

With:

```tsx
const dockOrPeek = isDockOpen ? (
  <DockPanel ... />
) : (
  <DockPeekButton
    position={dockPosition}
    onOpen={() => setIsDockOpen(true)}
  />
)
```

And update the surrounding placement to use `dockOrPeek` instead of `dock`:

```tsx
{
  dockBefore ? dockOrPeek : null
}
{
  terminal
}
{
  !dockBefore ? dockOrPeek : null
}
```

Add the import at the top of `WorkspaceView.tsx`:

```tsx
import { DockPeekButton } from './components/DockPeekButton'
```

- [ ] **Step 8.6: Add a WorkspaceView-level layout test**

In `WorkspaceView.test.tsx`:

```tsx
test('!isDockOpen + dockPosition=left renders DockPeekButton BEFORE TerminalZone', async () => {
  const user = userEvent.setup()
  renderWorkspaceView()

  // Switch to left dock, then collapse.
  await user.click(screen.getByRole('button', { name: /dock: left/i }))
  await user.click(screen.getByRole('button', { name: /collapse panel/i }))

  const inner = screen.getByTestId('dock-canvas-wrapper')
  const peek = screen.getByRole('button', { name: /show panel docked left/i })
  const term = screen.getByTestId('terminal-zone-wrapper')

  expect(inner).toContainElement(peek)
  expect(inner).toContainElement(term)

  const children = Array.from(inner.children)
  expect(children.indexOf(peek)).toBeLessThan(children.indexOf(term))
})

test('!isDockOpen + dockPosition=bottom renders DockPeekButton AFTER TerminalZone', async () => {
  const user = userEvent.setup()
  renderWorkspaceView()

  await user.click(screen.getByRole('button', { name: /collapse panel/i }))

  const inner = screen.getByTestId('dock-canvas-wrapper')
  const peek = screen.getByRole('button', { name: /show panel/i })
  const term = screen.getByTestId('terminal-zone-wrapper')

  const children = Array.from(inner.children)
  expect(children.indexOf(peek)).toBeGreaterThan(children.indexOf(term))
})
```

- [ ] **Step 8.7: Run the full test suite**

```bash
npx vitest run
```

Expected: all pass. If `WorkspaceView.subscription.test.tsx` or `WorkspaceView.command-palette.test.tsx` was mocking DockPanel-only, the mock no longer covers the peek case — these tests should still pass because their flows never collapse the panel.

- [ ] **Step 8.8: Manual verification**

```bash
npm run dev
```

- Dock the panel bottom, click the close button → peek bar at terminal bottom edge with "show panel" label + ▴ icon. Click → reopens.
- Dock left, close → peek button on terminal's left edge with chevron_left, icon-only. Click → reopens.
- Dock right, close → peek button on right edge with chevron_right. Click → reopens.
- Bottom dock: drag the resize handle to a non-default height, close, reopen → height is preserved (because `dockHeightResize.size` lives in WorkspaceView's `useResizable` call; if you skipped that lift, height resets — go back to spec §State model and lift the hook).

If the bottom-dock height does NOT survive close/reopen, add the lifted-resize step here as Step 8.9 before committing.

- [ ] **Step 8.9: Run lint + type-check**

```bash
npm run lint
npm run type-check
```

Expected: clean.

- [ ] **Step 8.10: Commit**

```bash
git add src/features/workspace/
git commit -m "feat(dock-peek): add DockPeekButton + render when !isDockOpen (#166)"
```

---

## Final verification

- [ ] **Run the full test suite**

```bash
npm run test
```

Expected: all green.

- [ ] **Lint + type-check**

```bash
npm run lint
npm run type-check
```

- [ ] **Manual smoke test**

```bash
npm run dev
```

Click through every dock position × open/closed × tab combination:

| position | open | tab    | expected                                              |
| -------- | ---- | ------ | ----------------------------------------------------- |
| bottom   | yes  | editor | editor renders at 40% height bottom                   |
| bottom   | yes  | diff   | diff renders                                          |
| bottom   | yes  | files  | DockFilesPanel renders                                |
| bottom   | no   | —      | DockPeekButton at bottom edge with "show panel" label |
| left     | yes  | editor | editor renders at 40% width left                      |
| left     | no   | —      | DockPeekButton at left edge, chevron_left icon        |
| right    | yes  | files  | DockFilesPanel renders at 40% width right             |
| right    | no   | —      | DockPeekButton at right edge, chevron_right icon      |

Verify clicking a file in DockFilesPanel triggers the unsaved-changes dialog when the editor is dirty.

- [ ] **Open the PR**

```bash
git push -u origin dev
gh pr create --title "feat(dock-panel): refactor BottomDrawer → DockPanel + Files tab + position switcher" --body "$(cat <<'EOF'
## Summary
- Replaces BottomDrawer with DockPanel (positionable: bottom/left/right)
- Adds Files tab + DockFilesPanel
- Adds DockSwitcher (3-button compact layout picker, mirrors prototype splitview.jsx:757-804)
- Adds DockPeekButton (edge-aware collapsed-state affordance)
- Lifts dock state (position, open/closed, tab, bottom height) to WorkspaceView

## Test plan
- [x] Unit: DockPanel.test.tsx (controlled-only contract + 3 tabs + chip styling)
- [x] Unit: DockSwitcher.test.tsx (3 buttons, no Hidden, active styling)
- [x] Unit: DockPeekButton.test.tsx (icon + label per position)
- [x] Unit: DockFilesPanel.test.tsx (tree render + fullPath remap)
- [x] Integration: WorkspaceView.test.tsx (dock-position-driven layout, peek render order)
- [x] Manual: 8 dock-position × open/closed × tab combinations
- [x] Manual: unsaved-changes guard fires from docked Files tree

Closes #166.

Spec: docs/superpowers/specs/2026-05-16-dockpanel-refactor-design.md
Plan: docs/superpowers/plans/2026-05-16-dockpanel-refactor-plan.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (planner)

Spec coverage check, run after writing the plan:

- §Goal — covered by the 8-task arc (rename → state lift → restyle → Files → switcher → mount → layout → peek).
- §Source of truth (5 references) — referenced inline in Task 5 (DockSwitcher) and Task 8 (DockPeekButton).
- §State domain for `dockPosition` — covered in Task 2 (state lift) + Task 7 (layout reactivity).
- §Scope in-scope items 1-8 — covered tasks 1-8 respectively.
- §Out-of-scope items — none implemented, all called out in the spec.
- §DockPanel component contract — covered by Tasks 2, 3, 4, 6.
- §DockSwitcher component contract — covered by Task 5.
- §State model + WorkspaceView layout reactivity — covered by Tasks 2, 7.
- §DockFilesPanel + path remap — covered by Task 4.
- §Closed-state peek + edge awareness + aria — covered by Task 8.
- §Test strategy — every "(new)" / "(kept)" / "(dropped)" item from the spec maps to a Task step.
- §Implementation plan — 1:1 with Tasks 1-8.
- §Risks (xterm fit + drag handle gating + visual diff) — Task 7.4 (drag handle gating), Task 7.7 (xterm fit verification), final smoke test (visual diff).

<!-- codex-reviewed: 2026-05-17T06:07:03Z -->
