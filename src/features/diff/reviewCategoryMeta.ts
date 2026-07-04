import type { ReviewCommentCategory } from './hooks/useFeedbackBatch'

export interface ReviewCategoryMeta {
  /** Short chip label (the fuller agent-facing label lives in feedbackDispatch). */
  label: string
  /** Literal Tailwind text-color class for the chip — the category's accent. */
  chip: string
}

/**
 * The UI face of each comment category (VIM-256). The `chip` classes are literal
 * so Tailwind's content scan emits them; keep them as complete class strings.
 */
export const REVIEW_CATEGORY_META: Record<
  ReviewCommentCategory,
  ReviewCategoryMeta
> = {
  question: { label: 'Question', chip: 'text-primary' },
  change: { label: 'Change', chip: 'text-tertiary' },
  bug: { label: 'Bug', chip: 'text-error' },
  suggestion: { label: 'Suggestion', chip: 'text-secondary' },
}
