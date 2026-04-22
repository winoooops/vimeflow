import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
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
  test('renders the ACTIVITY section header', () => {
    render(<ActivityFeed events={[]} />)

    expect(screen.getByText('ACTIVITY')).toBeInTheDocument()
  })

  test('renders "No activity yet" when events is empty', () => {
    render(<ActivityFeed events={[]} />)

    expect(screen.getByText('No activity yet')).toBeInTheDocument()
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
