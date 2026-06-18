/* eslint-disable testing-library/no-node-access -- left/right anchoring asserts bar child order the queries API cannot reach */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { StatusBar, type StatusBarProps } from './StatusBar'

const defaultProps = {
  session: {
    startedAgo: '4h 12m',
    turns: 37,
    cache: { cached: 73, wrote: 20, fresh: 7 },
    changes: { added: 212, removed: 188 },
  },
  contextPct: 74,
  onOpenPalette: vi.fn(),
  dockOpen: false,
  onToggleDock: vi.fn(),
} satisfies StatusBarProps

const renderStatusBar = (
  overrides: Partial<StatusBarProps> = {}
): ReturnType<typeof render> =>
  render(<StatusBar {...defaultProps} {...overrides} />)

const staticBgClasses = (element: HTMLElement): string[] =>
  element.className.split(/\s+/).filter((cls) => cls.startsWith('bg-'))

describe('StatusBar', () => {
  test('renders left icon actions and right readouts on the 24px chrome bar (J7)', () => {
    renderStatusBar()

    const bar = screen.getByTestId('status-bar')
    expect(bar).toHaveClass('h-[var(--status-bar-h)]')
    expect(bar).toHaveClass('bg-surface')
    expect(bar).toHaveClass('border-t')
    expect(bar).not.toHaveClass('flex-wrap')

    // Brand, version, and the kbd palette chips are gone in this treatment.
    expect(screen.queryByText('obsidian-cli')).toBeNull()
    expect(screen.queryByText(/^v\d+\.\d+\.\d+$/)).toBeNull()
    expect(screen.queryByText('Ctrl')).toBeNull()

    // Action buttons are anchored at the bar's left edge.
    const actions = screen.getByTestId('status-bar-actions')
    expect(bar.firstElementChild).toBe(actions)
    expect(
      screen.getByRole('button', { name: 'Open command palette' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('status-bar-dock-toggle')).toBeInTheDocument()

    // Readouts stay on the right with every segment live.
    expect(screen.getByTestId('status-bar-duration')).toHaveTextContent(
      'schedule4h 12m'
    )
    expect(screen.getByTestId('status-bar-context')).toHaveTextContent('😐74%')
    expect(screen.getByTestId('status-bar-cache')).toHaveTextContent(
      'bolt73%cached'
    )
    expect(screen.getByTestId('status-bar-turns')).toHaveTextContent('37 turns')
    expect(screen.getByTestId('status-bar-diff')).toHaveTextContent('+212−188')
    expect(screen.getAllByTestId('status-bar-separator')).toHaveLength(4)
  })

  test('action buttons are transparent compact icon buttons with hover fill only (J7)', () => {
    renderStatusBar()

    const palette = screen.getByTestId('status-bar-palette')
    // The native title is replaced by the Zed-style Tooltip (covered below).
    expect(palette).not.toHaveAttribute('title')
    expect(staticBgClasses(palette)).toEqual([])
    expect(palette.className).toContain('hover:bg-primary/10')
    expect(palette.className).toContain('rounded-[5px]')

    const dockToggle = screen.getByTestId('status-bar-dock-toggle')
    expect(dockToggle).not.toHaveAttribute('title')
    expect(staticBgClasses(dockToggle)).toEqual([])
  })

  test('action buttons expose Zed-style tooltips with shortcut chips', async () => {
    const user = userEvent.setup()
    renderStatusBar({ dockOpen: false })

    await user.hover(screen.getByTestId('status-bar-palette'))
    const paletteTip = await screen.findByRole('tooltip')
    expect(paletteTip).toHaveTextContent('Command palette')
    expect(
      within(paletteTip).getByTestId('tooltip-shortcut')
    ).toHaveTextContent(';')

    await user.unhover(screen.getByTestId('status-bar-palette'))

    await user.hover(screen.getByTestId('status-bar-dock-toggle'))
    const dockTip = await screen.findByRole('tooltip')
    expect(dockTip).toHaveTextContent('Show editor & diff')
    // Same Mod+0 keybinding the dock's collapse-panel button advertises.
    expect(within(dockTip).getByTestId('tooltip-shortcut')).toHaveTextContent(
      '0'
    )
  })

  test('palette tooltip uses the supplied shortcut chips', async () => {
    const user = userEvent.setup()
    renderStatusBar({ paletteShortcut: ['Ctrl', 'K'] })

    await user.hover(screen.getByTestId('status-bar-palette'))

    expect(
      within(await screen.findByRole('tooltip')).getByTestId('tooltip-shortcut')
    ).toHaveTextContent('Ctrl+K')
  })

  test('dock toggle indicates open state through icon color, not a filled background (J8)', () => {
    const { rerender } = renderStatusBar({ dockOpen: false })

    const closedToggle = screen.getByTestId('status-bar-dock-toggle')
    expect(closedToggle).toHaveAttribute('aria-pressed', 'false')
    expect(closedToggle).toHaveAccessibleName('Show editor & diff panel')
    expect(closedToggle.className).toContain('text-on-surface-muted')
    expect(closedToggle.className).not.toContain('text-success')

    rerender(<StatusBar {...defaultProps} dockOpen />)

    const openToggle = screen.getByTestId('status-bar-dock-toggle')
    expect(openToggle).toHaveAttribute('aria-pressed', 'true')
    expect(openToggle).toHaveAccessibleName('Hide editor & diff panel')
    expect(openToggle.className).toContain('text-success')
    expect(openToggle.className).toContain('hover:bg-success/[0.08]')
    expect(staticBgClasses(openToggle)).toEqual([])
  })

  test('clicking the dock toggle fires onToggleDock', async () => {
    const user = userEvent.setup()
    const onToggleDock = vi.fn()
    renderStatusBar({ onToggleDock })

    await user.click(screen.getByTestId('status-bar-dock-toggle'))

    expect(onToggleDock).toHaveBeenCalledOnce()
  })

  test('opens the command palette from the left action button', async () => {
    const user = userEvent.setup()
    const onOpenPalette = vi.fn()
    renderStatusBar({ onOpenPalette })

    await user.click(
      screen.getByRole('button', { name: /open command palette/i })
    )

    expect(onOpenPalette).toHaveBeenCalledOnce()
  })

  test('omits duration cache turns and diff segments without orphan separators (J9)', () => {
    renderStatusBar({
      session: {
        startedAgo: '—',
        turns: 0,
        cache: { cached: 0, wrote: 0, fresh: 0 },
        changes: { added: 0, removed: 0 },
      },
      contextPct: 12,
    })

    expect(screen.queryByTestId('status-bar-duration')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-cache')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-turns')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-diff')).not.toBeInTheDocument()
    expect(screen.getByTestId('status-bar-context')).toHaveTextContent('😊12%')
    expect(screen.queryAllByTestId('status-bar-separator')).toHaveLength(0)
  })

  test('renders only the action buttons when no session is active', () => {
    renderStatusBar({ session: null })

    expect(screen.getByTestId('status-bar-palette')).toBeInTheDocument()
    expect(screen.getByTestId('status-bar-dock-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-context')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-turns')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('status-bar-separator')).toHaveLength(0)
  })

  test('uses critical context and cold cache tones with compact diff counts', () => {
    renderStatusBar({
      session: {
        startedAgo: '1d 03h',
        turns: 44,
        cache: { cached: 35, wrote: 30, fresh: 35 },
        changes: { added: 540, removed: 1200 },
      },
      contextPct: 94,
    })

    expect(screen.getByTestId('status-bar-context')).toHaveTextContent('🥵94%')
    expect(screen.getByText('94%')).toHaveClass('text-error')
    expect(screen.getByTestId('status-bar-cache-rate')).toHaveTextContent('35%')

    expect(screen.getByTestId('status-bar-cache-rate')).toHaveClass(
      'text-tertiary'
    )

    expect(screen.getByTestId('status-bar-diff')).toHaveTextContent('+540−1.2k')
  })

  test('maps the warm cache and diff additions to the success token', () => {
    renderStatusBar()

    // Theme token: the semantic success color (set during the #424 migration).
    expect(screen.getByTestId('status-bar-cache-rate')).toHaveClass(
      'text-success'
    )
    expect(screen.getByText('+212')).toHaveClass('text-success')
  })

  test('renders only the additions span when nothing was removed', () => {
    renderStatusBar({
      session: {
        startedAgo: '2m',
        turns: 5,
        changes: { added: 500, removed: 0 },
      },
      contextPct: 20,
    })

    // Must not show a misleading −0 in the tertiary (orange) tone.
    expect(screen.getByTestId('status-bar-diff').textContent).toBe('+500')
  })

  test('renders only the removals span when nothing was added', () => {
    renderStatusBar({
      session: {
        startedAgo: '2m',
        turns: 5,
        changes: { added: 0, removed: 300 },
      },
      contextPct: 20,
    })

    // Must not show a misleading +0 in the success (green) tone.
    expect(screen.getByTestId('status-bar-diff').textContent).toBe('−300')
  })

  test('suppresses the context segment when contextPct is null', () => {
    renderStatusBar({
      session: {
        startedAgo: '2m',
        turns: 5,
        changes: { added: 1, removed: 1 },
      },
      contextPct: null,
    })

    // Agent is active (turns render) but no context reading has arrived yet, so
    // the segment is omitted rather than shown as a misleading 😊0%.
    expect(screen.queryByTestId('status-bar-context')).not.toBeInTheDocument()
    expect(screen.getByTestId('status-bar-turns')).toHaveTextContent('5 turns')
  })

  test('narrow widths hide duration, the cached label, and turns instead of wrapping (J7)', () => {
    renderStatusBar()

    const bar = screen.getByTestId('status-bar')
    expect(bar.className).not.toContain('max-[760px]:h-[44px]')

    expect(screen.getByTestId('status-bar-duration')).toHaveClass(
      'max-[760px]:hidden'
    )

    expect(screen.getByTestId('status-bar-cache-label')).toHaveClass(
      'max-[760px]:hidden'
    )

    expect(screen.getByTestId('status-bar-turns')).toHaveClass(
      'max-[760px]:hidden'
    )

    const readouts = screen.getByTestId('status-bar-right')
    expect(readouts).toHaveClass('gap-x-[8px]', 'max-[760px]:gap-x-[5px]')
  })

  test('shows the burner count segment when burner shells are running', () => {
    renderStatusBar({ burnerCount: 2 })

    expect(screen.getByTestId('status-bar-burner')).toHaveTextContent(
      'burner ×2'
    )
  })

  test('omits the burner count segment when none are running', () => {
    renderStatusBar({ burnerCount: 0 })

    expect(screen.queryByTestId('status-bar-burner')).toBeNull()
  })
})
