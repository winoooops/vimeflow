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

  test('renders the consolidated 10 functional chips on the unstaged view', () => {
    // After PR #263 follow-up: indicators / overflow dropdowns + the four
    // boolean toggle chips collapsed into a single View ▾ chip, so the
    // unstaged view ships 10 visible chips (was 15 pre-consolidation).
    renderToolbar({ diffMode: 'unstaged' })

    // Segmented: split / unified.
    expect(screen.getByRole('button', { name: 'split' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'unified' })).toBeInTheDocument()

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

    // We don't pass click handlers to the disabled chips — they don't exist
    // as props in PR1. userEvent.click on a `disabled` button is a no-op, so
    // we assert nothing else fires either: the diff-style segmented control's
    // callback stays at zero calls because we only clicked a disabled chip.
    renderToolbar({ onDiffStyleChange })

    await user.click(screen.getByRole('button', { name: /^stage$/i }))
    await user.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(onDiffStyleChange).not.toHaveBeenCalled()
  })

  test('staging chips render with the disabled-placeholder styling', () => {
    renderToolbar()

    const stage = screen.getByRole('button', { name: /^stage$/i })
    expect(stage).toBeDisabled()
    expect(stage.className).toContain('cursor-not-allowed')
    expect(stage.className).toContain('text-on-surface-variant/40')
  })

  test('PriorityPlus collapses the lower-priority chips into the overflow menu at a narrow width', () => {
    renderToolbar({ diffMode: 'unstaged' })

    // Layout: every chip is 60 px wide with 12 px gaps. With consolidation
    // the unstaged view ships 10 chips (was 15 pre-consolidation), so the
    // overflow threshold shifts. Width 600 px fits the first eight chips
    // plus the 32 + 12 px overflow chip on the visible row; the trailing
    // two (theme + View ▾) fold into the `…` menu.
    const layouts: ItemLayout[] = []
    for (let i = 0; i < 10; i++) {
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

    // Visible row holds the highest-priority chips: segmented, prev/counter
    // /next, stage/discard/discard all, plus one dropdown. Verify the
    // top-priority chips remain on the bar.
    expect(screen.getByRole('button', { name: 'split' })).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /prev hunk/i })
    ).toBeInTheDocument()
  })
})
