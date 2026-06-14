import { type ReactElement } from 'react'
import { Popover } from '@/components/Popover'
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
  const commentWord = commentCount === 1 ? 'comment' : 'comments'
  const fileWord = fileCount === 1 ? 'file' : 'files'

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
        <div className="flex flex-col gap-3 p-4">
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
    </Popover>
  )
}
