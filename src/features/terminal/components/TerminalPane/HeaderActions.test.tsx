import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

  test('hides the collapse toggle when requested', () => {
    render(
      <HeaderActions
        isCollapsed
        hideCollapseToggle
        onToggleCollapse={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: /collapse status|expand status/i })
    ).toBeNull()
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
    expect(button.className).toContain('bg-agent-shell-accent/15')
    expect(button.className).toContain('text-agent-shell-accent') // amber icon when active
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

  test('idle-but-live shell exposes live state to assistive tech', () => {
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        burnerShellExists
      />
    )

    const button = screen.getByRole('button', {
      name: 'open burner terminal (live)',
    })
    expect(button.className).toContain('bg-transparent')
    expect(button.className).toContain('text-on-surface-muted') // still gray, not amber
  })

  test('opened burner uses pressed state on its pane button', () => {
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        burnerOpen
        burnerShellExists
      />
    )

    const button = screen.getByRole('button', {
      name: 'hide burner terminal',
    })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button.className).toContain('aria-pressed:bg-primary/10')
  })

  test('renders burner sync only when the open burner cwd has drifted', () => {
    const onSyncBurner = vi.fn()

    const { rerender } = render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        onSyncBurner={onSyncBurner}
        burnerOutOfSync
      />
    )

    expect(
      screen.queryByRole('button', { name: /sync burner terminal/i })
    ).toBeNull()

    rerender(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        onSyncBurner={onSyncBurner}
        burnerOpen
      />
    )

    expect(
      screen.queryByRole('button', { name: /sync burner terminal/i })
    ).toBeNull()

    rerender(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        onSyncBurner={onSyncBurner}
        burnerOpen
        burnerOutOfSync
      />
    )

    expect(
      screen.getByRole('button', { name: /sync burner terminal/i })
    ).toBeInTheDocument()

    expect(screen.getByTestId('burner-control-pill').className).toContain(
      'h-[22px]'
    )
  })

  test('burner sync sits before the burner toggle and stops click propagation', () => {
    const onSyncBurner = vi.fn()
    const onParentClick = vi.fn()

    render(
      <div onClick={onParentClick}>
        <HeaderActions
          isCollapsed={expanded}
          onToggleCollapse={vi.fn()}
          onBurner={vi.fn()}
          onSyncBurner={onSyncBurner}
          burnerOpen
          burnerOutOfSync
        />
      </div>
    )

    const sync = screen.getByRole('button', { name: /sync burner terminal/i })
    const burner = screen.getByRole('button', { name: /hide burner terminal/i })

    expect(
      sync.compareDocumentPosition(burner) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    fireEvent.click(sync)

    expect(onSyncBurner).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
    expect(sync.className).toContain('animate-spin')
  })

  test('burner sync shows failure if the cwd remains out of sync', () => {
    vi.useFakeTimers()
    const onSyncBurner = vi.fn()

    try {
      render(
        <HeaderActions
          isCollapsed={expanded}
          onToggleCollapse={vi.fn()}
          onBurner={vi.fn()}
          onSyncBurner={onSyncBurner}
          burnerOpen
          burnerOutOfSync
        />
      )

      fireEvent.click(
        screen.getByRole('button', { name: /sync burner terminal/i })
      )

      act(() => {
        vi.advanceTimersByTime(1200)
      })

      expect(onSyncBurner).toHaveBeenCalledTimes(1)
      expect(
        screen.getByRole('button', {
          name: /sync failed; check burner terminal/i,
        })
      ).toHaveTextContent('sync_problem')
    } finally {
      vi.useRealTimers()
    }
  })

  test('burner sync shows a blocked failure while the burner shell has a foreground command', () => {
    const onSyncBurner = vi.fn()

    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        onSyncBurner={onSyncBurner}
        burnerOpen
        burnerOutOfSync
        burnerActive
      />
    )

    const sync = screen.getByRole('button', { name: /sync burner terminal/i })

    expect(sync).not.toBeDisabled()
    expect(sync).toHaveTextContent('sync')

    fireEvent.click(sync)

    expect(onSyncBurner).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', {
        name: /stop the running command, then sync pwd/i,
      })
    ).toHaveTextContent('sync_problem')
  })

  test('burner sync clears blocked status when the foreground command exits', () => {
    const onSyncBurner = vi.fn()

    const { rerender } = render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        onSyncBurner={onSyncBurner}
        burnerOpen
        burnerOutOfSync
        burnerActive
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: /sync burner terminal/i })
    )

    expect(
      screen.getByRole('button', {
        name: /stop the running command, then sync pwd/i,
      })
    ).toHaveTextContent('sync_problem')

    rerender(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        onSyncBurner={onSyncBurner}
        burnerOpen
        burnerOutOfSync
      />
    )

    expect(
      screen.getByRole('button', { name: /sync burner terminal/i })
    ).toHaveTextContent('sync')
    expect(onSyncBurner).not.toHaveBeenCalled()
  })

  test('renders visible pane shortcut hint when provided', () => {
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        shortcutHint="⌘1"
      />
    )

    expect(screen.getByTestId('pane-shortcut-hint')).toHaveTextContent('⌘1')
  })

  test('renders shortcut hint before the burner button', () => {
    render(
      <HeaderActions
        isCollapsed={expanded}
        onToggleCollapse={vi.fn()}
        onBurner={vi.fn()}
        shortcutHint="⌘1"
      />
    )

    const hint = screen.getByTestId('pane-shortcut-hint')

    const burner = screen.getByRole('button', {
      name: /open burner terminal/i,
    })

    expect(
      hint.compareDocumentPosition(burner) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  test('hovering the collapse-status button shows a plain tooltip', async () => {
    const user = userEvent.setup()
    render(<HeaderActions isCollapsed={expanded} onToggleCollapse={vi.fn()} />)

    await user.hover(screen.getByRole('button', { name: /collapse status/i }))
    const tip = await screen.findByRole('tooltip')
    // IconButton derives the tooltip from its label (the accessible name).
    expect(tip).toHaveTextContent('collapse status')
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
    // IconButton derives the tooltip from its label (the accessible name).
    expect(tip).toHaveTextContent('close pane')
    expect(within(tip).queryByTestId('tooltip-shortcut')).toBeNull()
  })
})
