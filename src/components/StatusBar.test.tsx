import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { StatusBar, type StatusBarProps } from './StatusBar'

const defaultProps = {
  session: {
    startedAgo: '4h 12m',
    turns: 37,
    cache: { cached: 73, wrote: 20, fresh: 7 },
    changes: { added: 212, removed: 188 },
  },
  contextPct: 74,
  paletteShortcut: ['Mod', ';'],
  onOpenPalette: vi.fn(),
} satisfies StatusBarProps

const renderStatusBar = (
  overrides: Partial<StatusBarProps> = {}
): ReturnType<typeof render> =>
  render(<StatusBar {...defaultProps} {...overrides} />)

describe('StatusBar', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    })
  })

  test('renders the running session state with every segment', () => {
    renderStatusBar()

    expect(screen.getByText('obsidian-cli')).toHaveClass(
      'text-primary-container'
    )
    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument()
    expect(screen.getByTestId('status-bar-duration')).toHaveTextContent(
      'schedule4h 12m'
    )
    expect(screen.getByTestId('status-bar-context')).toHaveTextContent('😐74%')
    expect(screen.getByTestId('status-bar-cache')).toHaveTextContent(
      'bolt73%cached'
    )

    expect(screen.getByTestId('status-bar-turns')).toHaveTextContent('37 turns')
    expect(screen.getByTestId('status-bar-diff')).toHaveTextContent('+212−188')
    expect(
      screen.getByRole('button', { name: /open command palette/i })
    ).toBeInTheDocument()
    expect(screen.getByText('Ctrl')).toBeInTheDocument()
    expect(screen.getByText(';')).toBeInTheDocument()
  })

  test('renders the platform command key on macOS', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })

    renderStatusBar()

    expect(screen.getByText('⌘')).toBeInTheDocument()
    expect(screen.getByText(';')).toBeInTheDocument()
  })

  test('omits duration cache and diff segments without orphan separators', () => {
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
    expect(screen.queryByTestId('status-bar-diff')).not.toBeInTheDocument()
    expect(screen.getByTestId('status-bar-context')).toHaveTextContent('😊12%')
    expect(screen.getByTestId('status-bar-turns')).toHaveTextContent('0 turns')
    expect(screen.getAllByTestId('status-bar-separator')).toHaveLength(3)
  })

  test('renders only brand version and palette when no session is active', () => {
    renderStatusBar({ session: null })

    expect(screen.getByText('obsidian-cli')).toBeInTheDocument()
    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument()
    expect(screen.getByTestId('status-bar-palette')).toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-context')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-bar-turns')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('status-bar-separator')).toHaveLength(1)
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

  test('opens the command palette from the keyboard hint only', async () => {
    const user = userEvent.setup()
    const onOpenPalette = vi.fn()
    renderStatusBar({ onOpenPalette })

    await user.click(
      screen.getByRole('button', { name: /open command palette/i })
    )

    expect(onOpenPalette).toHaveBeenCalledOnce()
  })

  test('keeps the mobile wrap contract in the rendered classes', () => {
    renderStatusBar()

    expect(screen.getByTestId('status-bar')).toHaveClass('max-[760px]:h-[44px]')

    expect(screen.getByTestId('status-bar-right')).toHaveClass(
      'max-[760px]:basis-full',
      'max-[760px]:justify-end'
    )
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
