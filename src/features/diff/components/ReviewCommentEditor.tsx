import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  DEFAULT_REVIEW_COMMENT_CATEGORY,
  REVIEW_COMMENT_CATEGORIES,
  type ReviewCommentCategory,
} from '../hooks/useFeedbackBatch'
import { REVIEW_CATEGORY_META } from '../reviewCategoryMeta'
import { formatShortcut } from '../../../lib/formatShortcut'
import {
  chordToAriaShortcut,
  chordToShortcutInput,
} from '../../keymap/displayKey'
import { useKeybindings } from '../../keymap/useKeybindings'

type CommentSide = 'deletions' | 'additions'

interface ReviewCommentEditorBaseProps {
  chrome?: 'card' | 'plain'
  surfaceRole?: 'dialog' | 'none'
  initialText?: string
  initialCategory?: ReviewCommentCategory
  value?: string
  /** Controlled category (from the draft). Falls back to local state if unset. */
  category?: ReviewCommentCategory
  onTextChange?: (text: string) => void
  onCategoryChange?: (category: ReviewCommentCategory) => void
  onConfirm: (text: string, category: ReviewCommentCategory) => void
  onCancel: () => void
  /**
   * 'reply' = a typeless thread follow-up (VIM-298): category tabs hidden and
   * the cycle shortcuts inert, chrome copy reads Reply. Default 'comment'.
   */
  mode?: 'comment' | 'reply'
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
// sits in the diff flow and never chases the cursor. App actions resolve through
// the keymap registry; Shift+Enter remains native textarea newline editing.
export const ReviewCommentEditor = ({
  lineNumber = undefined,
  side = undefined,
  targetLabel = undefined,
  chrome = 'card',
  surfaceRole = 'dialog',
  initialText = '',
  initialCategory = DEFAULT_REVIEW_COMMENT_CATEGORY,
  value = undefined,
  category: categoryValue = undefined,
  onTextChange = undefined,
  onCategoryChange = undefined,
  onConfirm,
  onCancel,
  mode = 'comment',
}: ReviewCommentEditorProps): ReactElement => {
  const { bindingFor, matches } = useKeybindings()
  const [uncontrolledText, setUncontrolledText] = useState(initialText)

  const [uncontrolledCategory, setUncontrolledCategory] =
    useState<ReviewCommentCategory>(initialCategory)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const text = value ?? uncontrolledText
  const selectedCategory = categoryValue ?? uncontrolledCategory

  const updateCategory = (next: ReviewCommentCategory): void => {
    if (categoryValue === undefined) {
      setUncontrolledCategory(next)
    }

    onCategoryChange?.(next)
  }

  const cycleCategory = (direction: 1 | -1): void => {
    if (mode === 'reply') {
      return
    }
    const count = REVIEW_COMMENT_CATEGORIES.length
    const index = REVIEW_COMMENT_CATEGORIES.indexOf(selectedCategory)

    updateCategory(
      REVIEW_COMMENT_CATEGORIES[(index + direction + count) % count]
    )
  }

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
      onConfirm(trimmed, selectedCategory)
    }
  }

  const targetDescription =
    targetLabel ?? `line ${side === 'deletions' ? 'L' : 'R'}${lineNumber ?? ''}`

  const previousCategoryShortcut = formatShortcut(
    chordToShortcutInput(bindingFor('diff-comment-category-previous'))
  )

  const nextCategoryShortcut = formatShortcut(
    chordToShortcutInput(bindingFor('diff-comment-category-next'))
  )
  const insertNewlineShortcut = bindingFor('diff-comment-insert-newline')
  const cursorUpShortcut = bindingFor('diff-comment-cursor-up')
  const submitShortcut = bindingFor('diff-comment-submit')
  const cancelShortcut = bindingFor('diff-comment-cancel')

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
          {mode === 'reply' ? 'Reply to thread' : 'Local comment'}
        </span>
        <span className="min-w-0 truncate text-right text-on-surface-variant text-[0.7rem]">
          Comment on {targetDescription}
        </span>
      </div>
      {mode === 'reply' ? null : (
        <div className="flex flex-wrap items-center gap-1">
          {REVIEW_COMMENT_CATEGORIES.map((option) => {
            const meta = REVIEW_CATEGORY_META[option]
            const active = option === selectedCategory

            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={(): void => updateCategory(option)}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  active
                    ? `bg-surface-container-highest ${meta.chip}`
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {meta.label}
              </button>
            )
          })}
          <span className="ml-auto text-[10px] text-on-surface-variant/70">
            {previousCategoryShortcut} / {nextCategoryShortcut}
          </span>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        aria-keyshortcuts={[
          insertNewlineShortcut,
          cursorUpShortcut,
          submitShortcut,
          cancelShortcut,
        ]
          .map((shortcut) => chordToAriaShortcut(shortcut))
          .join(' ')}
        onChange={(e): void => updateText(e.target.value)}
        onKeyDownCapture={(e): void => {
          let direction: 1 | -1 | null = null

          if (matches(e.nativeEvent, 'diff-comment-category-next')) {
            direction = 1
          } else if (matches(e.nativeEvent, 'diff-comment-category-previous')) {
            direction = -1
          }

          if (direction !== null) {
            e.preventDefault()
            e.stopPropagation()

            if (mode !== 'reply') {
              cycleCategory(direction)
            }

            return
          }

          if (matches(e.nativeEvent, 'diff-comment-insert-newline')) {
            e.preventDefault()
            e.stopPropagation()
            insertTextareaNewline(e.currentTarget, updateText)

            return
          }

          if (matches(e.nativeEvent, 'diff-comment-cursor-up')) {
            e.preventDefault()
            e.stopPropagation()
            moveTextareaCursorVertically(e.currentTarget, -1)

            return
          }

          if (matches(e.nativeEvent, 'diff-comment-submit')) {
            e.preventDefault()
            submit()
          } else if (matches(e.nativeEvent, 'diff-comment-cancel')) {
            e.preventDefault()
            onCancel()
          }
        }}
        rows={3}
        className="resize-none rounded bg-surface-container/60 p-2 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder={
          mode === 'reply' ? 'Reply to the agent…' : 'Request change'
        }
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          aria-keyshortcuts={chordToAriaShortcut(cancelShortcut)}
          onClick={(): void => onCancel()}
          className="rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface"
        >
          Cancel
        </button>
        <button
          type="button"
          aria-keyshortcuts={chordToAriaShortcut(submitShortcut)}
          onClick={(): void => submit()}
          disabled={text.trim().length === 0}
          className="rounded-md bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary/80 disabled:opacity-50"
        >
          {mode === 'reply' ? 'Reply' : 'Comment'}
        </button>
      </div>
    </div>
  )
}
