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
    feedbackCount: 0,
    onFinishFeedback: vi.fn<() => void>(),
    onDiscardFeedback: vi.fn<() => void>(),
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
// which then holds a flex row (PriorityPlus + the pinned feedback actions), so
// we drill two levels down to reach the measurement container.
const priorityPlusRoot = (): HTMLElement => {
  const toolbar = screen.getByRole('toolbar', { name: /diff toolbar/i })
  // eslint-disable-next-line testing-library/no-node-access -- read toolbar row wrapper
  const row = toolbar.firstElementChild
  // eslint-disable-next-line testing-library/no-node-access -- read PriorityPlus root
  const inner = row?.firstElementChild
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

  test('renders the redesigned toolbar groups on the unstaged view', () => {
    // The redesign reshapes the flat chips into grouped pills: the file-nav
    // group is a lavender FilePill (prev arrow + basename + N/M badge + next
    // arrow), hunk-nav is an azure ChangeStepper (data_object + N/N + vertical
    // arrows), and the staging buttons live inside the ToolWell. The View ▾
    // dropdown stays consolidated.
    renderToolbar({ diffMode: 'unstaged', selectedFileName: 'src/App.tsx' })

    // Segmented: split / unified.
    expect(screen.getByRole('button', { name: 'split' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'unified' })).toBeInTheDocument()

    // File pill (PR1: FUNCTIONAL) — arrows + basename + counter.
    expect(
      screen.getByRole('button', { name: /previous file/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /next file/i })
    ).toBeInTheDocument()
    // File pill shows the basename of the selected path.
    expect(screen.getByText('App.tsx')).toBeInTheDocument()
    // File counter — currentFileIndex 1 of 9 → "2/9" (group accessible name).
    expect(
      screen.getByRole('group', { name: /file 2\/9/i })
    ).toBeInTheDocument()

    // Change stepper — vertical hunk arrows + counter.
    expect(
      screen.getByRole('button', { name: /prev hunk/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /next hunk/i })
    ).toBeInTheDocument()

    // Stepper group accessible name carries the ratio.
    expect(
      screen.getByRole('group', { name: /hunk 1\/3/i })
    ).toBeInTheDocument()

    // The speculative annotation tools (comment / highlight / erase) were
    // dropped — commenting is the gutter `+` affordance, and highlight/erase
    // had no backend or use case. The tool-well is staging-only now.
    expect(
      screen.queryByRole('button', { name: /add comment/i })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /highlight selection/i })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /clear markup/i })
    ).not.toBeInTheDocument()

    // Tool-well staging buttons (PR1: disabled placeholders here).
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

    // Config chips — the small-caps key + value both surface on the chip
    // itself (e.g. "Highlight" + "Word"), not as an external caption.
    expect(
      screen.getByRole('button', { name: /highlight.*word/i })
    ).toBeInTheDocument() // highlight chip

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

    expect(
      screen.getByRole('group', { name: /hunk 0\/0/i })
    ).toBeInTheDocument()
  })

  test('counter chip reflects focusedHunkIndex + 1', () => {
    renderToolbar({ totalHunks: 5, focusedHunkIndex: 2 })

    expect(
      screen.getByRole('group', { name: /hunk 3\/5/i })
    ).toBeInTheDocument()
  })

  test('file counter renders currentFileIndex + 1 / totalFiles', () => {
    renderToolbar({ currentFileIndex: 4, totalFiles: 9 })

    expect(
      screen.getByRole('group', { name: /file 5\/9/i })
    ).toBeInTheDocument()
  })

  test('file counter clamps to 1/N when nothing is selected (index -1)', () => {
    renderToolbar({ currentFileIndex: -1, totalFiles: 3 })

    expect(
      screen.getByRole('group', { name: /file 1\/3/i })
    ).toBeInTheDocument()
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
    expect(
      screen.getByRole('group', { name: /file 1\/1/i })
    ).toBeInTheDocument()
  })

  test('the two counter groups carry distinguishing material icons', () => {
    // Material symbols render their ligature name as text content, so the
    // file counter contains "description" and the hunk counter "data_object".
    // This is what keeps the two `‹ N/M ›` arrow groups visually distinct.
    renderToolbar({ currentFileIndex: 0, totalFiles: 2, totalHunks: 3 })

    const fileCounter = screen.getByRole('group', { name: /file 1\/2/i })
    expect(fileCounter).toHaveTextContent('description')

    const hunkCounter = screen.getByRole('group', { name: /hunk 1\/3/i })
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

    await user.click(screen.getByRole('button', { name: /highlight.*word/i }))
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

    const row = await screen.findByRole('menuitemcheckbox', {
      name: /line numbers/i,
    })
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

    test('Discard All (IconButton anchor) forwards the dialog disclosure attributes', async () => {
      const user = userEvent.setup()

      const onDiscardAll = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined)

      renderToolbar({ onDiscardAll, selectedFileName: 'src/App.tsx' })

      const trigger = screen.getByRole('button', { name: /^discard all$/i })
      // The migrated IconButton forwards aria-haspopup / aria-expanded through
      // ...rest; closed reads aria-expanded=false.
      expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      await user.click(trigger)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    test('Discard All button exposes a tooltip on hover', async () => {
      const user = userEvent.setup()

      const onDiscardAll = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined)

      renderToolbar({ onDiscardAll, selectedFileName: 'src/App.tsx' })

      // Hover (not click) — the destructive action needs a label even before
      // the confirm popover opens. The tooltip wraps the span around the
      // button, so hovering the button surfaces it via React's synthetic
      // mouseenter.
      await user.hover(screen.getByRole('button', { name: /^discard all$/i }))

      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        /discard all changes/i
      )
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

  describe('Hunk navigation chips — PR3 functional mode', () => {
    test('clicking next-hunk chip calls onNextHunk', async () => {
      const user = userEvent.setup()
      const onNextHunk = vi.fn<() => void>()

      renderToolbar({ onNextHunk, onPrevHunk: vi.fn(), totalHunks: 3 })

      await user.click(screen.getByRole('button', { name: /next hunk/i }))
      expect(onNextHunk).toHaveBeenCalledTimes(1)
    })

    test('clicking prev-hunk chip calls onPrevHunk', async () => {
      const user = userEvent.setup()
      const onPrevHunk = vi.fn<() => void>()

      renderToolbar({ onPrevHunk, onNextHunk: vi.fn(), totalHunks: 3 })

      await user.click(screen.getByRole('button', { name: /prev hunk/i }))
      expect(onPrevHunk).toHaveBeenCalledTimes(1)
    })

    test('hunk chips are enabled when totalHunks > 1 and handlers provided', () => {
      renderToolbar({
        onPrevHunk: vi.fn(),
        onNextHunk: vi.fn(),
        totalHunks: 3,
        focusedHunkIndex: 1,
      })

      expect(
        screen.getByRole('button', { name: /prev hunk/i })
      ).not.toBeDisabled()

      expect(
        screen.getByRole('button', { name: /next hunk/i })
      ).not.toBeDisabled()
    })

    test('hunk chips are disabled when totalHunks <= 1', async () => {
      const user = userEvent.setup()
      const onPrevHunk = vi.fn<() => void>()
      const onNextHunk = vi.fn<() => void>()

      renderToolbar({
        onPrevHunk,
        onNextHunk,
        totalHunks: 1,
        focusedHunkIndex: 0,
      })

      const prev = screen.getByRole('button', { name: /prev hunk/i })
      const next = screen.getByRole('button', { name: /next hunk/i })
      expect(prev).toBeDisabled()
      expect(next).toBeDisabled()

      await user.click(prev)
      await user.click(next)
      expect(onPrevHunk).not.toHaveBeenCalled()
      expect(onNextHunk).not.toHaveBeenCalled()
    })

    test('counter shows focusedHunkIndex + 1 / totalHunks', () => {
      renderToolbar({ totalHunks: 3, focusedHunkIndex: 1 })

      expect(
        screen.getByRole('group', { name: /hunk 2\/3/i })
      ).toBeInTheDocument()
    })
  })

  test('does not render the pinned feedback actions when feedbackCount is 0', () => {
    renderToolbar({ feedbackCount: 0 })

    expect(
      screen.queryByRole('button', { name: /finish feedback/i })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: /discard all feedback/i })
    ).not.toBeInTheDocument()
  })

  test('renders the pinned Discard + Finish actions when feedbackCount > 0', () => {
    renderToolbar({ feedbackCount: 3 })

    // Primary-gradient Finish button — accessible name carries the count.
    const finish = screen.getByRole('button', {
      name: /finish feedback \(3\)/i,
    })
    expect(finish).toBeInTheDocument()
    expect(finish).toHaveAttribute('aria-keyshortcuts', 'Y')
    // The count pill surfaces the number on the button text.
    expect(finish).toHaveTextContent('3')

    expect(
      screen.getByRole('button', { name: /discard all feedback/i })
    ).toBeInTheDocument()
  })

  test('disables the pinned feedback actions when their handlers are omitted', () => {
    renderToolbar({
      feedbackCount: 3,
      onFinishFeedback: undefined,
      onDiscardFeedback: undefined,
    })

    expect(
      screen.getByRole('button', { name: /finish feedback/i })
    ).toBeDisabled()

    expect(
      screen.getByRole('button', { name: /discard all feedback/i })
    ).toBeDisabled()
  })

  test('clicking the Finish action calls onFinishFeedback once', async () => {
    const user = userEvent.setup()
    const onFinishFeedback = vi.fn<() => void>()

    renderToolbar({ feedbackCount: 3, onFinishFeedback })

    await user.click(screen.getByRole('button', { name: /finish feedback/i }))
    expect(onFinishFeedback).toHaveBeenCalledTimes(1)
  })

  test('clicking the Discard action calls onDiscardFeedback once', async () => {
    const user = userEvent.setup()
    const onDiscardFeedback = vi.fn<() => void>()

    renderToolbar({ feedbackCount: 3, onDiscardFeedback })

    await user.click(
      screen.getByRole('button', { name: /discard all feedback/i })
    )
    expect(onDiscardFeedback).toHaveBeenCalledTimes(1)
  })

  test('renders active-file refresh as a pinned toolbar action', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn<() => void>()

    renderToolbar({
      onRefreshActiveFile: onRefresh,
    })

    const refresh = screen.getByRole('button', { name: 'refresh diff' })
    expect(refresh).toHaveTextContent('Refresh diff')
    expect(refresh).toHaveAttribute('aria-keyshortcuts', 'r')
    expect(within(refresh).getByText('r')).toHaveAttribute(
      'aria-hidden',
      'true'
    )

    await user.click(refresh)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  test('the pinned feedback actions render outside PriorityPlus (never overflow)', () => {
    renderToolbar({ feedbackCount: 2 })

    // The actions live in a sibling container after the PriorityPlus root, not
    // inside it — so they are excluded from overflow measurement entirely.
    const finish = screen.getByRole('button', { name: /finish feedback/i })
    const ppRoot = priorityPlusRoot()
    expect(ppRoot.contains(finish)).toBe(false)
  })

  test('PriorityPlus collapses the lower-priority groups into the overflow menu at a narrow width', () => {
    renderToolbar({ diffMode: 'unstaged' })

    // The redesign mounts 7 grouped chips into PriorityPlus (segmented, file
    // pill, tool-well, change stepper, highlight, theme, view). Lay the first
    // four on row 0 and the trailing three on row 1 so the measurement loop
    // folds the lowest-priority groups (highlight → theme → view) into the
    // `…` menu first. Each wrapper is 60 px wide with 12 px gaps; the container
    // is wide enough that the last visible group leaves room for the overflow
    // chip on row 0 (no cutoff pull-back).
    const layouts: ItemLayout[] = []
    for (let i = 0; i < 7; i++) {
      const row = i < 4 ? 0 : 1
      const colIndex = row === 0 ? i : i - 4
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

    // Visible row holds the highest-priority groups: the segmented control and
    // the functional file pill stay on the bar.
    expect(screen.getByRole('button', { name: 'split' })).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /previous file/i })
    ).toBeInTheDocument()
  })
})
