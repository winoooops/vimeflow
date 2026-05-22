// cspell:ignore worktree worktrees refetches
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '../../../lib/backend'
import { useGitWorktree } from './useGitWorktree'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
}))

describe('useGitWorktree', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_worktree_name' ? null : undefined)
    )
  })

  const worktreeInvokeCount = (): number =>
    vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'git_worktree_name')
      .length

  test.each(['.', '~', '', './foo', '../bar', 'session/1'])(
    'is idle for non-absolute cwd `%s`',
    (cwd) => {
      const { result } = renderHook(() => useGitWorktree(cwd))

      expect(result.current.worktreeName).toBeNull()
      expect(result.current.loading).toBe(false)
      expect(invoke).not.toHaveBeenCalled()
    }
  )

  test('skips IPC when enabled=false', () => {
    const { result } = renderHook(() =>
      useGitWorktree('/home/user/repo', { enabled: false })
    )

    expect(result.current.worktreeName).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })

  test('resolves worktree name for a linked worktree cwd', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_worktree_name' ? 'agent-sidebar' : undefined)
    )

    const { result } = renderHook(() =>
      useGitWorktree('/home/user/repo/.claude/worktrees/agent-sidebar')
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(invoke).toHaveBeenCalledWith('git_worktree_name', {
      cwd: '/home/user/repo/.claude/worktrees/agent-sidebar',
    })
    expect(result.current.worktreeName).toBe('agent-sidebar')
    expect(result.current.error).toBeNull()
  })

  test('returns null worktree name for main checkout', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_worktree_name' ? null : undefined)
    )

    const { result } = renderHook(() => useGitWorktree('/home/user/repo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.worktreeName).toBeNull()
    expect(result.current.error).toBeNull()
  })

  test('swallows non-repo errors as `null` worktree name', async () => {
    // git_worktree_name errs when cwd is not a git repo. Surface that as
    // "no worktree chip" rather than letting the Header show an error.
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'git_worktree_name') {
        return Promise.reject(new Error('not a git repository'))
      }

      return Promise.resolve(undefined)
    })

    const { result } = renderHook(() => useGitWorktree('/home/user/not-a-repo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.worktreeName).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
  })

  test('refetches when cwd changes', async () => {
    const names: (string | null)[] = ['agent-sidebar', null, 'feat-a']
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_worktree_name' ? names.shift() : undefined)
    )

    const { result, rerender } = renderHook(
      ({ cwd }: { cwd: string }) => useGitWorktree(cwd),
      {
        initialProps: {
          cwd: '/home/user/repo/.claude/worktrees/agent-sidebar',
        },
      }
    )

    await waitFor(() =>
      expect(result.current.worktreeName).toBe('agent-sidebar')
    )

    rerender({ cwd: '/home/user/repo' })

    await waitFor(() => expect(result.current.worktreeName).toBeNull())
    expect(worktreeInvokeCount()).toBe(2)

    rerender({ cwd: '/home/user/repo/.claude/worktrees/feat-a' })
    await waitFor(() => expect(result.current.worktreeName).toBe('feat-a'))
    expect(worktreeInvokeCount()).toBe(3)
  })

  test('ignores stale responses when cwd changes mid-flight', async () => {
    let resolveFirst: ((value: string | null) => void) | undefined

    const firstCwdPromise = new Promise<string | null>((resolve) => {
      resolveFirst = resolve
    })

    vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
      if (cmd !== 'git_worktree_name') {
        return Promise.resolve(undefined)
      }

      const cwd = (args as { cwd: string }).cwd
      if (cwd === '/home/user/repo/.claude/worktrees/old') {
        return firstCwdPromise
      }

      return Promise.resolve('new')
    })

    const { result, rerender } = renderHook(
      ({ cwd }: { cwd: string }) => useGitWorktree(cwd),
      { initialProps: { cwd: '/home/user/repo/.claude/worktrees/old' } }
    )

    rerender({ cwd: '/home/user/repo/.claude/worktrees/new' })

    await waitFor(() => expect(result.current.worktreeName).toBe('new'))

    // Resolve the stale first request AFTER the cwd has moved on.
    resolveFirst?.('old')

    // Wait an extra tick to give a stale setState a chance to land.
    await Promise.resolve()
    await Promise.resolve()

    expect(result.current.worktreeName).toBe('new')
  })
})
