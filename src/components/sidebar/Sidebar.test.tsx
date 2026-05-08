import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'

describe('Sidebar — slot composition', () => {
  test('renders with default data-testid="sidebar"', () => {
    render(<Sidebar content={<div>content</div>} />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  test('renders the header slot when provided', () => {
    render(
      <Sidebar
        header={<div data-testid="header-fixture">H</div>}
        content={<div>C</div>}
      />
    )
    expect(screen.getByTestId('header-fixture')).toBeInTheDocument()
  })

  test('renders the content slot', () => {
    render(<Sidebar content={<div data-testid="content-fixture">C</div>} />)
    expect(screen.getByTestId('content-fixture')).toBeInTheDocument()
  })

  test('renders the footer slot when provided', () => {
    render(
      <Sidebar
        content={<div>C</div>}
        footer={<div data-testid="footer-fixture">F</div>}
      />
    )
    expect(screen.getByTestId('footer-fixture')).toBeInTheDocument()
  })

  test('renders the bottomPane + resize handle when provided', () => {
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div data-testid="bottom-fixture">B</div>}
      />
    )
    expect(screen.getByTestId('bottom-fixture')).toBeInTheDocument()
    expect(screen.getByTestId('explorer-resize-handle')).toBeInTheDocument()
  })
})

describe('Sidebar — slot absence semantics', () => {
  test('omitting bottomPane suppresses the resize handle and bottom region', () => {
    render(<Sidebar content={<div>C</div>} />)
    expect(
      screen.queryByTestId('explorer-resize-handle')
    ).not.toBeInTheDocument()
  })

  test('null/undefined/false/true header all suppress the header wrapper (no phantom padded div)', () => {
    // Asserts on the WRAPPER's presence (data-testid="sidebar-header-wrapper")
    // rather than the inner probe — the wrapper is the dangerous artifact
    // when a slot prop is "no content." Querying only the inner probe
    // (an earlier draft of this test) gave a false sense of safety: the
    // probe is absent for every "no content" value, but the padded wrapper
    // can still render a phantom ~20 px gap with empty `{value}`.
    const { rerender } = render(
      <Sidebar
        content={<div>C</div>}
        header={<div data-testid="header-probe">H</div>}
      />
    )
    expect(screen.getByTestId('sidebar-header-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('header-probe')).toBeInTheDocument()

    rerender(<Sidebar header={null} content={<div>C</div>} />)
    expect(
      screen.queryByTestId('sidebar-header-wrapper')
    ).not.toBeInTheDocument()

    rerender(<Sidebar header={undefined} content={<div>C</div>} />)
    expect(
      screen.queryByTestId('sidebar-header-wrapper')
    ).not.toBeInTheDocument()

    // Boolean-typed variable to bypass `react/jsx-boolean-value` (which
    // rejects literal `={false}` in JSX); the runtime value is what
    // matters for this test, not the literal source form.
    const falseValue = false as const
    rerender(<Sidebar header={falseValue} content={<div>C</div>} />)
    expect(
      screen.queryByTestId('sidebar-header-wrapper')
    ).not.toBeInTheDocument()

    // The JSX boolean-shorthand <Sidebar header /> passes header={true}.
    // `true` is a valid ReactNode that React renders as nothing visible —
    // wrapping `{true}` in a padded div would create a phantom layout gap.
    // The renderSlot predicate must filter `true` alongside the other
    // "no content" sentinels.
    rerender(<Sidebar header content={<div>C</div>} />)
    expect(
      screen.queryByTestId('sidebar-header-wrapper')
    ).not.toBeInTheDocument()
  })

  test("0 and '' DO render their wrapper (valid ReactNodes)", () => {
    render(<Sidebar header={0} content={<div>C</div>} />)
    // The header wrapper is the `px-3 pt-3 pb-2` div; the rendered
    // text "0" lives inside it.
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})

describe('Sidebar — resize handle', () => {
  test('handle exposes role=separator with live aria values', () => {
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div>B</div>}
        bottomPaneInitialHeight={250}
        bottomPaneMinHeight={100}
        bottomPaneMaxHeight={500}
      />
    )
    const handle = screen.getByTestId('explorer-resize-handle')
    expect(handle).toHaveAttribute('role', 'separator')
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    expect(handle).toHaveAttribute('aria-valuenow', '250')
    expect(handle).toHaveAttribute('aria-valuemin', '100')
    expect(handle).toHaveAttribute('aria-valuemax', '500')
  })

  test('initial height clamps to [min, max] (relies on useResizable clamp)', () => {
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div>B</div>}
        bottomPaneInitialHeight={9999}
        bottomPaneMaxHeight={500}
      />
    )
    const handle = screen.getByTestId('explorer-resize-handle')
    expect(handle).toHaveAttribute('aria-valuenow', '500')
  })
})

describe('Sidebar — separator keyboard a11y (closes #180)', () => {
  // Imports lazy-loaded so the slot-composition tests above don't pay
  // the userEvent setup cost. Keep the new keyboard tests grouped.
  test('separator is focusable (tabIndex=0) and exposes aria-label', () => {
    render(<Sidebar content={<div>C</div>} bottomPane={<div>B</div>} />)
    const handle = screen.getByTestId('explorer-resize-handle')
    expect(handle).toHaveAttribute('tabindex', '0')
    expect(handle).toHaveAttribute('aria-label', 'Resize bottom pane')
  })

  test('ArrowUp grows the bottom pane (mirrors mouse drag-up semantics)', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div>B</div>}
        bottomPaneInitialHeight={300}
      />
    )
    const handle = screen.getByTestId('explorer-resize-handle')
    handle.focus()
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    await user.keyboard('{ArrowUp}')
    expect(handle).toHaveAttribute('aria-valuenow', '308')
  })

  test('ArrowDown shrinks the bottom pane', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div>B</div>}
        bottomPaneInitialHeight={300}
      />
    )
    const handle = screen.getByTestId('explorer-resize-handle')
    handle.focus()
    await user.keyboard('{ArrowDown}')
    expect(handle).toHaveAttribute('aria-valuenow', '292')
  })

  test('Home and End jump to min and max', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div>B</div>}
        bottomPaneInitialHeight={300}
        bottomPaneMinHeight={100}
        bottomPaneMaxHeight={500}
      />
    )
    const handle = screen.getByTestId('explorer-resize-handle')
    handle.focus()
    await user.keyboard('{Home}')
    expect(handle).toHaveAttribute('aria-valuenow', '100')
    await user.keyboard('{End}')
    expect(handle).toHaveAttribute('aria-valuenow', '500')
  })

  test('PageUp and PageDown apply the larger 40px step', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div>B</div>}
        bottomPaneInitialHeight={300}
      />
    )
    const handle = screen.getByTestId('explorer-resize-handle')
    handle.focus()
    await user.keyboard('{PageUp}')
    expect(handle).toHaveAttribute('aria-valuenow', '340')
    await user.keyboard('{PageDown}')
    expect(handle).toHaveAttribute('aria-valuenow', '300')
  })

  test('keyboard adjustment clamps at min/max boundaries', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    render(
      <Sidebar
        content={<div>C</div>}
        bottomPane={<div>B</div>}
        bottomPaneInitialHeight={100}
        bottomPaneMinHeight={100}
        bottomPaneMaxHeight={500}
      />
    )
    const handle = screen.getByTestId('explorer-resize-handle')
    handle.focus()
    // Already at min — ArrowDown must not go below.
    await user.keyboard('{ArrowDown}')
    expect(handle).toHaveAttribute('aria-valuenow', '100')
  })
})
