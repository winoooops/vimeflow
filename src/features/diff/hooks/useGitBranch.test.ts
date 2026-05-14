import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '../../../lib/backend'
import { useGitBranch } from './useGitBranch'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
}))

describe('useGitBranch', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

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
    vi.mocked(invoke).mockResolvedValueOnce('feat/jose-auth')

    const { result } = renderHook(() => useGitBranch('/home/user/repo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(invoke).toHaveBeenCalledWith('git_branch', {
      cwd: '/home/user/repo',
    })
    expect(result.current.branch).toBe('feat/jose-auth')
    expect(result.current.error).toBeNull()
  })

  test('treats empty string result as null branch', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('')

    const { result } = renderHook(() => useGitBranch('/home/user/repo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.branch).toBeNull()
  })

  test('captures error on invoke rejection', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('not a repo'))

    const { result } = renderHook(() => useGitBranch('/home/user/repo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.branch).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
  })

  test('refresh re-fetches', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce('main')
      .mockResolvedValueOnce('develop')

    const { result } = renderHook(() => useGitBranch('/home/user/repo'))

    await waitFor(() => expect(result.current.branch).toBe('main'))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.branch).toBe('develop'))
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
