import { describe, expect, test } from 'vitest'
import { REVIEW_CATEGORY_META } from './reviewCategoryMeta'
import { REVIEW_COMMENT_CATEGORIES } from './hooks/useFeedbackBatch'

describe('REVIEW_CATEGORY_META', () => {
  test('covers every category with a label and a chip color class', () => {
    for (const category of REVIEW_COMMENT_CATEGORIES) {
      const meta = REVIEW_CATEGORY_META[category]
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.chip).toMatch(/^text-/)
    }
  })
})
