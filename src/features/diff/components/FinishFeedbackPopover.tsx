import { type ReactElement } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import type { PaneCandidate, ResolveResult } from '../services/activePanePicker'

interface FinishFeedbackPopoverProps {
  anchor: HTMLElement
  result: ResolveResult
  commentCount: number
  fileCount: number
  onSend: (pane: PaneCandidate) => void
  onCancel: () => void
}

export const FinishFeedbackPopover = ({
  anchor,
  result,
  commentCount,
  fileCount,
  onSend,
  onCancel,
}: FinishFeedbackPopoverProps): ReactElement => {
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open): void => {
      if (!open) {
        onCancel()
      }
    },
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    elements: { reference: anchor },
  })

  const dismiss = useDismiss(context, { ancestorScroll: true })
  const role = useRole(context, { role: 'dialog' })
  const { getFloatingProps } = useInteractions([dismiss, role])

  const commentWord = commentCount === 1 ? 'comment' : 'comments'
  const fileWord = fileCount === 1 ? 'file' : 'files'

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="z-50 flex w-[320px] flex-col gap-3 rounded-lg border border-outline-variant/20 bg-surface-container-high/95 p-4 shadow-xl backdrop-blur-md"
        aria-label="Finish feedback"
        {...getFloatingProps()}
      >
        {result.kind === 'none' && (
          <div className="flex flex-col gap-3">
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
            <div className="flex justify-end">
              <button
                type="button"
                onClick={(): void => onCancel()}
                className="rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {result.kind === 'one' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-on-surface">
              Send {commentCount} {commentWord} across {fileCount} {fileWord} to{' '}
              {result.pane.tabName} ({result.pane.agentLabel})?
            </p>
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
                onClick={(): void => onSend(result.pane)}
                className="rounded-md bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary/80"
              >
                Confirm
              </button>
            </div>
          </div>
        )}

        {result.kind === 'many' && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-on-surface">
              Multiple agents in this workspace. Pick one:
            </h2>
            <div className="flex flex-col gap-2">
              {result.candidates.map((pane) => (
                <div
                  key={pane.paneId}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-sm text-on-surface">
                    {pane.tabName} ({pane.agentLabel})
                  </span>
                  <button
                    type="button"
                    onClick={(): void => onSend(pane)}
                    className="rounded-md bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary/80"
                  >
                    Send
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={(): void => onCancel()}
                className="rounded-md px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </FloatingPortal>
  )
}
