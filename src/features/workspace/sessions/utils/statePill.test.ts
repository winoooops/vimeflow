import { describe, test, expect } from 'vitest'
import {
  STATE_PILL_LABEL,
  STATE_PILL_TONE,
  STATE_PILL_TONE_DIM,
} from './statePill'

describe('statePill lookups', () => {
  test('all three records cover all four SessionStatus keys', () => {
    const expectedKeys = ['running', 'paused', 'completed', 'errored'] as const
    for (const record of [
      STATE_PILL_LABEL,
      STATE_PILL_TONE,
      STATE_PILL_TONE_DIM,
    ]) {
      expect(Object.keys(record).sort()).toEqual([...expectedKeys].sort())
    }
  })

  test('errored tone preserves higher-saturation Active variant (regression guard for the cycle-5 dim treatment not bleeding into Active)', () => {
    expect(STATE_PILL_TONE.errored).toContain('bg-error/15')
    expect(STATE_PILL_TONE_DIM.errored).toContain('bg-error/8')
  })
})
