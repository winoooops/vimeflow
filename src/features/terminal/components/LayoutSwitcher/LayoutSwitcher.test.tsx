import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { SINGLE_PANE_FOCUS_LABEL } from '../../layout-registry'
import { LayoutSwitcher } from './LayoutSwitcher'

describe('LayoutSwitcher', () => {
  test('renders 6 buttons (one per LayoutId)', () => {
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(6)
  })

  test('stacks vertically only when vertical is set', () => {
    const { rerender } = render(
      <LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />
    )
    expect(screen.getByTestId('layout-switcher')).not.toHaveClass('flex-col')

    rerender(
      <LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} vertical />
    )
    expect(screen.getByTestId('layout-switcher')).toHaveClass('flex-col')
  })

  test('marks the active button with data-active', () => {
    render(<LayoutSwitcher activeLayoutId="vsplit" onPick={vi.fn()} />)

    const active = screen.getByRole('button', { name: 'Vertical split' })
    expect(active).toHaveAttribute('data-active', 'true')

    const inactive = screen.getByRole('button', { name: 'Single' })
    expect(inactive).not.toHaveAttribute('data-active')
  })

  test('clicking a non-active button fires onPick with its id', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<LayoutSwitcher activeLayoutId="single" onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: 'Quad' }))

    expect(onPick).toHaveBeenCalledOnce()
    expect(onPick).toHaveBeenCalledWith('quad')
  })

  test('renders the new 3x2 grid pill', () => {
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)

    expect(screen.getByRole('button', { name: '3x2 grid' })).toBeInTheDocument()
  })

  test('renders only the configured visible layouts in registry order', () => {
    render(
      <LayoutSwitcher
        activeLayoutId="single"
        visibleLayoutIds={['single', 'threeRight', 'grid3x2']}
        onPick={vi.fn()}
      />
    )

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Single' })).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Main + 2 stack' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3x2 grid' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Vertical split' })).toBeNull()
  })

  test('keeps the active layout visible even when it is not in the configured list', () => {
    render(
      <LayoutSwitcher
        activeLayoutId="vsplit"
        visibleLayoutIds={['single', 'grid3x2']}
        onPick={vi.fn()}
      />
    )

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(
      screen.getByRole('button', { name: 'Vertical split' })
    ).toBeInTheDocument()
  })

  test('clicking the already-active button does NOT fire onPick', async () => {
    // The component's contract is that onPick fires only when the
    // active layout actually changes. setSessionLayout already no-ops
    // on same-layout picks, but expressing the guard here keeps the
    // callback honest for any future caller that wires a different
    // mutation (e.g. analytics, telemetry) downstream of onPick.
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<LayoutSwitcher activeLayoutId="vsplit" onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: 'Vertical split' }))

    expect(onPick).not.toHaveBeenCalled()
  })

  test('renders a blocked layout as a present-but-disabled pill that does not pick', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(
      <LayoutSwitcher
        activeLayoutId="single"
        blockedLayoutIds={['quad']}
        onPick={onPick}
      />
    )

    // The blocked layout still renders as a pill (visibility is not affected).
    const quad = screen.getByRole('button', { name: /quad/i })
    expect(quad).toBeInTheDocument()
    expect(quad).toHaveAttribute('aria-disabled', 'true')

    await user.click(quad)
    expect(onPick).not.toHaveBeenCalled()
  })

  test('a blocked pill exposes the reduce-panes explanation as its accessible name and tooltip', async () => {
    const user = userEvent.setup()
    render(
      <LayoutSwitcher
        activeLayoutId="single"
        blockedLayoutIds={['quad']}
        onPick={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Reduce panes to switch to Quad' })
    ).toBeInTheDocument()

    await user.hover(
      screen.getByRole('button', { name: 'Reduce panes to switch to Quad' })
    )

    expect(
      await screen.findByRole('tooltip', {
        name: 'Reduce panes to switch to Quad',
      })
    ).toBeInTheDocument()
  })

  test('the active layout is never disabled even if listed as blocked', () => {
    render(
      <LayoutSwitcher
        activeLayoutId="quad"
        blockedLayoutIds={['quad']}
        onPick={vi.fn()}
      />
    )

    const quad = screen.getByRole('button', { name: 'Quad' })
    expect(quad).not.toHaveAttribute('aria-disabled', 'true')
    expect(quad).toHaveAttribute('data-active', 'true')
  })

  test('docks a trailing control inside the pillar after a hairline divider', () => {
    render(
      <LayoutSwitcher
        activeLayoutId="single"
        onPick={vi.fn()}
        trailing={
          <button type="button" aria-label="Configure displayed layouts" />
        }
      />
    )

    const group = screen.getByRole('group')

    const config = within(group).getByRole('button', {
      name: 'Configure displayed layouts',
    })
    const divider = within(group).getByTestId('layout-switcher-divider')

    // The divider is the element immediately before the trailing control,
    // so it visually separates the pills from the docked button.
    // eslint-disable-next-line testing-library/no-node-access
    expect(config.previousElementSibling).toBe(divider)
  })

  test('renders no divider when no trailing control is provided', () => {
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)

    expect(screen.queryByTestId('layout-switcher-divider')).toBeNull()
    // Still just the 6 layout pills — no stray trailing button.
    expect(screen.getAllByRole('button')).toHaveLength(6)
  })

  test('exposes role="group" with an aria-label', () => {
    // `role="group"` was chosen (over "toolbar") because the picker
    // doesn't implement roving-tabindex / arrow-key navigation. The
    // group + aria-label combination names the region for screen
    // readers without advertising an unimplemented keyboard pattern.
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)

    expect(screen.getByRole('group')).toHaveAccessibleName('Pane layout')
  })

  test('cuts the layout pillar out of parent drag regions', () => {
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)

    expect(screen.getByTestId('layout-switcher')).toHaveClass('vf-app-no-drag')
  })

  test('generic layout pickers keep the single layout name without a shortcut chip', async () => {
    const user = userEvent.setup()
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)

    const singleButton = screen.getByRole('button', { name: 'Single' })
    await user.hover(singleButton)
    const singleTip = await screen.findByRole('tooltip')
    expect(singleTip).toHaveTextContent('Single')
    expect(within(singleTip).queryByTestId('tooltip-shortcut')).toBeNull()
    await user.unhover(singleButton)

    await user.hover(screen.getByRole('button', { name: 'Quad' }))
    const quadTip = await screen.findByRole('tooltip')
    expect(quadTip).toHaveTextContent('Quad')
    expect(within(quadTip).queryByTestId('tooltip-shortcut')).toBeNull()
  })

  test('workspace focus mode labels single layout as an active-pane action', async () => {
    const user = userEvent.setup()
    render(
      <LayoutSwitcher
        activeLayoutId="single"
        onPick={vi.fn()}
        labelSingleAsFocusAction
      />
    )

    const focusButton = screen.getByRole('button', {
      name: SINGLE_PANE_FOCUS_LABEL,
    })
    await user.hover(focusButton)
    const focusTip = await screen.findByRole('tooltip')
    expect(focusTip).toHaveTextContent(SINGLE_PANE_FOCUS_LABEL)
    expect(within(focusTip).getByTestId('tooltip-shortcut')).toHaveTextContent(
      'Z'
    )
  })
})
