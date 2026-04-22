import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityFeed } from './ActivityFeed'
import type { ActivityEvent as ActivityEventType } from '../types/activityEvent'

const fixedNow = new Date('2026-04-22T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(fixedNow)
})

afterEach(() => {
  vi.useRealTimers()
})

const doneEvent = (id: string, body: string): ActivityEventType => ({
  id,
  kind: 'edit',
  tool: 'Edit',
  body,
  timestamp: '2026-04-22T11:59:42Z', // 18s ago
  status: 'done',
  durationMs: 120,
})

describe('ActivityFeed', () => {
  test('renders a collapsible Activity header that is expanded by default', () => {
    render(<ActivityFeed events={[]} />)
    const toggle = screen.getByRole('button', { name: /activity/i })

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  test('renders "No activity yet" when events is empty', () => {
    render(<ActivityFeed events={[]} />)

    expect(screen.getByText('No activity yet')).toBeInTheDocument()
  })

  test('clicking the header collapses the feed body', async () => {
    // Real timers for user-event; the timer-tick test later re-enables fakes.
    vi.useRealTimers()
    const user = userEvent.setup()
    render(
      <ActivityFeed
        events={[doneEvent('a', 'src/a.ts'), doneEvent('b', 'src/b.ts')]}
      />
    )

    expect(screen.getByText('src/a.ts')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /activity/i }))

    expect(screen.queryByText('src/a.ts')).not.toBeInTheDocument()

    // Restore fake timers for the remaining tests in the file (afterEach
    // calls useRealTimers so order doesn't matter, but keep the pair tidy).
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  test('shows the event count next to the Activity header', () => {
    render(
      <ActivityFeed
        events={[doneEvent('a', 'src/a.ts'), doneEvent('b', 'src/b.ts')]}
      />
    )
    const toggle = screen.getByRole('button', { name: /activity/i })

    // CollapsibleSection renders `{count}` alongside the title.
    expect(toggle).toHaveTextContent('2')
  })

  test('does NOT render the empty-state text when events has entries', () => {
    render(<ActivityFeed events={[doneEvent('a', 'src/a.ts')]} />)

    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument()
  })

  test('renders events in given order', () => {
    render(
      <ActivityFeed
        events={[
          doneEvent('a', 'src/first.ts'),
          doneEvent('b', 'src/second.ts'),
          doneEvent('c', 'src/third.ts'),
        ]}
      />
    )
    const articles = screen.getAllByRole('article')

    expect(articles).toHaveLength(3)
    expect(articles[0]).toHaveTextContent('src/first.ts')
    expect(articles[1]).toHaveTextContent('src/second.ts')
    expect(articles[2]).toHaveTextContent('src/third.ts')
  })

  test('rail layout element is present (last-resort testid)', () => {
    render(<ActivityFeed events={[doneEvent('a', 'src/a.ts')]} />)

    expect(screen.getByTestId('activity-feed-rail')).toBeInTheDocument()
  })

  test('caps visible events at 10 by default when there are more', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      doneEvent(`e${i}`, `src/${i}.ts`)
    )
    render(<ActivityFeed events={events} />)

    expect(screen.getAllByRole('article')).toHaveLength(10)
    expect(
      screen.getByRole('button', { name: /5 earlier events/i })
    ).toBeInTheDocument()
  })

  test('show-more label uses singular "event" when exactly one is hidden', () => {
    // 11 events → overflow = 1 → label reads "+ 1 earlier event" (no 's')
    const events = Array.from({ length: 11 }, (_, i) =>
      doneEvent(`e${i}`, `src/${i}.ts`)
    )
    render(<ActivityFeed events={events} />)

    expect(
      screen.getByRole('button', { name: /1 earlier event$/i })
    ).toBeInTheDocument()
  })

  test('does not render the show-more button when events fit under the cap', () => {
    render(
      <ActivityFeed
        events={[doneEvent('a', 'src/a.ts'), doneEvent('b', 'src/b.ts')]}
      />
    )

    expect(
      screen.queryByRole('button', { name: /earlier events/i })
    ).not.toBeInTheDocument()
  })

  test('clicking "show more" reveals the full list and the button flips to "Show less"', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    const events = Array.from({ length: 15 }, (_, i) =>
      doneEvent(`e${i}`, `src/${i}.ts`)
    )
    render(<ActivityFeed events={events} />)

    await user.click(screen.getByRole('button', { name: /5 earlier events/i }))

    expect(screen.getAllByRole('article')).toHaveLength(15)
    expect(
      screen.getByRole('button', { name: /show less/i })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show less/i }))

    expect(screen.getAllByRole('article')).toHaveLength(10)

    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  test('expanding then transitioning to empty resets the show-more toggle', async () => {
    // Simulate an agent session: user expands the long feed, the session
    // ends (events -> []), then a new session starts and fills the feed
    // back past the cap. Without the reset effect, `Show less` would
    // appear on the new session without the user ever clicking.
    vi.useRealTimers()
    const user = userEvent.setup()

    const longFeed = Array.from({ length: 15 }, (_, i) =>
      doneEvent(`e${i}`, `src/${i}.ts`)
    )

    const { rerender } = render(<ActivityFeed events={longFeed} />)

    await user.click(screen.getByRole('button', { name: /5 earlier events/i }))

    expect(
      screen.getByRole('button', { name: /show less/i })
    ).toBeInTheDocument()

    // Session ends.
    rerender(<ActivityFeed events={[]} />)
    expect(screen.getByText('No activity yet')).toBeInTheDocument()

    // New session fills up with 15 events — the expanded-state flag must
    // have been reset so the default 10-visible + '+ 5 earlier events'
    // button come back.
    rerender(<ActivityFeed events={longFeed} />)
    expect(screen.getAllByRole('article')).toHaveLength(10)
    expect(
      screen.getByRole('button', { name: /5 earlier events/i })
    ).toBeInTheDocument()

    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  test('running event duration advances as the timer ticks', () => {
    render(
      <ActivityFeed
        events={[
          {
            id: 'active-Bash',
            kind: 'bash',
            tool: 'Bash',
            body: 'pnpm test',
            timestamp: '2026-04-22T11:59:52Z', // 8s before fixedNow
            status: 'running',
            durationMs: null,
          },
        ]}
      />
    )

    expect(screen.getByText('running 8s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByText('running 9s')).toBeInTheDocument()
  })
})
