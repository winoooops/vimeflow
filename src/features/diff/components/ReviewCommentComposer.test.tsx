import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ReviewCommentComposer } from './ReviewCommentComposer'

describe('ReviewCommentComposer', () => {
  test('renders the "Local comment" header and the R-side line reference', () => {
    render(
      <ReviewCommentComposer
        lineNumber={190}
        side="additions"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Local comment')).toBeInTheDocument()
    expect(screen.getByText('Comment on line R190')).toBeInTheDocument()
  })

  test('renders the L-side line reference for a deletions-side comment', () => {
    render(
      <ReviewCommentComposer
        lineNumber={42}
        side="deletions"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Comment on line L42')).toBeInTheDocument()
  })

  test('renders the textarea pre-filled with initialText', () => {
    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        initialText="pre-filled text"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox')).toHaveValue('pre-filled text')
  })

  test('typing updates the textarea value', async () => {
    const user = userEvent.setup()

    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'hello world')

    expect(textarea).toHaveValue('hello world')
  })

  test('Enter confirms with trimmed text', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        initialText="  my comment  "
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('textbox'))
    await user.keyboard('{Enter}')

    expect(handleConfirm).toHaveBeenCalledTimes(1)
    expect(handleConfirm).toHaveBeenCalledWith('my comment')
  })

  test('Shift+Enter inserts a newline and does not confirm', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        initialText="line one"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    const textarea = screen.getByRole('textbox')
    await user.click(textarea)
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(handleConfirm).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('line one\n')
  })

  test('Escape calls onCancel', async () => {
    const user = userEvent.setup()
    const handleCancel = vi.fn()

    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        initialText="some text"
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />
    )

    await user.click(screen.getByRole('textbox'))
    await user.keyboard('{Escape}')

    expect(handleCancel).toHaveBeenCalledTimes(1)
  })

  test('Cancel button calls onCancel', async () => {
    const user = userEvent.setup()
    const handleCancel = vi.fn()

    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(handleCancel).toHaveBeenCalledTimes(1)
  })

  test('Comment button is disabled when text is empty', () => {
    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        initialText=""
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled()
  })

  test('Comment button is disabled when text is whitespace only', () => {
    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        initialText="   "
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled()
  })

  test('Enter does not confirm when text is whitespace only', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        initialText="   "
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('textbox'))
    await user.keyboard('{Enter}')

    expect(handleConfirm).not.toHaveBeenCalled()
  })

  test('Comment button fires onConfirm with trimmed text when clicked', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentComposer
        lineNumber={1}
        side="additions"
        initialText="valid comment"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Comment' }))

    expect(handleConfirm).toHaveBeenCalledTimes(1)
    expect(handleConfirm).toHaveBeenCalledWith('valid comment')
  })
})
