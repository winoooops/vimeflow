import { useEffect, useRef, useState, type ReactElement } from 'react'

type CommentSide = 'deletions' | 'additions'

interface ReviewCommentEditorBaseProps {
  chrome?: 'card' | 'plain'
  surfaceRole?: 'dialog' | 'none'
  initialText?: string
  value?: string
  onTextChange?: (text: string) => void
  onConfirm: (text: string) => void
  onCancel: () => void
}

type ReviewCommentEditorProps = ReviewCommentEditorBaseProps & {
  /** Line anchor for single-line comments and the start of range comments. */
  lineNumber?: number
  /** Diff side used for fallback R/L labels when targetLabel is absent. */
  side?: CommentSide
  /** Preformatted target text for file/range comments, e.g. "file src/a.ts". */
  targetLabel?: string
}

export const moveTextareaCursorVertically = (
  textarea: HTMLTextAreaElement,
  direction: -1 | 1
): void => {
  const { value, selectionStart } = textarea
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  const column = selectionStart - lineStart

  if (direction < 0) {
    if (lineStart === 0) {
      return
    }

    const previousLineEnd = lineStart - 1
    const previousLineStart = value.lastIndexOf('\n', previousLineEnd - 1) + 1
    const next = Math.min(previousLineStart + column, previousLineEnd)
    textarea.setSelectionRange(next, next)

    return
  }

  const lineEnd = value.indexOf('\n', selectionStart)
  if (lineEnd === -1) {
    return
  }

  const nextLineStart = lineEnd + 1
  const nextLineEndIndex = value.indexOf('\n', nextLineStart)

  const nextLineEnd = nextLineEndIndex === -1 ? value.length : nextLineEndIndex

  const next = Math.min(nextLineStart + column, nextLineEnd)
  textarea.setSelectionRange(next, next)
}

const isCtrlTextNavigation = (
  event: Pick<
    KeyboardEvent,
    'altKey' | 'code' | 'ctrlKey' | 'key' | 'keyCode' | 'metaKey'
  >,
  key: 'j' | 'k'
): boolean =>
  event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  (event.key.toLowerCase() === key ||
    (key === 'j' && event.key === 'Enter') ||
    event.code === `Key${key.toUpperCase()}` ||
    event.keyCode === (key === 'j' ? 10 : 11) ||
    event.keyCode === key.toUpperCase().charCodeAt(0))

const insertTextareaNewline = (
  textarea: HTMLTextAreaElement,
  updateText: (next: string) => void
): void => {
  const { selectionStart, selectionEnd, value } = textarea
  const next = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`
  const nextCursor = selectionStart + 1

  textarea.value = next
  updateText(next)
  textarea.setSelectionRange(nextCursor, nextCursor)
}

// Codex-style inline comment editor. Rendered in Pierre's annotation slot
// (full-width, below the target line) rather than as a floating popover, so it
// sits in the diff flow and never chases the cursor. Enter submits, Shift+Enter
// inserts a newline, Escape cancels.
export const ReviewCommentEditor = ({
  lineNumber = undefined,
  side = undefined,
  targetLabel = undefined,
  chrome = 'card',
  surfaceRole = 'dialog',
  initialText = '',
  value = undefined,
  onTextChange = undefined,
  onConfirm,
  onCancel,
}: ReviewCommentEditorProps): ReactElement => {
  const [uncontrolledText, setUncontrolledText] = useState(initialText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const text = value ?? uncontrolledText

  const updateText = (next: string): void => {
    if (value === undefined) {
      setUncontrolledText(next)
    }

    onTextChange?.(next)
  }

  useEffect((): void => {
    const node = textareaRef.current
    if (node) {
      node.focus()
      // Place the caret at the end when editing existing text.
      node.setSelectionRange(node.value.length, node.value.length)
    }
  }, [])

  const submit = (): void => {
    const trimmed = text.trim()

    if (trimmed.length > 0) {
      onConfirm(trimmed)
    }
  }

  const targetDescription =
    targetLabel ?? `line ${side === 'deletions' ? 'L' : 'R'}${lineNumber ?? ''}`

  const className =
    chrome === 'card'
      ? 'mx-2 my-1 flex flex-col gap-2 rounded-lg bg-surface-container-high/80 p-3'
      : 'flex flex-col gap-3 p-4'

  return (
    <div
      {...(surfaceRole === 'dialog'
        ? { role: 'dialog', 'aria-label': `Comment on ${targetDescription}` }
        : {})}
      className={className}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-on-surface">
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-base leading-none"
          >
            comment
          </span>
          Local comment
        </span>
        <span className="min-w-0 truncate text-right text-on-surface-variant text-[0.7rem]">
          Comment on {targetDescription}
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e): void => updateText(e.target.value)}
        onKeyDownCapture={(e): void => {
          if (isCtrlTextNavigation(e, 'j')) {
            e.preventDefault()
            e.stopPropagation()
            insertTextareaNewline(e.currentTarget, updateText)

            return
          }

          if (isCtrlTextNavigation(e, 'k')) {
            e.preventDefault()
            e.stopPropagation()
            moveTextareaCursorVertically(e.currentTarget, -1)

            return
          }

          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        rows={3}
        className="resize-none rounded bg-surface-container/60 p-2 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder="Request change"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={(): void => onCancel()}
          className="rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={(): void => submit()}
          disabled={text.trim().length === 0}
          className="rounded-md bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary/80 disabled:opacity-50"
        >
          Comment
        </button>
      </div>
    </div>
  )
}
