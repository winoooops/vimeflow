import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import {
  ReviewCommentEditor,
  moveTextareaCursorVertically,
} from './ReviewCommentEditor'

describe('ReviewCommentEditor', () => {
  test('renders the "Local comment" header and the R-side line reference', () => {
    render(
      <ReviewCommentEditor
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
      <ReviewCommentEditor
        lineNumber={42}
        side="deletions"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Comment on line L42')).toBeInTheDocument()
  })

  test('renders a file-level target label', () => {
    render(
      <ReviewCommentEditor
        targetLabel="file src/foo.ts"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Comment on file src/foo.ts')).toBeInTheDocument()
    expect(
      screen.getByRole('dialog', { name: 'Comment on file src/foo.ts' })
    ).toBeInTheDocument()
  })

  test('renders the textarea pre-filled with initialText', () => {
    render(
      <ReviewCommentEditor
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
      <ReviewCommentEditor
        lineNumber={1}
        side="additions"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    await user.type(textarea, 'hello world')

    expect(textarea).toHaveValue('hello world')
  })

  test('controlled value reports text changes without mutating display directly', async () => {
    const user = userEvent.setup()
    const handleTextChange = vi.fn()

    const { rerender } = render(
      <ReviewCommentEditor
        lineNumber={1}
        side="additions"
        value="draft"
        onTextChange={handleTextChange}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, '!')

    expect(handleTextChange).toHaveBeenCalledWith('draft!')
    expect(textarea).toHaveValue('draft')

    rerender(
      <ReviewCommentEditor
        lineNumber={1}
        side="additions"
        value="draft!"
        onTextChange={handleTextChange}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox')).toHaveValue('draft!')
  })

  test('Enter confirms with trimmed text', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentEditor
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
    expect(handleConfirm).toHaveBeenCalledWith('my comment', 'change')
  })

  test('Shift+Enter inserts a newline and does not confirm', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentEditor
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

  test('Ctrl+J and Ctrl+K cursor movement keeps the current column', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'one\ntwo\nthree'
    document.body.append(textarea)
    textarea.setSelectionRange(1, 1)

    moveTextareaCursorVertically(textarea, 1)
    expect(textarea.selectionStart).toBe(5)

    moveTextareaCursorVertically(textarea, -1)
    expect(textarea.selectionStart).toBe(1)

    textarea.remove()
  })

  test('Ctrl+J inserts a newline and Ctrl+K moves up when the browser reports code instead of key', () => {
    render(
      <ReviewCommentEditor
        lineNumber={1}
        side="additions"
        initialText={'one\ntwo\nthree'}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const textarea = screen.getByRole('textbox')
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('Expected textarea')
    }

    textarea.setSelectionRange(1, 1)

    fireEvent.keyDown(textarea, {
      key: 'Unidentified',
      code: 'KeyJ',
      ctrlKey: true,
    })
    expect(textarea).toHaveValue('o\nne\ntwo\nthree')
    expect(textarea.selectionStart).toBe(2)

    fireEvent.keyDown(textarea, {
      key: 'Unidentified',
      code: 'KeyK',
      ctrlKey: true,
    })
    expect(textarea.selectionStart).toBe(0)
  })

  test('Escape calls onCancel', async () => {
    const user = userEvent.setup()
    const handleCancel = vi.fn()

    render(
      <ReviewCommentEditor
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
      <ReviewCommentEditor
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
      <ReviewCommentEditor
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
      <ReviewCommentEditor
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
      <ReviewCommentEditor
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
      <ReviewCommentEditor
        lineNumber={1}
        side="additions"
        initialText="valid comment"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Comment' }))

    expect(handleConfirm).toHaveBeenCalledTimes(1)
    expect(handleConfirm).toHaveBeenCalledWith('valid comment', 'change')
  })

  test('clicking a category chip confirms with that category', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentEditor
        lineNumber={1}
        side="additions"
        initialText="a question"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Question' }))
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    expect(handleConfirm).toHaveBeenCalledWith('a question', 'question')
  })

  test('Ctrl+L cycles the category forward (vim l)', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentEditor
        lineNumber={1}
        side="additions"
        initialText="cycled"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('textbox'))
    // Default 'change' (index 1) → Ctrl+L → 'bug' (index 2).
    await user.keyboard('{Control>}l{/Control}')
    await user.keyboard('{Enter}')

    expect(handleConfirm).toHaveBeenLastCalledWith('cycled', 'bug')
  })

  test('initialCategory seeds the picker (used when editing)', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentEditor
        lineNumber={1}
        side="additions"
        initialText="seeded"
        initialCategory="suggestion"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('textbox'))
    await user.keyboard('{Enter}')

    expect(handleConfirm).toHaveBeenCalledWith('seeded', 'suggestion')
  })

  test('uses the controlled category prop and reports changes up', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()
    const handleCategoryChange = vi.fn()

    render(
      <ReviewCommentEditor
        lineNumber={1}
        side="additions"
        initialText="controlled"
        category="bug"
        onCategoryChange={handleCategoryChange}
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    // Submits with the controlled category, not the default.
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    expect(handleConfirm).toHaveBeenCalledWith('controlled', 'bug')

    // Ctrl+L reports the change upward instead of mutating local state.
    await user.click(screen.getByRole('textbox'))
    await user.keyboard('{Control>}l{/Control}')
    expect(handleCategoryChange).toHaveBeenCalledWith('suggestion')
  })

  test('reply mode hides category tabs and relabels the chrome', () => {
    render(
      <ReviewCommentEditor
        mode="reply"
        chrome="plain"
        surfaceRole="none"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('Reply to thread')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Question' })).toBeNull()
    expect(
      screen.getByPlaceholderText('Reply to the agent…')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument()
  })

  test('reply mode ignores the ctrl+h/l category cycle', async () => {
    const onConfirm = vi.fn()
    render(
      <ReviewCommentEditor
        mode="reply"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('Reply to the agent…')
    fireEvent.keyDown(textarea, { key: 'l', ctrlKey: true })
    fireEvent.keyDown(textarea, { key: 'h', ctrlKey: true })
    fireEvent.change(textarea, { target: { value: 'follow-up' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onConfirm).toHaveBeenCalledWith('follow-up', 'change')
  })
})
