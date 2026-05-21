import { describe, test, expect } from 'vitest'
import { subtitle } from './subtitle'
import type { Session } from '../types'

// cspell:ignore worktrees

const sessionWith = (
  workingDirectory: string,
  currentAction?: string,
  activePaneCwd = workingDirectory
): Session =>
  ({
    workingDirectory,
    currentAction,
    panes: [
      {
        id: 'p0',
        ptyId: 'pty-0',
        cwd: activePaneCwd,
        agentType: 'generic',
        status: 'running',
        active: true,
      },
    ],
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

  test('uses active pane cwd instead of the session baseline cwd', () => {
    expect(
      subtitle(
        sessionWith('/repo', undefined, '/repo/.claude/worktrees/agent-feature')
      )
    ).toBe('worktrees/agent-feature')
  })

  test('empty workingDirectory falls back to "~" (race-window safety)', () => {
    expect(subtitle(sessionWith(''))).toBe('~')
  })

  test('single-segment path returns the segment alone', () => {
    expect(subtitle(sessionWith('/root'))).toBe('root')
  })
})
