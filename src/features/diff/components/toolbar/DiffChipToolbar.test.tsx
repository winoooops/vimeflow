import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BaseDiffOptions, DiffsThemeNames } from '@pierre/diffs'
import { DiffChipToolbar, type DiffChipToolbarProps } from './DiffChipToolbar'

// Capture the ResizeObserver callback so the test can flush PriorityPlus
// measurements deterministically — same pattern as PriorityPlus.test.tsx.
let resizeCallback: ResizeObserverCallback | null = null

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback
  }
  observe(): void {
    // No-op — the test fires the callback directly.
  }
  unobserve(): void {
    // No-op.
  }
  disconnect(): void {
    // No-op.
  }
}

const fireResize = (): void => {
  act(() => {
    resizeCallback?.([], {} as ResizeObserver)
  })
}

type DiffStyle = NonNullable<BaseDiffOptions['diffStyle']>
type LineDiffType = NonNullable<BaseDiffOptions['lineDiffType']>
type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>
type Overflow = NonNullable<BaseDiffOptions['overflow']>

const renderToolbar = (
  overrides: Partial<DiffChipToolbarProps> = {}
): ReturnType<typeof render> => {
  const baseProps: DiffChipToolbarProps = {
    diffMode: 'unstaged',
    diffStyle: 'split',
    onDiffStyleChange: vi.fn<(next: DiffStyle) => void>(),
    theme: 'pierre-dark' as DiffsThemeNames,
    onThemeChange: vi.fn<(next: DiffsThemeNames) => void>(),
    lineDiffType: 'word',
    onLineDiffTypeChange: vi.fn<(next: LineDiffType) => void>(),
    diffIndicators: 'classic',
    onDiffIndicatorsChange: vi.fn<(next: DiffIndicators) => void>(),
    overflow: 'scroll',
    onOverflowChange: vi.fn<(next: Overflow) => void>(),
    disableLineNumbers: false,
    onDisableLineNumbersChange: vi.fn<(next: boolean) => void>(),
    disableBackground: false,
    onDisableBackgroundChange: vi.fn<(next: boolean) => void>(),
    disableFileHeader: false,
    onDisableFileHeaderChange: vi.fn<(next: boolean) => void>(),
    stickyHeader: true,
    onStickyHeaderChange: vi.fn<(next: boolean) => void>(),
    totalHunks: 3,
    focusedHunkIndex: 0,
    onPrevFile: vi.fn<() => void>(),
    onNextFile: vi.fn<() => void>(),
    currentFileIndex: 1,
    totalFiles: 9,
  }

  return render(<DiffChipToolbar {...baseProps} {...overrides} />)
}

// PriorityPlus uses offsetTop/offsetHeight/offsetLeft/offsetWidth +
// clientWidth on its container to decide which chips fit on the visible row.
// jsdom returns 0 for those by default; override them so the measurement
// loop has a real (test-controlled) layout to compare against.
interface ItemLayout {
  offsetTop: number
  offsetHeight: number
  offsetLeft: number
  offsetWidth: number
}

const stubLayout = (
  root: HTMLElement,
  layouts: readonly ItemLayout[],
  containerWidth: number
): void => {
  Object.defineProperty(root, 'clientWidth', {
    value: containerWidth,
    configurable: true,
  })

  // The overflow chip carries an aria-label starting with "Show " (e.g.
  // "Show 5 more controls"); skip that wrapper so the wrappers we stub map
  // one-to-one with the test's children list. Item wrappers don't have any
  // aria-label of their own.
  // eslint-disable-next-line testing-library/no-node-access -- iterate PriorityPlus wrappers
  const childNodes = root.children

  const wrappers = Array.from(childNodes).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      (el.getAttribute('aria-label') ?? '').startsWith('Show ') === false
  )

  layouts.forEach((layout, index) => {
    const node = wrappers[index]
    if (!node) {
      return
    }
    Object.defineProperty(node, 'offsetTop', {
      value: layout.offsetTop,
      configurable: true,
    })

    Object.defineProperty(node, 'offsetHeight', {
      value: layout.offsetHeight,
      configurable: true,
    })

    Object.defineProperty(node, 'offsetLeft', {
      value: layout.offsetLeft,
      configurable: true,
    })

    Object.defineProperty(node, 'offsetWidth', {
      value: layout.offsetWidth,
      configurable: true,
    })
  })
}

// Return the inner flex container PriorityPlus mounts the chips into. The
// toolbar wraps that in an outer styled `<div role="toolbar">` for padding,
// so we have to drill one level down to reach the measurement container.
const priorityPlusRoot = (): HTMLElement => {
  const toolbar = screen.getByRole('toolbar', { name: /diff toolbar/i })
  // eslint-disable-next-line testing-library/no-node-access -- read PriorityPlus root
  const inner = toolbar.firstElementChild
  if (!(inner instanceof HTMLElement)) {
    throw new Error('PriorityPlus root not found inside the toolbar')
  }

  return inner
}

describe('DiffChipToolbar', () => {
  beforeEach(() => {
    resizeCallback = null
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resizeCallback = null
  })

  test('renders the consolidated 13 functional chips on the unstaged view', () => {
    // After PR #263 follow-up: indicators / overflow dropdowns + the four
    // boolean toggle chips collapsed into a single View ▾ chip. PR1 then adds
    // the functional file-nav group (prev-file + counter + next-file), so the
    // unstaged view ships 13 visible chips (10 + 3).
    renderToolbar({ diffMode: 'unstaged' })

    // Segmented: split / unified.
    expect(screen.getByRole('button', { name: 'split' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'unified' })).toBeInTheDocument()

    // File navigation chips (PR1: FUNCTIONAL).
    expect(
      screen.getByRole('button', { name: /previous file/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /next file/i })
    ).toBeInTheDocument()
    // File counter — currentFileIndex 1 of 9 → "2/9".
    expect(screen.getByLabelText(/file 2\/9/i)).toBeInTheDocument()

    // Hunk navigation chips (PR1: disabled placeholders).
    expect(
      screen.getByRole('button', { name: /prev hunk/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /next hunk/i })
    ).toBeInTheDocument()
    // Counter text chip — accessible name carries the ratio.
    expect(screen.getByLabelText(/hunk 1\/3/i)).toBeInTheDocument()

    // Staging chips (PR1: disabled placeholders).
    expect(screen.getByRole('button', { name: /^stage$/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^discard$/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /^discard all$/i })
    ).toBeInTheDocument()

    // Unstage is omitted on the unstaged view.
    expect(
      screen.queryByRole('button', { name: /unstage/i })
    ).not.toBeInTheDocument()

    // Dropdown triggers — value labels surface on the chip itself.
    expect(screen.getByRole('button', { name: /^Word$/ })).toBeInTheDocument() // highlight

    expect(
      screen.getByRole('button', { name: /pierre-dark/i })
    ).toBeInTheDocument() // theme

    // Consolidated View ▾ chip replaces the two dropdowns + four toggles.
    expect(
      screen.getByRole('button', { name: /view settings/i })
    ).toBeInTheDocument()

    // The standalone chips that used to live on the bar must NOT render
    // anymore — they only appear inside the View ▾ popover (verified in
    // ViewSettingsDropdown.test.tsx). Searching for the trigger by the
    // pre-consolidation accessible names should now miss the toolbar.
    expect(
      screen.queryByRole('button', { name: /^classic$/i })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /^scroll$/i })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /^line numbers$/i })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /^sticky header$/i })
    ).not.toBeInTheDocument()
  })

  test('renders the unstage chip on the staged view', () => {
    renderToolbar({ diffMode: 'staged' })

    expect(screen.getByRole('button', { name: /unstage/i })).toBeInTheDocument()
  })

  test('counter chip renders 0/0 when there are no hunks', () => {
    renderToolbar({ totalHunks: 0 })

    expect(screen.getByLabelText(/hunk 0\/0/i)).toBeInTheDocument()
  })

  test('counter chip reflects focusedHunkIndex + 1', () => {
    renderToolbar({ totalHunks: 5, focusedHunkIndex: 2 })

    expect(screen.getByLabelText(/hunk 3\/5/i)).toBeInTheDocument()
  })

  test('file counter renders currentFileIndex + 1 / totalFiles', () => {
    renderToolbar({ currentFileIndex: 4, totalFiles: 9 })

    expect(screen.getByLabelText(/file 5\/9/i)).toBeInTheDocument()
  })

  test('file counter clamps to 1/N when nothing is selected (index -1)', () => {
    renderToolbar({ currentFileIndex: -1, totalFiles: 3 })

    expect(screen.getByLabelText(/file 1\/3/i)).toBeInTheDocument()
  })

  test('clicking the file arrows fires onPrevFile / onNextFile', async () => {
    const user = userEvent.setup()
    const onPrevFile = vi.fn<() => void>()
    const onNextFile = vi.fn<() => void>()

    renderToolbar({
      onPrevFile,
      onNextFile,
      currentFileIndex: 1,
      totalFiles: 9,
    })

    await user.click(screen.getByRole('button', { name: /next file/i }))
    expect(onNextFile).toHaveBeenCalledTimes(1)
    expect(onPrevFile).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /previous file/i }))
    expect(onPrevFile).toHaveBeenCalledTimes(1)
  })

  test('file arrows are disabled (inert) when totalFiles === 1', async () => {
    const user = userEvent.setup()
    const onPrevFile = vi.fn<() => void>()
    const onNextFile = vi.fn<() => void>()

    renderToolbar({
      onPrevFile,
      onNextFile,
      currentFileIndex: 0,
      totalFiles: 1,
    })

    const prev = screen.getByRole('button', { name: /previous file/i })
    const next = screen.getByRole('button', { name: /next file/i })
    expect(prev).toBeDisabled()
    expect(next).toBeDisabled()

    // Clicks on a disabled button are no-ops — no wrap-around on a single file.
    await user.click(prev)
    await user.click(next)
    expect(onPrevFile).not.toHaveBeenCalled()
    expect(onNextFile).not.toHaveBeenCalled()

    // Counter still shows the position.
    expect(screen.getByLabelText(/file 1\/1/i)).toBeInTheDocument()
  })

  test('the two counter groups carry distinguishing material icons', () => {
    // Material symbols render their ligature name as text content, so the
    // file counter contains "description" and the hunk counter "data_object".
    // This is what keeps the two `‹ N/M ›` arrow groups visually distinct.
    renderToolbar({ currentFileIndex: 0, totalFiles: 2, totalHunks: 3 })

    const fileCounter = screen.getByLabelText(/file 1\/2/i)
    expect(fileCounter).toHaveTextContent('description')

    const hunkCounter = screen.getByLabelText(/hunk 1\/3/i)
    expect(hunkCounter).toHaveTextContent('data_object')
  })

  test('clicking split / unified fires onDiffStyleChange with the new value', async () => {
    const user = userEvent.setup()
    const onDiffStyleChange = vi.fn<(next: DiffStyle) => void>()

    renderToolbar({ diffStyle: 'split', onDiffStyleChange })

    await user.click(screen.getByRole('button', { name: 'unified' }))
    expect(onDiffStyleChange).toHaveBeenCalledTimes(1)
    expect(onDiffStyleChange).toHaveBeenCalledWith('unified')
  })

  test('selecting a theme dropdown option fires onThemeChange', async () => {
    const user = userEvent.setup()
    const onThemeChange = vi.fn<(next: DiffsThemeNames) => void>()

    renderToolbar({ onThemeChange })

    await user.click(screen.getByRole('button', { name: /pierre-dark/i }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: /dracula/i }))

    expect(onThemeChange).toHaveBeenCalledTimes(1)
    expect(onThemeChange).toHaveBeenCalledWith('dracula')
  })

  test('selecting a highlight dropdown option fires onLineDiffTypeChange', async () => {
    const user = userEvent.setup()
    const onLineDiffTypeChange = vi.fn<(next: LineDiffType) => void>()

    renderToolbar({ onLineDiffTypeChange })

    await user.click(screen.getByRole('button', { name: /^Word$/ }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: /^Character/ }))

    expect(onLineDiffTypeChange).toHaveBeenCalledTimes(1)
    expect(onLineDiffTypeChange).toHaveBeenCalledWith('char')
  })

  test('opening the View ▾ chip reveals the consolidated controls', async () => {
    const user = userEvent.setup()
    renderToolbar()

    await user.click(screen.getByRole('button', { name: /view settings/i }))

    // All six row labels are present inside the portal-rendered popover.
    expect(await screen.findByText('Indicators')).toBeInTheDocument()
    expect(screen.getByText('Overflow')).toBeInTheDocument()
    expect(screen.getByText('Line numbers')).toBeInTheDocument()
    expect(screen.getByText('Background tint')).toBeInTheDocument()
    expect(screen.getByText('File header')).toBeInTheDocument()
    expect(screen.getByText('Sticky header')).toBeInTheDocument()
  })

  test('clicking the Line numbers row inside View ▾ inverts the disable flag', async () => {
    const user = userEvent.setup()
    const onDisableLineNumbersChange = vi.fn<(next: boolean) => void>()

    renderToolbar({
      disableLineNumbers: false,
      onDisableLineNumbersChange,
    })

    await user.click(screen.getByRole('button', { name: /view settings/i }))
    const row = await screen.findByRole('button', { name: /line numbers/i })
    await user.click(row)

    expect(onDisableLineNumbersChange).toHaveBeenCalledTimes(1)
    expect(onDisableLineNumbersChange).toHaveBeenCalledWith(true)
  })

  test('disabled staging chips do not fire any callback when clicked', async () => {
    const user = userEvent.setup()
    const onDiffStyleChange = vi.fn<(next: DiffStyle) => void>()

    // We don't pass click handlers to the aria-disabled placeholder chips —
    // they don't exist as props without onStage/onDiscard. Clicking them is a
    // no-op, so the diff-style segmented callback stays at zero calls.
    renderToolbar({ onDiffStyleChange })

    await user.click(screen.getByRole('button', { name: /^stage$/i }))
    await user.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(onDiffStyleChange).not.toHaveBeenCalled()
  })

  test('staging chips render with the disabled-placeholder styling when no handlers provided', () => {
    renderToolbar()

    const stage = screen.getByRole('button', { name: /^stage$/i })
    expect(stage).toHaveAttribute('aria-disabled', 'true')
    expect(stage.className).toContain('cursor-not-allowed')
    expect(stage.className).toContain('text-on-surface-variant/40')
  })

  test('placeholder chips can show the PR2 tooltip on hover', async () => {
    const user = userEvent.setup()
    renderToolbar()

    await user.hover(screen.getByRole('button', { name: /^stage$/i }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Available in PR2'
    )
  })

  describe('Staging chips — PR2 functional mode', () => {
    test('clicking the stage chip calls onStage once', async () => {
      const user = userEvent.setup()
      const onStage = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

      renderToolbar({ onStage })

      await user.click(screen.getByRole('button', { name: /^stage$/i }))
      expect(onStage).toHaveBeenCalledTimes(1)
    })

    test('clicking the discard chip calls onDiscard once', async () => {
      const user = userEvent.setup()

      const onDiscard = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined)

      renderToolbar({ onDiscard })

      await user.click(screen.getByRole('button', { name: /^discard$/i }))
      expect(onDiscard).toHaveBeenCalledTimes(1)
    })

    test('clicking the unstage chip on staged view calls onUnstage once', async () => {
      const user = userEvent.setup()

      const onUnstage = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined)

      renderToolbar({ diffMode: 'staged', onUnstage })

      await user.click(screen.getByRole('button', { name: /^unstage$/i }))
      expect(onUnstage).toHaveBeenCalledTimes(1)
    })

    test('staging === true disables all staging chips', () => {
      renderToolbar({
        onStage: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        onDiscard: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        onDiscardAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        staging: true,
      })

      expect(screen.getByRole('button', { name: /^stage$/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /^discard$/i })).toBeDisabled()
      expect(
        screen.getByRole('button', { name: /^discard all$/i })
      ).toBeDisabled()
    })

    test('Discard All shows confirmation popover on click', async () => {
      const user = userEvent.setup()

      const onDiscardAll = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined)

      renderToolbar({ onDiscardAll, selectedFileName: 'src/App.tsx' })

      await user.click(screen.getByRole('button', { name: /^discard all$/i }))

      // Confirmation popover should appear
      expect(
        await screen.findByText(/discard all changes to/i)
      ).toBeInTheDocument()
    })

    test('Discard All confirmation: Confirm calls onDiscardAll', async () => {
      const user = userEvent.setup()

      const onDiscardAll = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined)

      renderToolbar({ onDiscardAll, selectedFileName: 'src/App.tsx' })

      await user.click(screen.getByRole('button', { name: /^discard all$/i }))

      // The popover renders in a FloatingPortal. Locate it by the
      // dialog role that useRole(context, {role:'dialog'}) sets.
      const dialog = await screen.findByRole('dialog')
      await user.click(
        within(dialog).getByRole('button', { name: /^discard$/i })
      )

      expect(onDiscardAll).toHaveBeenCalledTimes(1)
    })

    test('Discard All confirmation: Cancel does not call onDiscardAll', async () => {
      const user = userEvent.setup()

      const onDiscardAll = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined)

      renderToolbar({ onDiscardAll, selectedFileName: 'src/App.tsx' })

      await user.click(screen.getByRole('button', { name: /^discard all$/i }))

      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

      expect(onDiscardAll).not.toHaveBeenCalled()
    })
  })

  test('PriorityPlus collapses the lower-priority chips into the overflow menu at a narrow width', () => {
    renderToolbar({ diffMode: 'unstaged' })

    // Layout: every chip is 60 px wide with 12 px gaps. The unstaged view
    // ships 13 chips (10 + the PR1 functional file-nav group), so the overflow
    // threshold shifts. Width 600 px fits the first eight chips plus the
    // 32 + 12 px overflow chip on the visible row; the trailing five fold into
    // the `…` menu (lowest priority overflows first).
    const layouts: ItemLayout[] = []
    for (let i = 0; i < 13; i++) {
      // Eight chips fit on row 1 (i < 8), the rest land on row 2 (i >= 8).
      const row = i < 8 ? 0 : 1
      const colIndex = row === 0 ? i : i - 8
      layouts.push({
        offsetTop: row === 0 ? 0 : 30,
        offsetHeight: 24,
        offsetLeft: colIndex * 72,
        offsetWidth: 60,
      })
    }

    stubLayout(priorityPlusRoot(), layouts, 600)
    fireResize()

    // Overflow chip appears.
    const overflowChip = screen.getByRole('button', {
      name: /more controls/i,
    })
    expect(overflowChip).toBeInTheDocument()

    // Visible row holds the highest-priority chips: segmented, the functional
    // file-nav group, then hunk prev/counter/next. Verify the top-priority
    // chips remain on the bar.
    expect(screen.getByRole('button', { name: 'split' })).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /previous file/i })
    ).toBeInTheDocument()
  })
})
