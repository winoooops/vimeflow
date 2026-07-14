import { useRef, type ReactElement } from 'react'
import { Button } from '@/components/Button'
import { Popover } from '@/components/Popover'
import { DiffChipToolbar, type DiffChipToolbarProps } from './toolbar'
import { FinishFeedbackPopover } from './FinishFeedbackPopover'
import {
  RequestReviewPopover,
  type RequestReviewScopeControl,
} from './RequestReviewPopover'
import type { PaneCandidate, ResolveResult } from '../services/activePanePicker'
import {
  isFileAnnotationTarget,
  type AnnotationTarget,
} from '../hooks/useReviewCommentDraft'

interface FinishFeedbackState {
  open: boolean
  result: ResolveResult
  commentCount: number
  fileCount: number
  onCancel: () => void
  onSend: (pane: PaneCandidate) => void
  onCopy?: () => void
}

interface RequestReviewState {
  open: boolean
  result: ResolveResult
  scopeLabel: string
  scopeControl?: RequestReviewScopeControl
  onSubmit: (pane: PaneCandidate) => void
  onCopy: () => void
  onCancel: () => void
}

export interface KeyboardConfirmView {
  title: string
  body: string
  variant: 'primary' | 'danger'
}

interface DraftRecovery {
  target: AnnotationTarget
  text: string
}

interface NotifierProps {
  toolbarProps: DiffChipToolbarProps
  finishFeedback: FinishFeedbackState
  requestReview?: RequestReviewState
  keyboardConfirm: KeyboardConfirmView | null
  renderSyncError?: string | null
  notifyMessage?: string | null
  recoverableDraft?: DraftRecovery | null
  onCancelKeyboardConfirm: () => void
  onConfirmKeyboardAction: () => void
}

export const Notifier = ({
  toolbarProps,
  finishFeedback,
  requestReview = undefined,
  keyboardConfirm,
  renderSyncError = null,
  notifyMessage = null,
  recoverableDraft = null,
  onCancelKeyboardConfirm,
  onConfirmKeyboardAction,
}: NotifierProps): ReactElement => {
  const toolbarShellRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={toolbarShellRef}
      data-testid="diff-toolbar-shell"
      className="shrink-0"
    >
      <DiffChipToolbar {...toolbarProps} />
      {renderSyncError !== null ? (
        <div
          role="alert"
          className="px-3 pb-2 text-[11px] leading-4 text-vcs-deleted"
        >
          Diff render sync failed: {renderSyncError}
        </div>
      ) : null}
      {notifyMessage !== null ? (
        <div
          role="status"
          aria-live="polite"
          className="px-3 pb-2 text-[11px] leading-4 text-on-surface-variant"
        >
          {notifyMessage}
        </div>
      ) : null}
      {recoverableDraft !== null ? (
        <div
          role="status"
          data-testid="diff-draft-recovery"
          className="mx-3 mb-2 rounded-md bg-surface-container-high/70 px-3 py-2 text-[11px] leading-4 text-on-surface-variant"
        >
          Draft preserved for{' '}
          {isFileAnnotationTarget(recoverableDraft.target)
            ? `file ${recoverableDraft.target.filePath}`
            : `line ${
                recoverableDraft.target.side === 'deletions' ? 'L' : 'R'
              }${recoverableDraft.target.lineNumber}`}
          :{' '}
          <span className="font-medium text-on-surface">
            {recoverableDraft.text}
          </span>
        </div>
      ) : null}
      {finishFeedback.open && toolbarShellRef.current !== null ? (
        <FinishFeedbackPopover
          anchor={toolbarShellRef.current}
          result={finishFeedback.result}
          commentCount={finishFeedback.commentCount}
          fileCount={finishFeedback.fileCount}
          onCancel={finishFeedback.onCancel}
          onSend={finishFeedback.onSend}
          onCopy={finishFeedback.onCopy}
        />
      ) : null}
      {requestReview !== undefined &&
      requestReview.open &&
      toolbarShellRef.current !== null ? (
        <RequestReviewPopover
          anchor={toolbarShellRef.current}
          result={requestReview.result}
          scopeLabel={requestReview.scopeLabel}
          scopeControl={requestReview.scopeControl}
          onSubmit={requestReview.onSubmit}
          onCopy={requestReview.onCopy}
          onCancel={requestReview.onCancel}
        />
      ) : null}
      {keyboardConfirm !== null && toolbarShellRef.current !== null ? (
        <Popover
          anchor={toolbarShellRef.current}
          open
          onOpenChange={(open): void => {
            if (!open) {
              onCancelKeyboardConfirm()
            }
          }}
          placement="bottom-end"
          width={320}
          aria-label={keyboardConfirm.title}
        >
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium text-on-surface">
                {keyboardConfirm.title}
              </h2>
              <p className="text-xs leading-5 text-on-surface-variant">
                {keyboardConfirm.body}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                aria-keyshortcuts="n"
                onClick={onCancelKeyboardConfirm}
              >
                No (n)
              </Button>
              <Button
                size="sm"
                variant={keyboardConfirm.variant}
                aria-keyshortcuts="y"
                onClick={onConfirmKeyboardAction}
              >
                Yes (y)
              </Button>
            </div>
          </div>
        </Popover>
      ) : null}
    </div>
  )
}
