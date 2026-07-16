import { useEffect, type ReactElement } from 'react'
import { Popover } from '@/components/Popover'
import { SegmentedControl } from '@/components/SegmentedControl'
import {
  chordToAriaShortcut,
  chordToShortcutInput,
} from '@/features/keymap/displayKey'
import { useKeybindings } from '@/features/keymap/useKeybindings'
import { formatShortcut } from '@/lib/formatShortcut'
import type { PaneCandidate, ResolveResult } from '../services/activePanePicker'
import type { ReviewScope } from '../hooks/useRequestReview'

const popoverGhostActionFocusClass =
  'ring-0 focus:outline-none focus-visible:bg-surface-container-high focus-visible:text-on-surface focus-visible:outline-none focus-visible:ring-0'

const popoverPrimaryActionFocusClass =
  'ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container'

export interface RequestReviewScopeControl {
  scope: ReviewScope
  changeCount: number
  /** True when no active diff exists — the file option is unavailable. */
  fileDisabled: boolean
  /** True on a transient empty strip — the changelist option is unavailable. */
  changelistDisabled: boolean
  onScopeChange: (scope: ReviewScope) => void
}

interface RequestReviewPopoverProps {
  anchor: HTMLElement
  result: ResolveResult
  /** What's being reviewed, e.g. "src/auth.ts (unstaged)". */
  scopeLabel: string
  /** Scope choice (spec §5); undefined hides the control (degenerate case). */
  scopeControl?: RequestReviewScopeControl
  /** Delegate the review to a specific agent pane (arms with session gating). */
  onSubmit: (pane: PaneCandidate) => void
  /** Copy the review-request prompt to the clipboard (you paste it; nonce-only). */
  onCopy: () => void
  onCancel: () => void
}

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
  scopeControl = undefined,
  onSubmit,
  onCopy,
  onCancel,
}: RequestReviewPopoverProps): ReactElement => {
  const { bindingFor, matches } = useKeybindings()
  const copyShortcut = bindingFor('diff-review-copy')
  const cancelShortcut = bindingFor('diff-confirm-cancel')
  const submitShortcut = bindingFor('diff-request-review-submit')
  const copyLabel = formatShortcut(chordToShortcutInput(copyShortcut))
  const cancelLabel = formatShortcut(chordToShortcutInput(cancelShortcut))
  const submitLabel = formatShortcut(chordToShortcutInput(submitShortcut))

  const copyButton = (
    <button
      type="button"
      aria-keyshortcuts={chordToAriaShortcut(copyShortcut)}
      onClick={(): void => onCopy()}
      className={`rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface ${popoverGhostActionFocusClass}`}
    >
      Copy ({copyLabel})
    </button>
  )

  useEffect((): (() => void) => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (matches(event, 'diff-confirm-cancel')) {
        event.preventDefault()
        event.stopPropagation()
        onCancel()

        return
      }

      if (matches(event, 'diff-review-copy')) {
        event.preventDefault()
        event.stopPropagation()
        onCopy()

        return
      }

      if (
        matches(event, 'diff-request-review-scope-file') &&
        scopeControl !== undefined &&
        !scopeControl.fileDisabled
      ) {
        event.preventDefault()
        event.stopPropagation()
        scopeControl.onScopeChange('file')

        return
      }

      if (
        matches(event, 'diff-request-review-scope-changelist') &&
        scopeControl !== undefined &&
        !scopeControl.changelistDisabled
      ) {
        event.preventDefault()
        event.stopPropagation()
        scopeControl.onScopeChange('changelist')

        return
      }

      if (
        matches(event, 'diff-request-review-submit') &&
        result.kind === 'one'
      ) {
        event.preventDefault()
        event.stopPropagation()
        onSubmit(result.pane)
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [matches, onCancel, onCopy, onSubmit, result, scopeControl])

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
      {scopeControl !== undefined && (
        <div className="flex items-center gap-2 px-4 pt-3">
          <span className="text-xs text-on-surface-variant">Scope</span>
          <SegmentedControl<ReviewScope>
            aria-label="Review scope"
            value={scopeControl.scope}
            onChange={scopeControl.onScopeChange}
            options={[
              {
                value: 'file',
                label: 'This file',
                disabled: scopeControl.fileDisabled,
                ariaLabel: 'This file',
                ...(scopeControl.fileDisabled
                  ? { tooltip: 'No diff loaded' }
                  : undefined),
              },
              {
                value: 'changelist',
                label: `All changes (${scopeControl.changeCount})`,
                disabled: scopeControl.changelistDisabled,
                ariaLabel: 'All changes',
                ...(scopeControl.changelistDisabled
                  ? { tooltip: 'No changed files' }
                  : undefined),
              },
            ]}
          />
        </div>
      )}
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
            Delegate a code review of {scopeLabel} to {result.pane.tabName} (
            {result.pane.agentLabel})?
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
              aria-keyshortcuts={chordToAriaShortcut(submitShortcut)}
              onClick={(): void => onSubmit(result.pane)}
              className={`rounded-md bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary/80 ${popoverPrimaryActionFocusClass}`}
            >
              Delegate ({submitLabel})
            </button>
          </div>
        </div>
      )}
    </Popover>
  )
}
