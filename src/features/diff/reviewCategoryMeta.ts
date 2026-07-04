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
