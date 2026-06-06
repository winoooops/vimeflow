import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { HeaderActions } from './HeaderActions'

const expanded = false as const

describe('HeaderActions', () => {
  test('renders collapse control and calls onToggleCollapse', () => {
    const onToggleCollapse = vi.fn()
    const onParentClick = vi.fn()

    render(
      <div onClick={onParentClick}>
        <HeaderActions
          isCollapsed={expanded}
          onToggleCollapse={onToggleCollapse}
        />
      </div>
    )

    const button = screen.getByRole('button', { name: /collapse status/i })
    expect(button).toHaveTextContent('unfold_less')

    fireEvent.click(button)

    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  test('renders expand control in collapsed state', () => {
    render(<HeaderActions isCollapsed onToggleCollapse={vi.fn()} />)

    const button = screen.getByRole('button', { name: /expand status/i })
    expect(button).toHaveTextContent('unfold_more')
  })

  test('renders close control only when onClose is defined', () => {
    const onClose = vi.fn()
    const onParentClick = vi.fn()

    const { rerender } = render(
      <div onClick={onParentClick}>
        <HeaderActions isCollapsed={expanded} onToggleCollapse={vi.fn()} />
      </div>
    )

    expect(screen.queryByRole('button', { name: /close pane/i })).toBeNull()

    rerender(
      <div onClick={onParentClick}>
        <HeaderActions
          isCollapsed={expanded}
          onToggleCollapse={vi.fn()}
          onClose={onClose}
        />
      </div>
    )

    fireEvent.click(screen.getByRole('button', { name: /close pane/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  test('renders burner control only when onBurner is defined', () => {
    const onBurner = vi.fn()
    const onParentClick = vi.fn()

    const { rerender } = render(
      <div onClick={onParentClick}>
        <HeaderActions isCollapsed={expanded} onToggleCollapse={vi.fn()} />
      </div>
    )

    expect(
      screen.queryByRole('button', { name: /open burner terminal/i })
    ).toBeNull()

    rerender(
      <div onClick={onParentClick}>
        <HeaderActions
          isCollapsed={expanded}
          onToggleCollapse={vi.fn()}
          onBurner={onBurner}
        />
      </div>
    )

    fireEvent.click(
      screen.getByRole('button', { name: /open burner terminal/i })
    )

    expect(onBurner).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  test('an active burner shows the amber button tint (the cue, no dot)', () => {
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        burnerActive
      />
    )

    const button = screen.getByRole('button', {
      name: /open burner terminal \(running\)/i,
    })
    expect(button.className).toContain('bg-[#f0c674]/15')
    expect(button.className).toContain('text-[#f0c674]') // amber icon when active
    // The amber background IS the running cue — no separate live-dot.
    expect(screen.queryByTestId('burner-live-dot')).toBeNull()
  })

  test('no running cue when the pane burner is not running', () => {
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
      />
    )

    const button = screen.getByRole('button', {
      name: 'open burner terminal',
    })
    expect(button.className).toContain('bg-transparent')
    expect(button.className).toContain('text-on-surface-muted') // gray icon, not amber
  })

  test('hovering the collapse-status button shows a plain tooltip', async () => {
    const user = userEvent.setup()
    render(<HeaderActions isCollapsed={expanded} onToggleCollapse={vi.fn()} />)

    await user.hover(screen.getByRole('button', { name: /collapse status/i }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Collapse status')
    expect(within(tip).queryByTestId('tooltip-shortcut')).toBeNull()
  })

  test('hovering the close-pane button shows a plain tooltip', async () => {
    const user = userEvent.setup()
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.hover(screen.getByRole('button', { name: /close pane/i }))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Close pane')
    expect(within(tip).queryByTestId('tooltip-shortcut')).toBeNull()
  })
})
