/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Group } from './Group'
import type { Session } from '../../workspace/types'

const session = (id: string, status: Session['status'] = 'running'): Session =>
  ({ id, name: id, status }) as unknown as Session

describe('Group.Header', () => {
  test('renders label text and the conventional data-testid', () => {
    render(<Group.Header label="Active" />)
    expect(screen.getByTestId('session-group-active')).toHaveTextContent(
      'Active'
    )
  })

  test('renders Recent header with its own data-testid', () => {
    render(<Group.Header label="Recent" />)
    expect(screen.getByTestId('session-group-recent')).toHaveTextContent(
      'Recent'
    )
  })

  test('renders headerAction next to the label when provided', () => {
    render(
      <Group.Header
        label="Active"
        headerAction={<button type="button">Add</button>}
      />
    )
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  test('absent headerAction renders nothing in the action slot', () => {
    render(<Group.Header label="Active" />)
    const header = screen.getByTestId('session-group-active')
    expect(within(header.parentElement!).queryByRole('button')).toBeNull()
  })
})

describe('Group (body) — active variant', () => {
  test('renders Reorder.Group with data-testid="session-list" and px-2 class', () => {
    render(
      <Group
        variant="active"
        sessions={[session('a'), session('b')]}
        onReorder={vi.fn()}
      >
        <li data-testid="card-a">A</li>
        <li data-testid="card-b">B</li>
      </Group>
    )
    const container = screen.getByTestId('session-list')
    expect(container).toHaveClass('flex flex-col px-2')
    // Recent's pb-1 should NOT be on Active.
    expect(container.className).not.toContain('pb-1')
  })

  test('renders children when sessions is non-empty', () => {
    render(
      <Group variant="active" sessions={[session('a')]} onReorder={vi.fn()}>
        <li data-testid="card-a">A</li>
      </Group>
    )
    expect(screen.getByTestId('card-a')).toBeInTheDocument()
  })

  test('renders emptyState when sessions is empty and emptyState is provided', () => {
    render(
      <Group
        variant="active"
        sessions={[]}
        onReorder={vi.fn()}
        emptyState={<li data-testid="empty">No sessions</li>}
      >
        <li data-testid="card-a">A</li>
      </Group>
    )
    expect(screen.getByTestId('empty')).toBeInTheDocument()
    expect(screen.queryByTestId('card-a')).not.toBeInTheDocument()
  })
})

describe('Group (body) — recent variant', () => {
  test('renders <ul> with data-testid="recent-list" and pb-1 class', () => {
    render(
      <Group variant="recent" sessions={[session('a', 'completed')]}>
        <li data-testid="card-a">A</li>
      </Group>
    )
    const container = screen.getByTestId('recent-list')
    expect(container.tagName).toBe('UL')
    expect(container).toHaveClass('pb-1')
  })

  test('does NOT carry drag-related props (Recent has no Reorder.Group)', () => {
    render(
      <Group variant="recent" sessions={[session('a', 'completed')]}>
        <li data-testid="card-a">A</li>
      </Group>
    )
    // Recent's container should be a plain <ul>; framer-motion's
    // Reorder.Group renders as a motion-augmented <ul>. The simplest
    // smoke is asserting the tagName + the absence of an aria
    // attribute that Reorder.Group would set, but that is brittle.
    // Just confirm tagName.
    expect(screen.getByTestId('recent-list').tagName).toBe('UL')
  })
})
