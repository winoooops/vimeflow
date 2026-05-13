import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { LayoutSwitcher } from './LayoutSwitcher'

describe('LayoutSwitcher', () => {
  test('renders 5 buttons (one per LayoutId)', () => {
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(5)
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

  test('exposes role="group" with an aria-label', () => {
    // `role="group"` was chosen (over "toolbar") because the picker
    // doesn't implement roving-tabindex / arrow-key navigation. The
    // group + aria-label combination names the region for screen
    // readers without advertising an unimplemented keyboard pattern.
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)

    expect(screen.getByRole('group')).toHaveAccessibleName('Pane layout')
  })
})
