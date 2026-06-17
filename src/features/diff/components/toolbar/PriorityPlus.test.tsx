import { useState, type ReactElement } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PriorityPlus } from './PriorityPlus'
import { ToolbarSeparator } from './ToolbarSeparator'

// Capture the ResizeObserver callback so the test can flush measurements
// synchronously. The test setup file already stubs a global ResizeObserver
// with vi.fn() (so window does not throw), but it never invokes the
// callback — we replace it for these tests so we can drive the measure
// loop deterministically.
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

interface ItemLayout {
  offsetTop: number
  offsetHeight: number
  offsetLeft: number
  offsetWidth: number
  rectLeft?: number
}

const rect = ({
  left,
  top,
  width,
  height,
}: {
  left: number
  top: number
  width: number
  height: number
}): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  toJSON: () => ({}),
})

// Override the layout properties on each item wrapper + the container.
// The PriorityPlus measurement reads offsetTop/Height/Left/Width on each
// child wrapper and clientWidth on the container; jsdom returns 0 for all
// of those by default. We define each value explicitly via configurable
// own-properties so subsequent re-measurements see the test's layout.
const stubLayout = (
  root: HTMLElement,
  layouts: readonly ItemLayout[],
  containerWidth: number,
  containerLeft = 0
): void => {
  Object.defineProperty(root, 'clientWidth', {
    value: containerWidth,
    configurable: true,
  })

  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () =>
      rect({
        left: containerLeft,
        top: 0,
        width: containerWidth,
        height: 0,
      }),
    configurable: true,
  })

  // The trailing OverflowMenu trigger button has aria-label — exclude it
  // from the wrapper list. Item wrappers are <div> with no aria-label.
  // eslint-disable-next-line testing-library/no-node-access -- iterate PriorityPlus wrappers
  const childNodes = root.children

  const wrappers = Array.from(childNodes).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el.getAttribute('aria-label') === null
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

    Object.defineProperty(node, 'getBoundingClientRect', {
      value: () =>
        rect({
          left: containerLeft + (layout.rectLeft ?? layout.offsetLeft),
          top: layout.offsetTop,
          width: layout.offsetWidth,
          height: layout.offsetHeight,
        }),
      configurable: true,
    })
  })
}

const fireResize = (): void => {
  act(() => {
    resizeCallback?.([], {} as ResizeObserver)
  })
}

const renderItems = (count: number): ReactElement[] =>
  Array.from({ length: count }, (_, index) => (
    <button key={index} type="button" data-testid={`item-${index}`}>
      item {index}
    </button>
  ))

const StatefulChip = ({ label }: { label: string }): ReactElement => {
  const [open, setOpen] = useState(false)

  return (
    <button
      type="button"
      data-testid={`stateful-${label}`}
      onClick={(): void => setOpen((current) => !current)}
    >
      {label} {open ? 'open' : 'closed'}
    </button>
  )
}

const renderStatefulItems = (labels: readonly string[]): ReactElement[] =>
  labels.map((label) => <StatefulChip key={label} label={label} />)

// Returns the wrapper <div> that PriorityPlus mounts around the i-th
// child. Using parentElement is unavoidable here: only the test's own
// children have a queryable role; the wrappers are an implementation
// detail and don't get one.
const wrapperFor = (testId: string): HTMLElement => {
  const child = screen.getByTestId(testId)
  // eslint-disable-next-line testing-library/no-node-access -- read PriorityPlus wrapper
  const parent = child.parentElement
  if (!parent) {
    throw new Error(`no parent for ${testId}`)
  }

  return parent
}

const rootContainer = (testId: string): HTMLElement => {
  const wrapper = wrapperFor(testId)
  // eslint-disable-next-line testing-library/no-node-access -- climb to PriorityPlus root
  const root = wrapper.parentElement
  if (!root) {
    throw new Error(`no PriorityPlus root for ${testId}`)
  }

  return root
}

describe('PriorityPlus', () => {
  beforeEach(() => {
    resizeCallback = null
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resizeCallback = null
  })

  test('renders no overflow chip when every item fits on a single row', () => {
    render(<PriorityPlus maxRows={1}>{renderItems(3)}</PriorityPlus>)

    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 144, offsetWidth: 60 },
      ],
      600
    )
    fireResize()

    expect(
      screen.queryByRole('button', { name: /more controls/i })
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('item-0')).toBeVisible()
    expect(screen.getByTestId('item-2')).toBeVisible()
  })

  test('re-measures on remeasureKey change (width-only content swap) without a resize', () => {
    const { rerender } = render(
      <PriorityPlus maxRows={1} remeasureKey="short">
        {renderItems(3)}
      </PriorityPlus>
    )

    // All three fit on row 1 — no overflow chip.
    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 144, offsetWidth: 60 },
      ],
      600
    )
    fireResize()
    expect(
      screen.queryByRole('button', { name: /more controls/i })
    ).not.toBeInTheDocument()

    // A child's content grew (e.g. the file pill swapped in a longer filename),
    // pushing item 2 onto row 2 — re-stub the new layout, then bump
    // remeasureKey. No ResizeObserver fire: the remeasure must come from the key
    // change alone (the bug codex flagged left this stale until a resize).
    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
      ],
      600
    )

    rerender(
      <PriorityPlus maxRows={1} remeasureKey="a-much-longer-filename">
        {renderItems(3)}
      </PriorityPlus>
    )

    expect(
      screen.getByRole('button', { name: /more controls/i })
    ).toBeInTheDocument()
  })

  test('defaults to a single visible row', () => {
    render(<PriorityPlus>{renderItems(3)}</PriorityPlus>)

    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
      ],
      400
    )
    fireResize()

    expect(
      screen.getByRole('button', { name: /more controls/i })
    ).toHaveAttribute('aria-label', 'Show 2 more controls')
  })

  test('shows the overflow chip and hides items past the cutoff when half land on row 2', () => {
    render(<PriorityPlus maxRows={1}>{renderItems(4)}</PriorityPlus>)

    // Items 0 + 1 on row 1 (offsetTop 0). Items 2 + 3 on row 2 (offsetTop 30).
    // Container is wide enough for items 0+1 + the 32px chip + 12px gap, so
    // the chip-reservation pull-back doesn't trigger.
    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
      ],
      400
    )
    fireResize()

    const chip = screen.getByRole('button', { name: /more controls/i })
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveAttribute('aria-label', 'Show 2 more controls')

    // Hidden items inherit the `hidden` Tailwind class on their wrapper.
    expect(wrapperFor('item-2').className).toContain('hidden')
    expect(wrapperFor('item-3').className).toContain('hidden')
    // Visible items' wrappers stay un-hidden.
    expect(wrapperFor('item-0').className).not.toContain('hidden')
  })

  test('restores overflowed items when the toolbar expands', () => {
    // SCOPE: this validates the measurement LOGIC only — given a re-measure
    // against a wider container, overflowed items come back. It deliberately
    // fires the observer by hand because jsdom has no layout engine. It does
    // NOT prove a real-world widen triggers that re-measure: that depends on
    // the container actually growing with the pane, which is the separate
    // layout-contract guard ('the measurement container fills its row …').
    // Both are required — the manual fire alone once masked a real expand bug.
    render(<PriorityPlus maxRows={1}>{renderItems(4)}</PriorityPlus>)

    const root = rootContainer('item-0')

    stubLayout(
      root,
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
      ],
      180
    )
    fireResize()

    expect(
      screen.getByRole('button', { name: /more controls/i })
    ).toHaveAttribute('aria-label', 'Show 2 more controls')
    expect(wrapperFor('item-2').className).toContain('hidden')

    stubLayout(
      root,
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 144, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 216, offsetWidth: 60 },
      ],
      420
    )
    fireResize()

    expect(
      screen.queryByRole('button', { name: /more controls/i })
    ).not.toBeInTheDocument()
    expect(wrapperFor('item-2').className).not.toContain('hidden')
    expect(wrapperFor('item-3').className).not.toContain('hidden')
  })

  test('reserves chip space — pulls cutoff back when the chip will not fit on the last allowed row', () => {
    render(<PriorityPlus maxRows={1}>{renderItems(4)}</PriorityPlus>)

    // We trigger the pull-back by laying out 3 items on row 1 with item 3 on
    // row 2 — without pull-back, cutoff = 3 (last visible = item 2). The
    // container is exactly as wide as items 0/1/2 with zero room for the
    // 32 + 12 = 44 px chip, so the pull-back drops cutoff to 2 (item 2 also
    // hides). Two items end up in the overflow menu.
    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 144, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
      ],
      // Container width = 204 — exactly enough for items 0/1/2 (right edge =
      // 144 + 60 = 204) but with zero room left for the chip. Cutoff before
      // pull-back is 3 (item 3 overflows). After pull-back: 2 (so item 2 is
      // also hidden and the chip fits beside item 1).
      204
    )
    fireResize()

    expect(
      screen.getByRole('button', { name: /more controls/i })
    ).toHaveAttribute('aria-label', 'Show 2 more controls')

    // Item 1 should still be visible (the pull-back stopped at index 2).
    expect(wrapperFor('item-1').className).not.toContain('hidden')
    // Item 2 should be hidden because of the chip-space reservation.
    expect(wrapperFor('item-2').className).toContain('hidden')
  })

  test('reserves chip space using same-origin rectangles', () => {
    render(<PriorityPlus maxRows={1}>{renderItems(4)}</PriorityPlus>)

    // Simulate a toolbar inside a positioned DockPanel section after a 240px
    // file list. offsetLeft is section-relative, but getBoundingClientRect()
    // keeps both container and item in viewport coordinates. Item 2 leaves
    // enough real room for the overflow chip, so it must stay visible.
    stubLayout(
      rootContainer('item-0'),
      [
        {
          offsetTop: 0,
          offsetHeight: 24,
          offsetLeft: 240,
          offsetWidth: 60,
          rectLeft: 0,
        },
        {
          offsetTop: 0,
          offsetHeight: 24,
          offsetLeft: 312,
          offsetWidth: 60,
          rectLeft: 72,
        },
        {
          offsetTop: 0,
          offsetHeight: 24,
          offsetLeft: 384,
          offsetWidth: 60,
          rectLeft: 144,
        },
        {
          offsetTop: 30,
          offsetHeight: 24,
          offsetLeft: 240,
          offsetWidth: 60,
          rectLeft: 0,
        },
      ],
      400,
      240
    )
    fireResize()

    expect(
      screen.getByRole('button', { name: /more controls/i })
    ).toHaveAttribute('aria-label', 'Show 1 more controls')
    expect(wrapperFor('item-2').className).not.toContain('hidden')
    expect(wrapperFor('item-3').className).toContain('hidden')
  })

  test('children list changes trigger re-measurement', () => {
    const { rerender } = render(
      <PriorityPlus maxRows={1}>{renderItems(2)}</PriorityPlus>
    )

    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
      ],
      400
    )
    fireResize()

    expect(
      screen.queryByRole('button', { name: /more controls/i })
    ).not.toBeInTheDocument()

    // Re-render with more items, simulating overflow on row 2. The
    // A children.length change resets the measurement pass after the new
    // wrappers mount.
    rerender(<PriorityPlus maxRows={1}>{renderItems(4)}</PriorityPlus>)

    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
      ],
      400
    )
    // The freshly mounted wrappers need their layout stubbed before the
    // next measurement pass — fire a resize so the effect runs again with
    // the stubs in place.
    fireResize()

    expect(
      screen.getByRole('button', { name: /more controls/i })
    ).toBeInTheDocument()
  })

  test('uses child keys for wrappers so state follows inserted items', () => {
    const { rerender } = render(
      <PriorityPlus>{renderStatefulItems(['a', 'b', 'c'])}</PriorityPlus>
    )

    fireEvent.click(screen.getByTestId('stateful-b'))

    expect(screen.getByTestId('stateful-b')).toHaveTextContent('b open')

    rerender(
      <PriorityPlus>{renderStatefulItems(['a', 'x', 'b', 'c'])}</PriorityPlus>
    )

    expect(screen.getByTestId('stateful-b')).toHaveTextContent('b open')
  })

  test('hidden items remain in the DOM so the OverflowMenu can render them', () => {
    render(<PriorityPlus maxRows={1}>{renderItems(3)}</PriorityPlus>)

    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
      ],
      400
    )
    fireResize()

    expect(
      screen.getByRole('button', { name: /more controls/i })
    ).toHaveAttribute('aria-label', 'Show 1 more controls')
    // The hidden item's wrapper still carries the hidden class; the
    // OverflowMenu re-mounts the same node when opened.
    expect(wrapperFor('item-2').className).toContain('hidden')
  })

  test('clicking the chip opens the overflow tray as a labelled dialog', () => {
    render(
      <PriorityPlus maxRows={1}>
        {renderStatefulItems(['a', 'b', 'c'])}
      </PriorityPlus>
    )

    stubLayout(
      rootContainer('stateful-a'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
      ],
      400
    )
    fireResize()

    // Closed: no dialog rendered yet.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /more controls/i }))

    const tray = screen.getByRole('dialog', { name: 'More controls' })
    expect(tray).toBeInTheDocument()
  })

  test('a stateful child toggles inside the tray without closing it', () => {
    render(
      <PriorityPlus maxRows={1}>
        {renderStatefulItems(['a', 'b', 'c'])}
      </PriorityPlus>
    )

    // Item 'c' overflows into the tray (row 2).
    stubLayout(
      rootContainer('stateful-a'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
      ],
      400
    )
    fireResize()

    fireEvent.click(screen.getByRole('button', { name: /more controls/i }))

    // The overflowed item also stays in the hidden inline flow, so scope the
    // assertions to the open tray's copy.
    const tray = within(screen.getByRole('dialog', { name: 'More controls' }))

    // The overflowed chip is now reachable inside the open tray.
    expect(tray.getByTestId('stateful-c')).toHaveTextContent('c closed')

    // Operating the chip flips its own state and the tray stays open — the
    // whole reason this is a Popover and not a menu of selectable rows.
    fireEvent.click(tray.getByTestId('stateful-c'))

    expect(tray.getByTestId('stateful-c')).toHaveTextContent('c open')
    expect(
      screen.getByRole('dialog', { name: 'More controls' })
    ).toBeInTheDocument()
  })

  test('trims a trailing separator and excludes separators from the tray', () => {
    render(
      <PriorityPlus maxRows={1}>
        {[
          <button key="i0" type="button" data-testid="item-0">
            item 0
          </button>,
          <ToolbarSeparator key="sep" />,
          <button key="i1" type="button" data-testid="item-1">
            item 1
          </button>,
          <button key="i2" type="button" data-testid="item-2">
            item 2
          </button>,
        ]}
      </PriorityPlus>
    )

    // item-0 + separator sit on row 1; item-1 + item-2 wrap to row 2. The raw
    // cutoff (item-1's index) would leave the separator as the last VISIBLE
    // item — the trim pulls the cutoff back so only item-0 stays and the
    // hairline never dangles before the `…` chip.
    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 66, offsetWidth: 1 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
      ],
      400
    )
    fireResize()

    // The count excludes the separator: 2 controls (item-1, item-2), not 3.
    expect(
      screen.getByRole('button', { name: /more controls/i })
    ).toHaveAttribute('aria-label', 'Show 2 more controls')

    // The trailing separator wrapper is hidden — it folds away with its group.
    const root = rootContainer('item-0')
    // eslint-disable-next-line testing-library/no-node-access -- locate the separator wrapper
    const separatorWrapper = root.querySelector('[data-pp-separator]')
    expect(separatorWrapper?.className).toContain('hidden')

    // item-0 stays visible.
    expect(wrapperFor('item-0').className).not.toContain('hidden')
  })

  test('keeps an interior separator visible between two visible groups', () => {
    render(
      <PriorityPlus maxRows={1}>
        {[
          <button key="i0" type="button" data-testid="item-0">
            item 0
          </button>,
          <ToolbarSeparator key="sep" />,
          <button key="i1" type="button" data-testid="item-1">
            item 1
          </button>,
          <button key="i2" type="button" data-testid="item-2">
            item 2
          </button>,
        ]}
      </PriorityPlus>
    )

    // item-0, separator and item-1 all fit on row 1; only item-2 wraps. The
    // last visible item is item-1 (not the separator), so no trim happens and
    // the divider stays between the two visible groups.
    stubLayout(
      rootContainer('item-0'),
      [
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 66, offsetWidth: 1 },
        { offsetTop: 0, offsetHeight: 24, offsetLeft: 72, offsetWidth: 60 },
        { offsetTop: 30, offsetHeight: 24, offsetLeft: 0, offsetWidth: 60 },
      ],
      400
    )
    fireResize()

    expect(
      screen.getByRole('button', { name: /more controls/i })
    ).toHaveAttribute('aria-label', 'Show 1 more controls')

    const root = rootContainer('item-0')
    // eslint-disable-next-line testing-library/no-node-access -- locate the separator wrapper
    const separatorWrapper = root.querySelector('[data-pp-separator]')
    expect(separatorWrapper?.className).not.toContain('hidden')
  })

  test('the measurement container fills its row so a widen triggers re-measure', () => {
    // Regression guard for the real-app expand bug: a shrink-to-fit container
    // only narrows when the pane shrinks and never widens back, so overflowed
    // items stay stuck in the `…` tray on expand. The observed container must
    // FILL the row (flex-1) so its own width tracks the pane and the
    // ResizeObserver fires on widen. jsdom has no layout/observer, so this
    // asserts the load-bearing fill class rather than re-measurement directly.
    render(<PriorityPlus maxRows={1}>{renderItems(2)}</PriorityPlus>)

    expect(rootContainer('item-0').className).toMatch(/\bflex-1\b/)
  })
})
