import { useEffect, type ReactElement } from 'react'
import { Popover } from '@/components/Popover'
import {
  chordToAriaShortcut,
  chordToShortcutInput,
} from '@/features/keymap/displayKey'
import { useKeybindings } from '@/features/keymap/useKeybindings'
import { formatShortcut } from '@/lib/formatShortcut'
import type { PaneCandidate, ResolveResult } from '../services/activePanePicker'

const popoverGhostActionFocusClass =
  'ring-0 focus:outline-none focus-visible:bg-surface-container-high focus-visible:text-on-surface focus-visible:outline-none focus-visible:ring-0'

const popoverPrimaryActionFocusClass =
  'ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container'

interface FinishFeedbackPopoverProps {
  anchor: HTMLElement
  result: ResolveResult
  commentCount: number
  fileCount: number
  onSend: (pane: PaneCandidate) => void
  onCancel: () => void
  /** Copy the whole review to the clipboard — the fallback when no agent is
   * running to send to. Omitted → the copy action is hidden. */
  onCopy?: () => void
}

export const FinishFeedbackPopover = ({
  anchor,
  result,
  commentCount,
  fileCount,
  onSend,
  onCancel,
  onCopy = undefined,
}: FinishFeedbackPopoverProps): ReactElement => {
  const { bindingFor, matches } = useKeybindings()
  const commentWord = commentCount === 1 ? 'comment' : 'comments'
  const fileWord = fileCount === 1 ? 'file' : 'files'
  const copyShortcut = bindingFor('diff-review-copy')
  const cancelShortcut = bindingFor('diff-confirm-cancel')
  const sendShortcut = bindingFor('diff-feedback-send')
  const copyLabel = formatShortcut(chordToShortcutInput(copyShortcut))
  const cancelLabel = formatShortcut(chordToShortcutInput(cancelShortcut))
  const sendLabel = formatShortcut(chordToShortcutInput(sendShortcut))

  const copyButton = onCopy ? (
    <button
      type="button"
      aria-keyshortcuts={chordToAriaShortcut(copyShortcut)}
      onClick={(): void => onCopy()}
      className={`rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface ${popoverGhostActionFocusClass}`}
    >
      Copy ({copyLabel})
    </button>
  ) : null

  useEffect((): (() => void) => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (matches(event, 'diff-confirm-cancel')) {
        event.preventDefault()
        event.stopPropagation()
        onCancel()

        return
      }

      if (onCopy && matches(event, 'diff-review-copy')) {
        event.preventDefault()
        event.stopPropagation()
        onCopy()

        return
      }

      if (matches(event, 'diff-feedback-send') && result.kind === 'one') {
        event.preventDefault()
        event.stopPropagation()
        onSend(result.pane)
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [matches, onCancel, onCopy, onSend, result])

  return (
    <Popover
      anchor={anchor}
      open
      onOpenChange={(open): void => {
        if (!open) {
          onCancel()
        }
      }}
      aria-label="Finish feedback"
      width={320}
    >
      {result.kind === 'none' && (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-on-surface">
            No coding agent is active in this workspace. Start{' '}
            <code className="rounded bg-surface-container/50 px-1 py-0.5 text-xs font-mono text-on-surface-variant">
              claude
            </code>{' '}
            or{' '}
            <code className="rounded bg-surface-container/50 px-1 py-0.5 text-xs font-mono text-on-surface-variant">
              codex
            </code>{' '}
            in a terminal pane.
          </p>
          <div className="flex justify-end gap-2">
            {copyButton}
            <button
              type="button"
              aria-keyshortcuts={chordToAriaShortcut(cancelShortcut)}
              onClick={(): void => onCancel()}
              className={`rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface ${popoverGhostActionFocusClass}`}
            >
              Dismiss ({cancelLabel})
            </button>
          </div>
        </div>
      )}

      {result.kind === 'one' && (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-on-surface">
            Send {commentCount} {commentWord} across {fileCount} {fileWord} to{' '}
            {result.pane.tabName} ({result.pane.agentLabel})?
          </p>
          <div className="flex justify-end gap-2">
            {copyButton}
            <button
              type="button"
              aria-keyshortcuts={chordToAriaShortcut(cancelShortcut)}
              onClick={(): void => onCancel()}
              className={`rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface ${popoverGhostActionFocusClass}`}
            >
              Cancel ({cancelLabel})
            </button>
            <button
              type="button"
              aria-keyshortcuts={chordToAriaShortcut(sendShortcut)}
              onClick={(): void => onSend(result.pane)}
              className={`rounded-md bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary/80 ${popoverPrimaryActionFocusClass}`}
            >
              Confirm ({sendLabel})
            </button>
          </div>
        </div>
      )}

      {result.kind === 'many' && (
        <div className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-medium text-on-surface">
            Multiple agents in this workspace. Pick one:
          </h2>
          <div className="flex flex-col gap-2">
            {result.candidates.map((pane) => (
              <div
                key={pane.ptyId}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-sm text-on-surface">
                  {pane.tabName} ({pane.agentLabel})
                </span>
                <button
                  type="button"
                  onClick={(): void => onSend(pane)}
                  className={`rounded-md bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary/80 ${popoverPrimaryActionFocusClass}`}
                >
                  Send
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            {copyButton}
            <button
              type="button"
              aria-keyshortcuts={chordToAriaShortcut(cancelShortcut)}
              onClick={(): void => onCancel()}
              className={`rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface ${popoverGhostActionFocusClass}`}
            >
              Cancel ({cancelLabel})
            </button>
          </div>
        </div>
      )}
    </Popover>
  )
}
