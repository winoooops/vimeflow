import { describe, expect, test } from 'vitest'
import { fuzzyMatch } from './fuzzyMatch'

describe('fuzzyMatch', () => {
  test('returns 0 for empty query', () => {
    expect(fuzzyMatch('', 'target')).toBe(0)
    expect(fuzzyMatch('   ', 'target')).toBe(0)
  })

  test('returns high score for exact match', () => {
    const score = fuzzyMatch('open', 'open')
    expect(score).toBe(1000)
  })

  test('returns high score for prefix match', () => {
    const prefixScore = fuzzyMatch('op', 'open')
    const substringScore = fuzzyMatch('pe', 'open')

    // Prefix match should score higher than substring match
    expect(prefixScore).toBeGreaterThan(substringScore)
    expect(prefixScore).toBeGreaterThan(500)
  })

  test('returns positive score for substring match', () => {
    const score = fuzzyMatch('pen', 'open')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(500) // Less than prefix match
  })

  test('returns 0 for no match', () => {
    const score = fuzzyMatch('xyz', 'open')
    expect(score).toBe(0)
  })

  test('handles special characters correctly', () => {
    const score = fuzzyMatch(':', ':open')
    expect(score).toBeGreaterThan(0)
  })

  test('substring matches earlier in the string score higher', () => {
    const earlyScore = fuzzyMatch('op', 'open')
    const lateScore = fuzzyMatch('en', 'open')

    expect(earlyScore).toBeGreaterThan(lateScore)
  })

  test('character-skip match returns positive score', () => {
    // "op" should match "open" via character skip (o, p)
    const score = fuzzyMatch('on', 'open')
    expect(score).toBeGreaterThan(0)
  })

  test('consecutive character matches score higher', () => {
    // "ope" has 3 consecutive matches
    // "opn" has non-consecutive matches
    const consecutiveScore = fuzzyMatch('ope', 'open')
    const nonConsecutiveScore = fuzzyMatch('opn', 'open')

    expect(consecutiveScore).toBeGreaterThan(nonConsecutiveScore)
  })

  test('score ordering: exact > prefix > substring > char-skip > no match', () => {
    const exactScore = fuzzyMatch('open', 'open')
    const prefixScore = fuzzyMatch('op', 'open')
    const substringScore = fuzzyMatch('pen', 'open')
    const charSkipScore = fuzzyMatch('on', 'open')
    const noMatchScore = fuzzyMatch('xyz', 'open')

    expect(exactScore).toBeGreaterThan(prefixScore)
    expect(prefixScore).toBeGreaterThan(substringScore)
    expect(substringScore).toBeGreaterThan(charSkipScore)
    expect(charSkipScore).toBeGreaterThan(noMatchScore)
    expect(noMatchScore).toBe(0)
  })

  test('case insensitive matching', () => {
    const score1 = fuzzyMatch('OPEN', 'open')
    const score2 = fuzzyMatch('Open', 'OPEN')
    const score3 = fuzzyMatch('open', 'open')

    expect(score1).toBe(score3)
    expect(score2).toBe(score3)
  })

  test('handles whitespace in query', () => {
    const score = fuzzyMatch('  open  ', 'open')
    expect(score).toBe(1000) // Should match exactly after trim
  })
})
