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

  test('renders scratch control only when onScratch is defined', () => {
    const onScratch = vi.fn()
    const onParentClick = vi.fn()

    const { rerender } = render(
      <div onClick={onParentClick}>
        <HeaderActions isCollapsed={expanded} onToggleCollapse={vi.fn()} />
      </div>
    )

    expect(
      screen.queryByRole('button', { name: /open scratch terminal/i })
    ).toBeNull()

    rerender(
      <div onClick={onParentClick}>
        <HeaderActions
          isCollapsed={expanded}
          onToggleCollapse={vi.fn()}
          onScratch={onScratch}
        />
      </div>
    )

    fireEvent.click(
      screen.getByRole('button', { name: /open scratch terminal/i })
    )

    expect(onScratch).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  test('a live (but idle) scratch shell shows the amber tint and no dot', () => {
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onScratch={vi.fn()}
        scratchRunning
      />
    )

    // Amber tint + a "(live)" label expose the hidden-but-alive shell to AT;
    // with no foreground command it isn't labelled running and shows no dot.
    const button = screen.getByRole('button', {
      name: 'open scratch terminal (live)',
    })
    expect(button.className).toContain('bg-[#f0c674]/15')
    expect(screen.queryByTestId('scratch-live-dot')).toBeNull()
  })

  test('the mint live-dot shows only when a foreground command is running', () => {
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onScratch={vi.fn()}
        scratchRunning
        scratchActive
      />
    )

    const button = screen.getByRole('button', {
      name: /open scratch terminal \(running\)/i,
    })
    expect(button.className).toContain('bg-[#f0c674]/15') // still amber (has shell)
    expect(screen.getByTestId('scratch-live-dot')).toBeInTheDocument()
  })

  test('no running cue when the pane scratch is not running', () => {
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onScratch={vi.fn()}
      />
    )

    const button = screen.getByRole('button', {
      name: 'open scratch terminal',
    })
    expect(button.className).toContain('bg-transparent')
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
