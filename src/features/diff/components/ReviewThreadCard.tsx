import { useEffect, useState, type ReactElement } from 'react'
import type { DiffLineAnnotation } from '@pierre/diffs'
import {
  reviewCommentCategory,
  type ReviewComment,
} from '../hooks/useFeedbackBatch'
import { AGENT_OUTCOME_META, REVIEW_CATEGORY_META } from '../reviewCategoryMeta'
import { isFollowUpComment } from '../services/feedbackDispatch'
import type { ThreadGroup } from '../services/threadGroups'
import { formatSentAgo } from './ReviewCommentRow'
import { ReviewCommentEditor } from './ReviewCommentEditor'

export interface ReviewThreadCardActions {
  /** True while this thread's reply editor is open (Panel-owned draft state). */
  replying: boolean
  replyDraft: string
  onStartReply: () => void
  onReplyDraftChange: (text: string) => void
  onSubmitReply: (text: string) => void
  onCancelReply: () => void
  onResolve: () => void
  onReopen: () => void
}

interface ReviewThreadCardProps {
  group: ThreadGroup
  anchorLabel: string
  /** Omitted → footer-less card (no dispatch capability in this context). */
  actions?: ReviewThreadCardActions
}

const HAIRLINE = {
  borderTop:
    '1px solid color-mix(in srgb, var(--color-on-surface) 12%, transparent)',
} as const

const Chip = ({
  label,
  className,
}: {
  label: string
  className: string
}): ReactElement => (
  <span
    className={`inline-flex items-center rounded bg-surface-container-highest/70 px-1.5 py-px text-[10px] font-medium ${className}`}
  >
    {label}
  </span>
)

const turnChip = (comment: ReviewComment): ReactElement | null => {
  if (comment.author === 'agent') {
    return comment.outcome === undefined ? (
      <Chip label="Agent reply" className="text-success" />
    ) : (
      <Chip
        label={AGENT_OUTCOME_META[comment.outcome].label}
        className={AGENT_OUTCOME_META[comment.outcome].chip}
      />
    )
  }

  // Follow-ups with no category carry no chip; categorized user/reviewer turns
  // show their raise intent (VIM-298 taxonomy).
  if (comment.author === 'self' && isFollowUpComment(comment)) {
    return null
  }

  const meta = REVIEW_CATEGORY_META[reviewCommentCategory(comment)]

  return <Chip label={meta.label} className={meta.chip} />
}

const turnIdentity = (
  comment: ReviewComment
): { avatarClass: string; initial: string; name: string } => {
  if (comment.author === 'agent') {
    return {
      avatarClass: 'bg-primary-container/60 text-primary',
      initial: 'A',
      name: 'Agent',
    }
  }

  if (comment.author === 'reviewer') {
    const name = comment.reviewer ?? 'Reviewer'

    return {
      avatarClass: 'bg-surface-container-highest text-on-surface-variant',
      initial: name.charAt(0).toUpperCase(),
      name,
    }
  }

  return {
    avatarClass: 'bg-surface-container-highest text-on-surface-variant',
    initial: 'Y',
    name: 'You',
  }
}

const TurnRow = ({
  turn,
  first,
}: {
  turn: DiffLineAnnotation<ReviewComment>
  first: boolean
}): ReactElement => {
  const comment = turn.metadata
  const identity = turnIdentity(comment)

  const timestamp =
    comment.author === 'self' && comment.dispatchedAt !== undefined
      ? `Sent ${formatSentAgo(comment.dispatchedAt, Date.now())}`
      : formatSentAgo(comment.createdAt, Date.now())

  return (
    <div className="px-4 py-2.5" style={first ? undefined : HAIRLINE}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${identity.avatarClass}`}
        >
          {identity.initial}
        </span>
        <span className="text-[11px] font-medium text-on-surface">
          {identity.name}
        </span>
        {turnChip(comment)}
        <span className="text-[10px] text-on-surface-variant">{timestamp}</span>
      </div>
      <p className="whitespace-pre-wrap break-words pl-[22px] text-xs leading-5 text-on-surface">
        {comment.text}
      </p>
    </div>
  )
}

/**
 * A multi-turn review conversation (VIM-298) — the GitHub-style card settled
 * in the demo-first pass: tonal container, header with anchor + rollup + turn
 * count, hairline-divided turns, paired Reply/Resolve footer. Resolved threads
 * collapse to the header behind an accessible disclosure.
 */
export const ReviewThreadCard = ({
  group,
  anchorLabel,
  actions = undefined,
}: ReviewThreadCardProps): ReactElement => {
  const [expandedWhileResolved, setExpandedWhileResolved] = useState(false)

  // Reset the read-only expansion whenever the thread reopens, so the NEXT
  // resolve collapses again (expand → Reopen → Resolve must not stay open).
  useEffect((): void => {
    if (!group.resolved) {
      setExpandedWhileResolved(false)
    }
  }, [group.resolved])

  const collapsed = group.resolved && !expandedWhileResolved
  const expanded = !collapsed

  const header = (
    <>
      <span className="font-mono">{anchorLabel}</span>
      <Chip label={group.rollup.label} className={group.rollup.chip} />
      <span>
        {group.turns.length} turn{group.turns.length === 1 ? '' : 's'}
      </span>
    </>
  )

  return (
    <div className="mx-3 my-2 shrink-0 overflow-hidden rounded-lg bg-surface-container-high/80">
      {group.resolved ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Resolved thread on ${anchorLabel}, ${group.turns.length} turn${group.turns.length === 1 ? '' : 's'}`}
          onClick={(): void => setExpandedWhileResolved(!expandedWhileResolved)}
          className="flex w-full items-center gap-2 px-4 py-2 text-left text-[10px] text-on-surface-variant"
          style={{
            background:
              'color-mix(in srgb, var(--color-on-surface) 4%, transparent)',
          }}
        >
          {header}
          <span
            aria-hidden="true"
            className="material-symbols-outlined ml-auto text-sm leading-none"
          >
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        </button>
      ) : (
        <div
          className="flex items-center gap-2 px-4 py-2 text-[10px] text-on-surface-variant"
          style={{
            background:
              'color-mix(in srgb, var(--color-on-surface) 4%, transparent)',
          }}
        >
          {header}
        </div>
      )}

      {expanded
        ? group.turns.map((turn, index) => (
            <TurnRow key={turn.metadata.id} turn={turn} first={index === 0} />
          ))
        : null}

      {expanded && actions !== undefined ? (
        <div style={HAIRLINE}>
          {actions.replying ? (
            <div className="px-2 py-1.5">
              <ReviewCommentEditor
                mode="reply"
                chrome="plain"
                surfaceRole="none"
                targetLabel={anchorLabel}
                value={actions.replyDraft}
                onTextChange={actions.onReplyDraftChange}
                onConfirm={(text): void => actions.onSubmitReply(text)}
                onCancel={actions.onCancelReply}
              />
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2 px-4 py-2">
              <button
                type="button"
                onClick={actions.onStartReply}
                className="rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-surface-container-highest/60"
                style={{
                  background:
                    'color-mix(in srgb, var(--color-primary) 12%, transparent)',
                }}
              >
                <span aria-hidden="true">↳ </span>Reply
              </button>
              {group.resolved ? (
                <button
                  type="button"
                  onClick={actions.onReopen}
                  className="rounded-md px-3 py-1.5 text-[11px] font-medium text-on-surface-variant hover:bg-surface-container-highest/60 hover:text-on-surface"
                  style={{
                    background:
                      'color-mix(in srgb, var(--color-on-surface) 6%, transparent)',
                  }}
                >
                  <span aria-hidden="true">⟲ </span>Reopen
                </button>
              ) : (
                <button
                  type="button"
                  onClick={actions.onResolve}
                  className="rounded-md px-3 py-1.5 text-[11px] font-medium text-on-surface-variant hover:bg-surface-container-highest/60 hover:text-on-surface"
                  style={{
                    background:
                      'color-mix(in srgb, var(--color-on-surface) 6%, transparent)',
                  }}
                >
                  <span aria-hidden="true">✓ </span>Resolve
                </button>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
