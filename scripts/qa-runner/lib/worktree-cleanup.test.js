import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanupQaWorktrees, qaPrFromWorktreeName } from './worktree-cleanup.js'

let tmp

const repoFixture = () => {
  tmp = mkdtempSync(join(tmpdir(), 'qa-worktree-cleanup-'))
  mkdirSync(join(tmp, '.claude', 'worktrees'), { recursive: true })
  mkdirSync(join(tmp, '.git', 'worktrees'), { recursive: true })
  mkdirSync(join(tmp, 'scripts', 'qa-runner', '.locks'), { recursive: true })

  return tmp
}

afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true })
    tmp = null
  }
})

describe('qaPrFromWorktreeName', () => {
  test('parses QA PR worktree names only', () => {
    expect(qaPrFromWorktreeName('qa-pr-456')).toBe(456)
    expect(qaPrFromWorktreeName('/repo/.claude/worktrees/qa-pr-456')).toBe(456)
    expect(qaPrFromWorktreeName('qa-pr-x')).toBeNull()
    expect(qaPrFromWorktreeName('feature-dev')).toBeNull()
  })
})

describe('cleanupQaWorktrees', () => {
  test('removes inactive QA worktrees, git metadata, and stale locks', () => {
    const repoRoot = repoFixture()
    const log = vi.fn()
    mkdirSync(join(repoRoot, '.claude', 'worktrees', 'qa-pr-42'), {
      recursive: true,
    })

    mkdirSync(join(repoRoot, '.git', 'worktrees', 'qa-pr-42'), {
      recursive: true,
    })

    writeFileSync(
      join(repoRoot, 'scripts', 'qa-runner', '.locks', 'pr-42.lock'),
      'pid 999999\n'
    )

    const summary = cleanupQaWorktrees({
      repoRoot,
      log,
      deps: {
        kill: () => {
          const error = new Error('missing')
          error.code = 'ESRCH'
          throw error
        },
      },
    })

    expect(summary).toEqual({
      worktreesRemoved: 1,
      metadataRemoved: 1,
      locksRemoved: 1,
      skippedActive: 0,
    })

    expect(existsSync(join(repoRoot, '.claude', 'worktrees', 'qa-pr-42'))).toBe(
      false
    )

    expect(existsSync(join(repoRoot, '.git', 'worktrees', 'qa-pr-42'))).toBe(
      false
    )

    expect(
      existsSync(join(repoRoot, 'scripts', 'qa-runner', '.locks', 'pr-42.lock'))
    ).toBe(false)

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('removed 1 worktree')
    )
  })

  test('keeps active QA worktrees while their runner lock is alive', () => {
    const repoRoot = repoFixture()
    mkdirSync(join(repoRoot, '.claude', 'worktrees', 'qa-pr-43'), {
      recursive: true,
    })

    mkdirSync(join(repoRoot, '.git', 'worktrees', 'qa-pr-43'), {
      recursive: true,
    })

    writeFileSync(
      join(repoRoot, 'scripts', 'qa-runner', '.locks', 'pr-43.lock'),
      'pid 43\n'
    )

    const summary = cleanupQaWorktrees({
      repoRoot,
      deps: {
        kill: vi.fn(),
        readFile: (path, encoding) =>
          path === '/proc/43/cmdline'
            ? 'node\0scripts/qa-runner/run.js'
            : readFileSync(path, encoding),
      },
    })

    expect(summary).toEqual({
      worktreesRemoved: 0,
      metadataRemoved: 0,
      locksRemoved: 0,
      skippedActive: 1,
    })

    expect(existsSync(join(repoRoot, '.claude', 'worktrees', 'qa-pr-43'))).toBe(
      true
    )

    expect(existsSync(join(repoRoot, '.git', 'worktrees', 'qa-pr-43'))).toBe(
      true
    )
  })
})
