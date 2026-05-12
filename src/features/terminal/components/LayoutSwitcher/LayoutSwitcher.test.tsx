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

  test('exposes role="toolbar" with an aria-label', () => {
    render(<LayoutSwitcher activeLayoutId="single" onPick={vi.fn()} />)

    expect(screen.getByRole('toolbar')).toHaveAccessibleName('Pane layout')
  })
})
