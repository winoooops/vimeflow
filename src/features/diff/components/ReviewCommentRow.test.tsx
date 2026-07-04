import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ReviewCommentRow } from './ReviewCommentRow'

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
        editShortcut="Shift+U"
        deleteShortcut={null}
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

  test('marks a dispatched comment as Sent', () => {
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

    expect(screen.getByText('Sent')).toBeInTheDocument()
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

    expect(screen.queryByText('Sent')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit comment' })
    ).toBeInTheDocument()
  })
})
