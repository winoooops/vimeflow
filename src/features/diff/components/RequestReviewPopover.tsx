import { useEffect, type ReactElement } from 'react'
import { Popover } from '@/components/Popover'
import type { PaneCandidate, ResolveResult } from '../services/activePanePicker'

const popoverGhostActionFocusClass =
  'ring-0 focus:outline-none focus-visible:bg-surface-container-high focus-visible:text-on-surface focus-visible:outline-none focus-visible:ring-0'

const popoverPrimaryActionFocusClass =
  'ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container'

interface RequestReviewPopoverProps {
  anchor: HTMLElement
  result: ResolveResult
  /** What's being reviewed, e.g. "src/auth.ts (unstaged)". */
  scopeLabel: string
  /** Delegate the review to a specific agent pane (arms with session gating). */
  onSubmit: (pane: PaneCandidate) => void
  /** Copy the review-request prompt to the clipboard (you paste it; nonce-only). */
  onCopy: () => void
  onCancel: () => void
}

const isCapitalY = (event: KeyboardEvent): boolean =>
  event.key === 'Y' ||
  (event.shiftKey && (event.key.toLowerCase() === 'y' || event.code === 'KeyY'))

/**
 * The popover that opens from the diff toolbar's "Request review" button. It
 * asks how to hand the current file's diff to a coding agent:
 *  - Delegate — send the review straight to the single bound agent (shown only
 *    when exactly one agent is the clear target).
 *  - Copy — copy the request text to paste into whichever agent you want; this
 *    is the fallback whenever there isn't one obvious agent to delegate to.
 *  - Cancel / Dismiss.
 *
 * It only fires the matching callback; building the request and sending it lives
 * in the Panel / useRequestReview layer, so this component stays a dumb chooser.
 */
export const RequestReviewPopover = ({
  anchor,
  result,
  scopeLabel,
  onSubmit,
  onCopy,
  onCancel,
}: RequestReviewPopoverProps): ReactElement => {
  const copyButton = (
    <button
      type="button"
      aria-keyshortcuts="c"
      onClick={(): void => onCopy()}
      className={`rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface ${popoverGhostActionFocusClass}`}
    >
      Copy (c)
    </button>
  )

  useEffect((): (() => void) => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return
      }

      if (event.key === 'n') {
        event.preventDefault()
        event.stopPropagation()
        onCancel()

        return
      }

      if (event.key === 'c') {
        event.preventDefault()
        event.stopPropagation()
        onCopy()

        return
      }

      if (isCapitalY(event) && result.kind === 'one') {
        event.preventDefault()
        event.stopPropagation()
        onSubmit(result.pane)
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [onCancel, onCopy, onSubmit, result])

  return (
    <Popover
      anchor={anchor}
      open
      onOpenChange={(open): void => {
        if (!open) {
          onCancel()
        }
      }}
      aria-label="Request review"
      width={340}
    >
      {result.kind !== 'one' && (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-on-surface">
            Copy the review request and paste it into the coding agent you want
            to review {scopeLabel}.
          </p>
          <div className="flex justify-end gap-2">
            {copyButton}
            <button
              type="button"
              aria-keyshortcuts="n"
              onClick={(): void => onCancel()}
              className={`rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface ${popoverGhostActionFocusClass}`}
            >
              Dismiss (n)
            </button>
          </div>
        </div>
      )}

      {result.kind === 'one' && (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-on-surface">
            Delegate a code review of {scopeLabel} to {result.pane.tabName} (
            {result.pane.agentLabel})?
          </p>
          <div className="flex justify-end gap-2">
            {copyButton}
            <button
              type="button"
              aria-keyshortcuts="n"
              onClick={(): void => onCancel()}
              className={`rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface ${popoverGhostActionFocusClass}`}
            >
              Cancel (n)
            </button>
            <button
              type="button"
              aria-keyshortcuts="Y"
              onClick={(): void => onSubmit(result.pane)}
              className={`rounded-md bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary/80 ${popoverPrimaryActionFocusClass}`}
            >
              Delegate (Y)
            </button>
          </div>
        </div>
      )}
    </Popover>
  )
}
