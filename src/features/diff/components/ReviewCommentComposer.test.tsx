import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ReviewCommentComposer } from './ReviewCommentComposer'

/**
 * Create a real anchor element attached to document.body.
 * floating-ui needs the anchor in the DOM to compute positioning.
 */
const createAnchor = (): HTMLDivElement => {
  const el = document.createElement('div')
  document.body.appendChild(el)

  return el
}

describe('ReviewCommentComposer', () => {
  let anchor: HTMLDivElement

  beforeEach(() => {
    anchor = createAnchor()
  })

  afterEach(() => {
    anchor.remove()
  })

  test('renders the textarea pre-filled with initialText', () => {
    render(
      <ReviewCommentComposer
        anchor={anchor}
        initialText="pre-filled text"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox')).toHaveValue('pre-filled text')
  })

  test('renders with an empty textarea when no initialText provided', () => {
    render(
      <ReviewCommentComposer
        anchor={anchor}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  test('typing updates the textarea value', async () => {
    const user = userEvent.setup()

    render(
      <ReviewCommentComposer
        anchor={anchor}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, 'hello world')

    expect(textarea).toHaveValue('hello world')
  })

  test('Enter confirms with trimmed text', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentComposer
        anchor={anchor}
        initialText="  my comment  "
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    // Click the textarea to ensure it has focus before pressing Enter.
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
        anchor={anchor}
        initialText="line one"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    const textarea = screen.getByRole('textbox')
    // Move cursor to end then Shift+Enter
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
        anchor={anchor}
        initialText="some text"
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />
    )

    await user.keyboard('{Escape}')

    expect(handleCancel).toHaveBeenCalledTimes(1)
  })

  test('Cancel button calls onCancel', async () => {
    const user = userEvent.setup()
    const handleCancel = vi.fn()

    render(
      <ReviewCommentComposer
        anchor={anchor}
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(handleCancel).toHaveBeenCalledTimes(1)
  })

  test('Add comment button is disabled when text is empty', () => {
    render(
      <ReviewCommentComposer
        anchor={anchor}
        initialText=""
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Add comment' })).toBeDisabled()
  })

  test('Add comment button is disabled when text is whitespace only', () => {
    render(
      <ReviewCommentComposer
        anchor={anchor}
        initialText="   "
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Add comment' })).toBeDisabled()
  })

  test('Enter does not confirm when text is empty', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentComposer
        anchor={anchor}
        initialText=""
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.keyboard('{Enter}')

    expect(handleConfirm).not.toHaveBeenCalled()
  })

  test('Enter does not confirm when text is whitespace only', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentComposer
        anchor={anchor}
        initialText="   "
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.keyboard('{Enter}')

    expect(handleConfirm).not.toHaveBeenCalled()
  })

  test('Add comment button fires onConfirm with trimmed text when clicked', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()

    render(
      <ReviewCommentComposer
        anchor={anchor}
        initialText="valid comment"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add comment' }))

    expect(handleConfirm).toHaveBeenCalledTimes(1)
    expect(handleConfirm).toHaveBeenCalledWith('valid comment')
  })

  test('click outside the popover calls onCancel via useDismiss', async () => {
    const user = userEvent.setup()
    const handleCancel = vi.fn()

    render(
      <ReviewCommentComposer
        anchor={anchor}
        initialText="some text"
        onConfirm={vi.fn()}
        onCancel={handleCancel}
      />
    )

    // Click on a DOM element outside the floating popover.
    // useDismiss fires onOpenChange(false) → onCancel on pointerdown outside.
    await user.click(document.body)

    await waitFor(() => {
      expect(handleCancel).toHaveBeenCalledTimes(1)
    })
  })

  test('renders the popover via FloatingPortal (outside the render container)', () => {
    const { container } = render(
      <ReviewCommentComposer
        anchor={anchor}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // The textarea must be in the document but NOT inside the React render root.
    // FloatingPortal mounts directly under document.body, escaping the render container.
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    // The render root (container) must not contain a textbox.
    // (It is an empty div when FloatingPortal is used correctly.)
    const { queryByRole } = within(container)
    expect(queryByRole('textbox')).not.toBeInTheDocument()
  })
})
