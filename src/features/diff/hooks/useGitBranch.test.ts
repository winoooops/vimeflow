import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke, listen } from '../../../lib/backend'
import { useGitBranch } from './useGitBranch'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

describe('useGitBranch', () => {
  const noopUnlisten = (): void => undefined

  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(listen).mockReset()
    vi.mocked(listen).mockResolvedValue(noopUnlisten)
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_branch' ? 'main' : undefined)
    )
  })

  const gitBranchInvokeCount = (): number =>
    vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'git_branch').length

  test('returns idle state for fallback cwd `.`', () => {
    const { result } = renderHook(() => useGitBranch('.'))

    expect(result.current.idle).toBe(true)
    expect(result.current.branch).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })

  test('returns idle state for fallback cwd `~`', () => {
    const { result } = renderHook(() => useGitBranch('~'))

    expect(result.current.idle).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })

  test.each(['', './foo', '../bar', 'session/1'])(
    'returns idle state for relative cwd `%s`',
    (cwd) => {
      const { result } = renderHook(() => useGitBranch(cwd))

      expect(result.current.idle).toBe(true)
      expect(result.current.branch).toBeNull()
      expect(result.current.loading).toBe(false)
      expect(invoke).not.toHaveBeenCalled()
    }
  )

  test('returns idle state when enabled=false', () => {
    const { result } = renderHook(() =>
      useGitBranch('/home/user/repo', { enabled: false })
    )

    expect(result.current.idle).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })

  test('fetches branch via invoke for a valid cwd', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_branch' ? 'feat/jose-auth' : undefined)
    )

    const { result } = renderHook(() => useGitBranch('/home/user/repo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(invoke).toHaveBeenCalledWith('git_branch', {
      cwd: '/home/user/repo',
    })
    expect(result.current.branch).toBe('feat/jose-auth')
    expect(result.current.error).toBeNull()
  })

  test('treats empty string result as null branch', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_branch' ? '' : undefined)
    )

    const { result } = renderHook(() => useGitBranch('/home/user/repo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.branch).toBeNull()
  })

  test('captures error on invoke rejection', async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === 'git_branch') {
        return Promise.reject(new Error('not a repo'))
      }

      return Promise.resolve(undefined)
    })

    const { result } = renderHook(() => useGitBranch('/home/user/repo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.branch).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
  })

  test('refresh re-fetches', async () => {
    const branches = ['main', 'main', 'develop']
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_branch' ? branches.shift() : undefined)
    )

    const { result } = renderHook(() => useGitBranch('/home/user/repo'))

    await waitFor(() => expect(result.current.branch).toBe('main'))
    await waitFor(() =>
      expect(gitBranchInvokeCount()).toBeGreaterThanOrEqual(2)
    )
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.branch).toBe('develop'))
    expect(gitBranchInvokeCount()).toBe(3)
  })

  test('attaches git-head-changed listener before invoking start_git_watcher', async () => {
    const callOrder: string[] = []
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      callOrder.push(`invoke:${cmd}`)

      return Promise.resolve(cmd === 'git_branch' ? 'main' : undefined)
    })

    vi.mocked(listen).mockImplementation(() => {
      callOrder.push('listen')

      return Promise.resolve(noopUnlisten)
    })

    renderHook(() => useGitBranch('/home/test/repo'))

    await waitFor(() => {
      expect(callOrder).toContain('listen')
      expect(callOrder).toContain('invoke:start_git_watcher')
    })

    expect(callOrder.indexOf('listen')).toBeLessThan(
      callOrder.indexOf('invoke:start_git_watcher')
    )
  })

  test('fetches branch again when git-head-changed event includes our cwd', async () => {
    let captured: ((payload: { cwds: string[] }) => void) | null = null
    const branches = ['main', 'main', 'feat/x']
    vi.mocked(listen).mockImplementation((_event, callback) => {
      captured = callback as (payload: { cwds: string[] }) => void

      return Promise.resolve(noopUnlisten)
    })

    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_branch' ? branches.shift() : undefined)
    )

    const { result } = renderHook(() => useGitBranch('/home/test/repo'))

    await waitFor(() => expect(result.current.branch).toBe('main'))
    await waitFor(() =>
      expect(gitBranchInvokeCount()).toBeGreaterThanOrEqual(2)
    )
    act(() => captured?.({ cwds: ['/home/test/repo'] }))
    await waitFor(() => expect(result.current.branch).toBe('feat/x'))
  })

  test('ignores git-head-changed event when cwds do not match', async () => {
    let captured: ((payload: { cwds: string[] }) => void) | null = null
    vi.mocked(listen).mockImplementation((_event, callback) => {
      captured = callback as (payload: { cwds: string[] }) => void

      return Promise.resolve(noopUnlisten)
    })

    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'git_branch' ? 'main' : undefined)
    )

    const { result } = renderHook(() => useGitBranch('/home/test/repo'))

    await waitFor(() => expect(result.current.branch).toBe('main'))
    await waitFor(() =>
      expect(gitBranchInvokeCount()).toBeGreaterThanOrEqual(2)
    )
    vi.mocked(invoke).mockClear()
    act(() => captured?.({ cwds: ['/home/other'] }))

    expect(invoke).not.toHaveBeenCalled()
  })

  test('cleanup removes listener before stopping watcher and waits for start', async () => {
    const order: string[] = []
    vi.mocked(listen).mockImplementation(() => {
      order.push('listen')

      return Promise.resolve((): void => {
        order.push('unlisten')
      })
    })

    let resolveStart: () => void = noopUnlisten

    const startPromise = new Promise<void>((resolve) => {
      resolveStart = resolve
    })

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      order.push(`invoke:${cmd}`)
      if (cmd === 'start_git_watcher') {
        return startPromise
      }
      if (cmd === 'git_branch') {
        return Promise.resolve('main')
      }

      return Promise.resolve(undefined)
    })

    const { unmount } = renderHook(() => useGitBranch('/home/test/repo'))

    await waitFor(() => expect(order).toContain('listen'))
    unmount()
    resolveStart()

    await waitFor(() => expect(order).toContain('invoke:stop_git_watcher'))
    expect(order.indexOf('unlisten')).toBeLessThan(
      order.indexOf('invoke:stop_git_watcher')
    )

    expect(order.indexOf('invoke:start_git_watcher')).toBeLessThan(
      order.indexOf('invoke:stop_git_watcher')
    )
  })
})
