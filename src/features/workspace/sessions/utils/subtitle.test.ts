import { describe, test, expect } from 'vitest'
import { subtitle } from './subtitle'
import type { Session } from '../../types'

const sessionWith = (
  workingDirectory: string,
  currentAction?: string
): Session =>
  ({
    workingDirectory,
    currentAction,
  }) as unknown as Session

describe('subtitle', () => {
  test('non-empty currentAction takes priority over the cwd derivation', () => {
    expect(
      subtitle(sessionWith('/home/will/projects/Vimeflow', 'Editing index.ts'))
    ).toBe('Editing index.ts')
  })

  test('Windows backslash path normalizes to last 2 parent/basename segments', () => {
    expect(subtitle(sessionWith('C:\\Users\\alice\\repo'))).toBe('alice/repo')
  })

  test('POSIX shallow path returns parent/basename', () => {
    expect(subtitle(sessionWith('/home/will'))).toBe('home/will')
  })

  test('empty workingDirectory falls back to "~" (race-window safety)', () => {
    expect(subtitle(sessionWith(''))).toBe('~')
  })

  test('single-segment path returns the segment alone', () => {
    expect(subtitle(sessionWith('/root'))).toBe('root')
  })
})
