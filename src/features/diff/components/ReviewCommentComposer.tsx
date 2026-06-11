import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AnnotationSide } from '@pierre/diffs'

interface ReviewCommentComposerProps {
  /** 1-based line number the comment is anchored to. */
  lineNumber: number
  /** Which side of the diff the line lives on (additions => R, deletions => L). */
  side: AnnotationSide
  initialText?: string
  value?: string
  onTextChange?: (text: string) => void
  onConfirm: (text: string) => void
  onCancel: () => void
}

// Codex-style inline comment composer. Rendered in Pierre's annotation slot
// (full-width, below the target line) rather than as a floating popover, so it
// sits in the diff flow and never chases the cursor. Enter submits, Shift+Enter
// inserts a newline, Escape cancels.
export const ReviewCommentComposer = ({
  lineNumber,
  side,
  initialText = '',
  value = undefined,
  onTextChange = undefined,
  onConfirm,
  onCancel,
}: ReviewCommentComposerProps): ReactElement => {
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

  const lineRef = `${side === 'deletions' ? 'L' : 'R'}${lineNumber}`

  return (
    <div
      role="dialog"
      aria-label={`Comment on line ${lineRef}`}
      className="mx-2 my-1 flex flex-col gap-2 rounded-lg bg-surface-container-high/80 p-3"
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
        <span className="text-on-surface-variant text-[0.7rem]">
          Comment on line {lineRef}
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e): void => updateText(e.target.value)}
        onKeyDown={(e): void => {
          if (e.key === 'Enter' && !e.shiftKey) {
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
