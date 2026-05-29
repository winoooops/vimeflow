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
})
