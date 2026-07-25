/* eslint-disable testing-library/no-node-access -- left/right anchoring asserts bar child order the queries API cannot reach */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { StatusBar, type StatusBarProps } from './StatusBar'

const defaultProps = {
  session: {
    startedAgo: '4h 12m',
    turns: 37,
    changes: { added: 212, removed: 188 },
  },
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
    expect(screen.getByTestId('status-bar-turns')).toHaveTextContent('37 turns')
    expect(screen.getByTestId('status-bar-diff')).toHaveTextContent('+212−188')
    expect(screen.getAllByTestId('status-bar-separator')).toHaveLength(2)
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

  test('dock tooltip uses the supplied shortcut chips', async () => {
    const user = userEvent.setup()
    renderStatusBar({ dockShortcut: ['Ctrl', 'D'] })

    await user.hover(screen.getByTestId('status-bar-dock-toggle'))

    expect(
      within(await screen.findByRole('tooltip')).getByTestId('tooltip-shortcut')
    ).toHaveTextContent('Ctrl+D')
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

  test('omits duration turns and diff segments without orphan separators (J9)', () => {
    renderStatusBar({
      session: {
        startedAgo: '—',
        turns: 0,
        changes: { added: 0, removed: 0 },
      },
    })

    expect(screen.queryByTestId('status-bar-duration')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-turns')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-diff')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('status-bar-separator')).toHaveLength(0)
  })

  test('renders only the action buttons when no session is active', () => {
    renderStatusBar({ session: null })

    expect(screen.getByTestId('status-bar-palette')).toBeInTheDocument()
    expect(screen.getByTestId('status-bar-dock-toggle')).toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-turns')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('status-bar-separator')).toHaveLength(0)
  })

  test('uses compact diff counts for large line deltas', () => {
    renderStatusBar({
      session: {
        startedAgo: '1d 03h',
        turns: 44,
        changes: { added: 540, removed: 1200 },
      },
    })

    expect(screen.getByTestId('status-bar-diff')).toHaveTextContent('+540−1.2k')
  })

  test('maps diff additions to the success token', () => {
    renderStatusBar()

    // Theme token: the semantic success color (set during the #424 migration).
    expect(screen.getByText('+212')).toHaveClass('text-success')
  })

  test('renders only the additions span when nothing was removed', () => {
    renderStatusBar({
      session: {
        startedAgo: '2m',
        turns: 5,
        changes: { added: 500, removed: 0 },
      },
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
    })

    // Must not show a misleading +0 in the success (green) tone.
    expect(screen.getByTestId('status-bar-diff').textContent).toBe('−300')
  })

  test('narrow widths hide duration and turns instead of wrapping (J7)', () => {
    renderStatusBar()

    const bar = screen.getByTestId('status-bar')
    expect(bar.className).not.toContain('max-[760px]:h-[44px]')

    expect(screen.getByTestId('status-bar-duration')).toHaveClass(
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

  test('shows the burner open state when a burner shell is visible', () => {
    renderStatusBar({ burnerCount: 1, burnerOpen: true })

    expect(screen.getByTestId('status-bar-burner')).toHaveTextContent(
      'burner open'
    )
  })

  test('omits the burner count segment when none are running', () => {
    renderStatusBar({ burnerCount: 0 })

    expect(screen.queryByTestId('status-bar-burner')).toBeNull()
  })
})
