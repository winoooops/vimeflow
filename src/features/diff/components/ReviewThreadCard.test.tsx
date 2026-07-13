import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ThreadGroup } from '../services/threadGroups'
import { ReviewThreadCard } from './ReviewThreadCard'

const group = (overrides: Partial<ThreadGroup> = {}): ThreadGroup => ({
  threadId: 'c1',
  turns: [
    {
      side: 'additions',
      lineNumber: 40,
      metadata: {
        id: 'c1',
        text: 'Why does the cap live here?',
        author: 'self',
        category: 'question',
        createdAt: 1,
        dispatchedAt: 1000,
        threadId: 'c1',
      },
    },
    {
      side: 'additions',
      lineNumber: 40,
      metadata: {
        id: 'g1',
        text: 'The pool applies backpressure per write.',
        author: 'agent',
        outcome: 'reply',
        createdAt: 2,
        threadId: 'c1',
      },
    },
  ],
  rollup: { label: 'Replied', chip: 'text-success' },
  resolved: false,
  cwd: '/repo',
  filePath: 'src/foo.ts',
  staged: false,
  ...overrides,
})

const actions = (
  overrides: Partial<Parameters<typeof ReviewThreadCard>[0]['actions']> = {}
): NonNullable<Parameters<typeof ReviewThreadCard>[0]['actions']> => ({
  replying: false,
  replyDraft: '',
  onStartReply: vi.fn(),
  onReplyDraftChange: vi.fn(),
  onSubmitReply: vi.fn(),
  onCancelReply: vi.fn(),
  onResolve: vi.fn(),
  onReopen: vi.fn(),
  ...overrides,
})

describe('ReviewThreadCard', () => {
  test('renders header, ordered turns, chips, and the footer pair', () => {
    render(
      <ReviewThreadCard
        group={group()}
        anchorLabel="line R40"
        actions={actions()}
      />
    )

    expect(screen.getByText('line R40')).toBeInTheDocument()
    expect(screen.getByText('2 turns')).toBeInTheDocument()
    expect(screen.getAllByText('Replied').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Why does the cap live here?')).toBeInTheDocument()
    expect(
      screen.getByText('The pool applies backpressure per write.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reply/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument()
  })

  test('category-less follow-up turns render no chip', () => {
    const g = group()
    g.turns.push({
      side: 'additions',
      lineNumber: 40,
      metadata: {
        id: 'f1',
        text: 'And during drags?',
        author: 'self',
        createdAt: 3,
        dispatchedAt: 2000,
        threadId: 'c1',
      },
    })

    render(
      <ReviewThreadCard group={g} anchorLabel="line R40" actions={actions()} />
    )

    // Exactly one category chip (the root's Question) despite two self turns.
    expect(screen.getAllByText('Question')).toHaveLength(1)
  })

  test('reply expands the editor; confirm submits the draft', () => {
    const a = actions({ replying: true, replyDraft: 'follow-up text' })
    render(
      <ReviewThreadCard group={group()} anchorLabel="line R40" actions={a} />
    )

    fireEvent.keyDown(screen.getByPlaceholderText('Reply to the agent…'), {
      key: 'Enter',
    })
    expect(a.onSubmitReply).toHaveBeenCalledWith('follow-up text')
  })

  test('no actions → no footer', () => {
    render(<ReviewThreadCard group={group()} anchorLabel="line R40" />)

    expect(screen.queryByRole('button', { name: /reply/i })).toBeNull()
  })

  test('resolved collapses to a disclosure header; expanding reveals Reopen', () => {
    render(
      <ReviewThreadCard
        group={group({
          resolved: true,
          rollup: { label: 'Resolved', chip: 'text-success' },
        })}
        anchorLabel="line R40"
        actions={actions()}
      />
    )

    expect(screen.queryByText('Why does the cap live here?')).toBeNull()
    const disclosure = screen.getByRole('button', { name: /thread/i })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Why does the cap live here?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reopen/i })).toBeInTheDocument()
  })

  test('re-resolving after an expanded reopen collapses again', () => {
    // expand-while-resolved is reset when the thread reopens: render resolved,
    // expand via the disclosure, rerender with resolved: false (reopened),
    // then rerender resolved: true again → the card must be COLLAPSED.
    const resolved = group({
      resolved: true,
      rollup: { label: 'Resolved', chip: 'text-success' },
    })

    const { rerender } = render(
      <ReviewThreadCard
        group={resolved}
        anchorLabel="line R40"
        actions={actions()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /thread/i }))
    rerender(
      <ReviewThreadCard
        group={group()}
        anchorLabel="line R40"
        actions={actions()}
      />
    )

    rerender(
      <ReviewThreadCard
        group={resolved}
        anchorLabel="line R40"
        actions={actions()}
      />
    )

    expect(screen.queryByText('Why does the cap live here?')).toBeNull()
  })
})
