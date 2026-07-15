import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { formatSentAgo, ReviewCommentRow } from './ReviewCommentRow'

describe('ReviewCommentRow', () => {
  test('renders the comment text', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: '1',
          text: 'Looks good to me',
          author: 'self',
          createdAt: 1000,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Looks good to me')).toBeInTheDocument()
  })

  test('a reviewer finding renders its reviewer name + category, read-only (VIM-304)', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: 'r1',
          text: 'Token compared with ==',
          author: 'reviewer',
          reviewer: 'codex',
          category: 'bug',
          createdAt: 3000,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('codex')).toBeInTheDocument()
    expect(screen.getByText('Bug')).toBeInTheDocument()
    expect(screen.getByText('Token compared with ==')).toBeInTheDocument()
    // Read-only: no edit/delete controls.
    expect(
      screen.queryByRole('button', { name: 'Edit comment' })
    ).not.toBeInTheDocument()
  })

  test('a reviewer finding with no name falls back to "Reviewer"', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: 'r2',
          text: 'x',
          author: 'reviewer',
          category: 'suggestion',
          createdAt: 3000,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Reviewer')).toBeInTheDocument()
  })

  test('clicking Edit button fires onEdit once', async () => {
    const user = userEvent.setup()
    const handleEdit = vi.fn()

    render(
      <ReviewCommentRow
        comment={{ id: '2', text: 'Fix this', author: 'self', createdAt: 2000 }}
        onEdit={handleEdit}
        onDelete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Edit comment' }))

    expect(handleEdit).toHaveBeenCalledTimes(1)
  })

  test('accepts file-level shortcut overrides', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: 'file-1',
          text: 'File-level comment',
          author: 'self',
          createdAt: 2000,
        }}
        editShortcut={['Shift', 'U']}
        editAriaKeyshortcuts="Shift+U"
        deleteShortcut={null}
        deleteAriaKeyshortcuts={null}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Edit comment' })
    ).toHaveAttribute('aria-keyshortcuts', 'Shift+U')

    expect(
      screen.getByRole('button', { name: 'Delete comment' })
    ).not.toHaveAttribute('aria-keyshortcuts')
  })

  test('clicking Delete button fires onDelete once', async () => {
    const user = userEvent.setup()
    const handleDelete = vi.fn()

    render(
      <ReviewCommentRow
        comment={{
          id: '3',
          text: 'Remove this',
          author: 'self',
          createdAt: 3000,
        }}
        onEdit={vi.fn()}
        onDelete={handleDelete}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Delete comment' }))

    expect(handleDelete).toHaveBeenCalledTimes(1)
  })

  test('clicking Edit does not fire onDelete', async () => {
    const user = userEvent.setup()
    const handleDelete = vi.fn()

    render(
      <ReviewCommentRow
        comment={{
          id: '4',
          text: 'Some comment',
          author: 'self',
          createdAt: 4000,
        }}
        onEdit={vi.fn()}
        onDelete={handleDelete}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Edit comment' }))

    expect(handleDelete).not.toHaveBeenCalled()
  })

  test('shows the range label when provided', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: '5',
          text: 'Range note',
          author: 'self',
          createdAt: 5000,
        }}
        targetLabel="lines R4-R6"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('lines R4-R6')).toBeInTheDocument()
    expect(screen.getByText('Range note')).toBeInTheDocument()
  })

  test('omits the label for a plain comment', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: '6',
          text: 'Plain note',
          author: 'self',
          createdAt: 6000,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.queryByText(/lines R/)).not.toBeInTheDocument()
  })

  test('marks a dispatched comment as Sent with the time elapsed', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: '7',
          text: 'Sent note',
          author: 'self',
          createdAt: 7000,
          dispatchedAt: 7100,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    // "Sent <n>d ago" — the badge leads with "Sent" and carries an elapsed time.
    expect(screen.getByText(/^Sent\b.*ago$/)).toBeInTheDocument()
  })

  test('dispatched comments are read-only anchors', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: 'sent-read-only',
          text: 'Sent note',
          author: 'self',
          createdAt: 7000,
          dispatchedAt: 7100,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Edit comment' })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: 'Delete comment' })
    ).not.toBeInTheDocument()
  })

  test('a pending comment shows no Sent label and keeps edit', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: '8',
          text: 'Pending note',
          author: 'self',
          createdAt: 8000,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.queryByText(/^Sent\b/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit comment' })
    ).toBeInTheDocument()
  })

  test('renders the category chip for a user comment', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: 'q',
          text: 'Why?',
          author: 'self',
          category: 'question',
          createdAt: 1000,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Question')).toBeInTheDocument()
  })

  test('an untagged comment shows the default Change chip', () => {
    render(
      <ReviewCommentRow
        comment={{ id: 'd', text: 'x', author: 'self', createdAt: 1000 }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Change')).toBeInTheDocument()
  })

  test('an agent reply renders distinctly and read-only', () => {
    render(
      <ReviewCommentRow
        comment={{
          id: 'a',
          text: 'The cap bounds latency.',
          author: 'agent',
          createdAt: 1000,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('Agent reply')).toBeInTheDocument()
    expect(screen.getByText('The cap bounds latency.')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit comment' })
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: 'Delete comment' })
    ).not.toBeInTheDocument()
  })

  test.each([
    ['reply', 'Replied'],
    ['clarify', 'Awaiting you'],
    ['resolved', 'Resolved'],
    ['deferred', 'Deferred'],
    ['rejected', 'Rejected'],
  ] as const)(
    'an agent turn with outcome %s renders its state chip',
    (outcome, label) => {
      render(
        <ReviewCommentRow
          comment={{
            id: 'a',
            text: 'x',
            author: 'agent',
            outcome,
            createdAt: 1000,
          }}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      )

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.queryByText('Agent reply')).not.toBeInTheDocument()
    }
  )

  test('a pending self comment with onSendNow renders the send button', async () => {
    const user = userEvent.setup()
    const onSendNow = vi.fn()
    render(
      <ReviewCommentRow
        comment={{ id: 's', text: 'x', author: 'self', createdAt: 1000 }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSendNow={onSendNow}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Send comment now' }))
    expect(onSendNow).toHaveBeenCalledOnce()
  })

  test('send-now is absent when omitted and on dispatched rows', () => {
    const { rerender } = render(
      <ReviewCommentRow
        comment={{ id: 's', text: 'x', author: 'self', createdAt: 1000 }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(
      screen.queryByRole('button', { name: 'Send comment now' })
    ).not.toBeInTheDocument()

    // Dispatched rows are read-only thread anchors — never re-sendable.
    rerender(
      <ReviewCommentRow
        comment={{
          id: 's',
          text: 'x',
          author: 'self',
          createdAt: 1000,
          dispatchedAt: 2000,
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSendNow={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Send comment now' })
    ).not.toBeInTheDocument()
  })

  test('agent and reviewer rows never render send-now', () => {
    const { rerender } = render(
      <ReviewCommentRow
        comment={{ id: 'a', text: 'x', author: 'agent', createdAt: 1000 }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSendNow={vi.fn()}
      />
    )
    expect(
      screen.queryByRole('button', { name: 'Send comment now' })
    ).not.toBeInTheDocument()

    rerender(
      <ReviewCommentRow
        comment={{ id: 'r', text: 'x', author: 'reviewer', createdAt: 1000 }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSendNow={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Send comment now' })
    ).not.toBeInTheDocument()
  })
})

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatSentAgo', () => {
  const base = 1_000_000_000_000

  test('under a minute reads "just now"', () => {
    expect(formatSentAgo(base, base)).toBe('just now')
    expect(formatSentAgo(base, base + 59_000)).toBe('just now')
  })

  test('rounds down to minutes, hours, and days', () => {
    expect(formatSentAgo(base, base + 5 * MINUTE)).toBe('5m ago')
    expect(formatSentAgo(base, base + 90 * MINUTE)).toBe('1h ago')
    expect(formatSentAgo(base, base + 3 * HOUR)).toBe('3h ago')
    expect(formatSentAgo(base, base + 2 * DAY)).toBe('2d ago')
  })

  test('a future dispatchedAt (clock skew) reads "just now"', () => {
    expect(formatSentAgo(base + 5000, base)).toBe('just now')
  })
})
