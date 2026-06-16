import { describe, test, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LiveActionCard, LiveActionPlaceholderCard } from './LiveActionCard'
import type { ToolActivityEvent } from '../types/activityEvent'

const now = new Date('2026-04-22T12:00:00Z')

const runningEvent = (
  overrides: Partial<ToolActivityEvent> = {}
): ToolActivityEvent => ({
  id: 'live-1',
  kind: 'edit',
  tool: 'Edit',
  body: 'src/middleware/auth.ts',
  timestamp: '2026-04-22T11:59:42Z', // 18s before `now`
  status: 'running',
  durationMs: null,
  ...overrides,
})

describe('LiveActionCard — presentation', () => {
  test('renders the NOW section label', () => {
    render(<LiveActionCard event={runningEvent()} now={now} />)

    expect(screen.getByText('NOW')).toBeInTheDocument()
  })

  test('renders the action verb in uppercase', () => {
    render(<LiveActionCard event={runningEvent({ kind: 'edit' })} now={now} />)

    expect(screen.getByText('EDIT')).toBeInTheDocument()
  })

  test('renders the target body (file path)', () => {
    render(
      <LiveActionCard
        event={runningEvent({ body: 'src/lib/jwt.ts' })}
        now={now}
      />
    )

    expect(screen.getByText('src/lib/jwt.ts')).toBeInTheDocument()
  })

  test('prefers pathLabel over the raw body when provided', () => {
    render(
      <LiveActionCard
        event={runningEvent({ body: '/abs/repo/src/a.ts' })}
        now={now}
        pathLabel="src/a.ts"
      />
    )

    expect(screen.getByText('src/a.ts')).toBeInTheDocument()
    expect(screen.queryByText('/abs/repo/src/a.ts')).not.toBeInTheDocument()
  })

  test('shows the tool name for meta tools instead of the kind', () => {
    const tool = 'TodoWrite'
    render(
      <LiveActionCard
        event={runningEvent({ kind: 'meta', tool, body: 'todos' })}
        now={now}
      />
    )

    expect(screen.getByText(tool.toUpperCase())).toBeInTheDocument()
    expect(screen.queryByText('META')).not.toBeInTheDocument()
  })

  test('renders a LIVE indicator', () => {
    render(<LiveActionCard event={runningEvent()} now={now} />)

    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  test('shows a running counter derived from elapsed time', () => {
    render(<LiveActionCard event={runningEvent()} now={now} />)

    expect(screen.getByText(/^running\s+18s$/)).toBeInTheDocument()
  })
})

describe('LiveActionPlaceholderCard — presentation', () => {
  test('reserves the live-action footprint without showing active status', () => {
    render(<LiveActionPlaceholderCard />)

    expect(
      screen.getByTestId('live-action-placeholder-card')
    ).toBeInTheDocument()
    expect(screen.queryByText('NOW')).not.toBeInTheDocument()
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument()
    expect(screen.queryByTestId('live-action-card')).not.toBeInTheDocument()
  })
})

describe('LiveActionCard — diff stats', () => {
  test('renders +added / −removed when diff is supplied', () => {
    render(
      <LiveActionCard
        event={runningEvent()}
        now={now}
        diff={{ added: 12, removed: 2 }}
      />
    )

    expect(screen.getByText('+12')).toBeInTheDocument()
    // U+2212 MINUS SIGN, not a hyphen.
    expect(screen.getByText('−2')).toBeInTheDocument()
  })

  test('omits the diff row when diff is absent', () => {
    render(<LiveActionCard event={runningEvent()} now={now} />)

    expect(screen.queryByText('+12')).not.toBeInTheDocument()
    expect(screen.queryByText('−2')).not.toBeInTheDocument()
  })
})

describe('LiveActionCard — activation', () => {
  test('calls onActivate when the card is clicked', async () => {
    const onActivate = vi.fn()
    const user = userEvent.setup()
    render(
      <LiveActionCard
        event={runningEvent()}
        now={now}
        onActivate={onActivate}
      />
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  test('activates on Enter key', () => {
    const onActivate = vi.fn()
    render(
      <LiveActionCard
        event={runningEvent()}
        now={now}
        onActivate={onActivate}
      />
    )

    fireEvent.keyDown(screen.getByRole('button', { name: /edit/i }), {
      key: 'Enter',
    })

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  test('is not a button when onActivate is absent', () => {
    render(<LiveActionCard event={runningEvent()} now={now} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('stays keyboard-focusable for the tooltip when not activatable', () => {
    // The running row is removed from the feed, so the card must remain
    // focusable for keyboard users to reach its tooltip details.
    render(
      <LiveActionCard
        event={runningEvent({ kind: 'bash', tool: 'Bash', body: 'npm test' })}
        now={now}
      />
    )

    expect(screen.getByTestId('live-action-card')).toHaveAttribute(
      'tabindex',
      '0'
    )
  })
})

describe('LiveActionCard — tooltip', () => {
  test('reveals the file-path detail on hover', async () => {
    const user = userEvent.setup()
    render(
      <LiveActionCard
        event={runningEvent({ body: 'src/middleware/auth.ts' })}
        now={now}
        onActivate={vi.fn()}
      />
    )

    await user.hover(screen.getByRole('button', { name: /edit/i }))

    // The shared ActivityTooltipContent splits dir + filename; the bold
    // filename node carries just 'auth.ts'.
    expect(await screen.findByText('auth.ts')).toBeInTheDocument()
  })
})
