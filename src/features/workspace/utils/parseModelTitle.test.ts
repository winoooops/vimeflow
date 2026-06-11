import { describe, test, expect } from 'vitest'
import { parseModelTitle } from './parseModelTitle'

describe('parseModelTitle', () => {
  test('splits a trailing "(<size> context)" suffix into name + context label', () => {
    expect(parseModelTitle('Opus 4.8 (1M context)')).toEqual({
      name: 'Opus 4.8',
      contextLabel: '1M',
    })
  })

  test('handles a kilobyte-scale context window', () => {
    expect(parseModelTitle('Sonnet 4.6 (200K context)')).toEqual({
      name: 'Sonnet 4.6',
      contextLabel: '200K',
    })
  })

  test('returns the title unchanged when there is no context suffix', () => {
    expect(parseModelTitle('claude-sonnet-4-6')).toEqual({
      name: 'claude-sonnet-4-6',
      contextLabel: null,
    })
  })

  test('leaves a non-context parenthetical attached to the name', () => {
    expect(parseModelTitle('Some Model (beta)')).toEqual({
      name: 'Some Model (beta)',
      contextLabel: null,
    })
  })

  test('does not treat a placeholder/session-name fallback as a model', () => {
    expect(parseModelTitle('No session')).toEqual({
      name: 'No session',
      contextLabel: null,
    })
  })

  test('matches the "context" suffix case-insensitively and trims spacing', () => {
    expect(parseModelTitle('Opus 4.8  (1M Context)')).toEqual({
      name: 'Opus 4.8',
      contextLabel: '1M',
    })
  })
})
