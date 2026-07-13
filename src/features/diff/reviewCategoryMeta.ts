import type { AgentReplyStatus } from '@/bindings'
import type { ReviewCommentCategory } from './hooks/useFeedbackBatch'

/**
 * The UI face of each comment category (VIM-256): a short chip `label` (the
 * fuller agent-facing label lives in feedbackDispatch) and a literal Tailwind
 * `chip` text-color class — literal so Tailwind's content scan emits it.
 */
export const REVIEW_CATEGORY_META: Record<
  ReviewCommentCategory,
  { label: string; chip: string }
> = {
  question: { label: 'Question', chip: 'text-primary' },
  change: { label: 'Change', chip: 'text-tertiary' },
  bug: { label: 'Bug', chip: 'text-error' },
  suggestion: { label: 'Suggestion', chip: 'text-secondary' },
}

/**
 * The UI face of an agent turn's outcome (VIM-304 PR-3) — the state chip on an
 * `author: 'agent'` row. `clarify` reads as "Awaiting you": the thread is
 * waiting on the user. A thread's rollup derives from its latest agent turn.
 */
export const AGENT_OUTCOME_META: Record<
  AgentReplyStatus,
  { label: string; chip: string }
> = {
  reply: { label: 'Replied', chip: 'text-success' },
  clarify: { label: 'Awaiting you', chip: 'text-primary' },
  resolved: { label: 'Resolved', chip: 'text-success' },
  deferred: { label: 'Deferred', chip: 'text-secondary' },
  rejected: { label: 'Rejected', chip: 'text-error' },
}

/**
 * Chip metas for thread rollup states that no single agent turn carries
 * (VIM-298): Sent = latest turn is a dispatched user turn (awaiting the
 * agent); Open = a reviewer finding with no agent turn yet; Resolved =
 * the user resolved the thread locally (reuses the outcome meta).
 */
export const THREAD_ROLLUP_META = {
  sent: { label: 'Sent', chip: 'text-primary' },
  open: { label: 'Open', chip: 'text-on-surface-variant' },
  resolved: AGENT_OUTCOME_META.resolved,
} as const
