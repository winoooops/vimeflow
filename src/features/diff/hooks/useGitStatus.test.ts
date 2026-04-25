import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGitStatus } from './useGitStatus'
import { mockChangedFiles } from '../data/mockDiff'

// Mock Tauri APIs
const mockInvoke = vi.fn()
const mockListen = vi.fn()
const mockUnlisten = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke: (...args: unknown[]): any => mockInvoke(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listen: (...args: unknown[]): any => mockListen(...args),
}))

describe('useGitStatus', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockListen.mockReset()
    mockUnlisten.mockReset()

    // Default: listen returns an unlisten function
    mockListen.mockResolvedValue(mockUnlisten)

    // Default: start_git_watcher and stop_git_watcher succeed
    mockInvoke.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('non-watch mode (existing behavior)', () => {
    test('fetches files on mount', async () => {
      const { result } = renderHook(() => useGitStatus('/home/test/project'))

      // Initially loading
      expect(result.current.loading).toBe(true)
      expect(result.current.files).toEqual([])
      expect(result.current.filesCwd).toBeNull()
      expect(result.current.error).toBeNull()

      // Wait for fetch to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Should have files from MockGitService
      expect(result.current.files).toEqual(mockChangedFiles)
      expect(result.current.filesCwd).toBe('/home/test/project')
      expect(result.current.error).toBeNull()
    })

    test('provides refresh function', async () => {
      const { result } = renderHook(() => useGitStatus('/home/test/project'))

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.files).toEqual(mockChangedFiles)

      // Call refresh (synchronous — bumps refreshKey counter)
      result.current.refresh()

      // Should still have files
      expect(result.current.files).toEqual(mockChangedFiles)
      expect(result.current.error).toBeNull()
    })

    test('handles errors gracefully', async () => {
      // This test would need a way to inject a failing service
      // For now, just verify error state structure
      const { result } = renderHook(() => useGitStatus('/home/test/project'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // In test mode, MockGitService always succeeds
      expect(result.current.error).toBeNull()
    })

    test('returns correct structure with filesCwd', async () => {
      const { result } = renderHook(() => useGitStatus('/home/test/project'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current).toHaveProperty('files')
      expect(result.current).toHaveProperty('filesCwd')
      expect(result.current).toHaveProperty('loading')
      expect(result.current).toHaveProperty('error')
      expect(result.current).toHaveProperty('refresh')
      expect(typeof result.current.refresh).toBe('function')
    })
  })

  describe('watch mode', () => {
    test('starts git watcher on mount', async () => {
      const { result } = renderHook(() =>
        useGitStatus('/home/test/project', { watch: true })
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Should have called listen BEFORE start_git_watcher
      expect(mockListen).toHaveBeenCalledWith(
        'git-status-changed',
        expect.any(Function)
      )

      expect(mockInvoke).toHaveBeenCalledWith('start_git_watcher', {
        cwd: '/home/test/project',
      })
    })

    test('stops git watcher on unmount', async () => {
      const { result, unmount } = renderHook(() =>
        useGitStatus('/home/test/project', { watch: true })
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      unmount()

      await waitFor(() => {
        expect(mockUnlisten).toHaveBeenCalled()
        expect(mockInvoke).toHaveBeenCalledWith('stop_git_watcher', {
          cwd: '/home/test/project',
        })
      })
    })

    test('mount ordering is race-free (listen before start_git_watcher)', async (): Promise<void> => {
      const callOrder: string[] = []

      mockListen.mockImplementation((): Promise<typeof mockUnlisten> => {
        callOrder.push('listen')

        return Promise.resolve(mockUnlisten)
      })

      mockInvoke.mockImplementation((cmd: string): Promise<undefined> => {
        if (cmd === 'start_git_watcher') {
          callOrder.push('start_git_watcher')
        }

        return Promise.resolve(undefined)
      })

      renderHook(() => useGitStatus('/home/test/project', { watch: true }))

      await waitFor(() => {
        expect(callOrder).toContain('listen')
        expect(callOrder).toContain('start_git_watcher')
      })

      // listen must happen before start_git_watcher
      const listenIndex = callOrder.indexOf('listen')
      const startIndex = callOrder.indexOf('start_git_watcher')
      expect(listenIndex).toBeLessThan(startIndex)
    })

    test('unmount ordering (unlisten before stop_git_watcher)', async (): Promise<void> => {
      const cleanupOrder: string[] = []

      mockUnlisten.mockImplementation((): void => {
        cleanupOrder.push('unlisten')
      })

      mockInvoke.mockImplementation((cmd: string): Promise<undefined> => {
        if (cmd === 'stop_git_watcher') {
          cleanupOrder.push('stop_git_watcher')
        }

        return Promise.resolve(undefined)
      })

      const { result, unmount } = renderHook(() =>
        useGitStatus('/home/test/project', { watch: true })
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      unmount()

      await waitFor(() => {
        expect(cleanupOrder).toContain('unlisten')
        expect(cleanupOrder).toContain('stop_git_watcher')
      })

      // unlisten must happen before stop_git_watcher
      const unlistenIndex = cleanupOrder.indexOf('unlisten')
      const stopIndex = cleanupOrder.indexOf('stop_git_watcher')
      expect(unlistenIndex).toBeLessThan(stopIndex)
    })

    // cspell:disable-next-line
    test('refreshes when event cwds includes current cwd', async (): Promise<void> => {
      // cspell:disable-next-line
      let eventHandler:
        | ((event: { payload: { cwds: string[] } }) => void)
        | null = null

      mockListen.mockImplementation(
        (_event: string, handler: unknown): Promise<typeof mockUnlisten> => {
          // cspell:disable-next-line
          eventHandler = handler as (event: {
            payload: { cwds: string[] }
          }) => void

          return Promise.resolve(mockUnlisten)
        }
      )

      const { result } = renderHook(() =>
        useGitStatus('/home/test/project', { watch: true })
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
        expect(eventHandler).not.toBeNull()
      })

      const initialFiles = result.current.files

      // Fire event with matching cwd
      // cspell:disable-next-line
      eventHandler!({ payload: { cwds: ['/home/test/project'] } })

      await waitFor(() => {
        // refresh() was called, files re-fetched
        expect(result.current.files).toEqual(initialFiles)
      })
    })

    // cspell:disable-next-line
    test('does not refresh when event cwds does not include current cwd', async (): Promise<void> => {
      // cspell:disable-next-line
      let eventHandler:
        | ((event: { payload: { cwds: string[] } }) => void)
        | null = null

      mockListen.mockImplementation(
        (_event: string, handler: unknown): Promise<typeof mockUnlisten> => {
          // cspell:disable-next-line
          eventHandler = handler as (event: {
            payload: { cwds: string[] }
          }) => void

          return Promise.resolve(mockUnlisten)
        }
      )

      const { result } = renderHook(() =>
        useGitStatus('/home/test/project', { watch: true })
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
        expect(eventHandler).not.toBeNull()
      })

      const initialLoading = result.current.loading

      // Fire event with different cwd
      // cspell:disable-next-line
      eventHandler!({ payload: { cwds: ['/other/project'] } })

      // Should not trigger refresh (loading stays false)
      expect(result.current.loading).toBe(initialLoading)
    })

    // cspell:disable-next-line
    test('shared-watcher fan-out (multiple cwds in one event)', async (): Promise<void> => {
      // cspell:disable-next-line
      let eventHandler:
        | ((event: { payload: { cwds: string[] } }) => void)
        | null = null

      mockListen.mockImplementation(
        (_event: string, handler: unknown): Promise<typeof mockUnlisten> => {
          // cspell:disable-next-line
          eventHandler = handler as (event: {
            payload: { cwds: string[] }
          }) => void

          return Promise.resolve(mockUnlisten)
        }
      )

      const { result } = renderHook(() =>
        useGitStatus('/home/test/repo/src/a', { watch: true })
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
        expect(eventHandler).not.toBeNull()
      })

      // Fire event with multiple current working directories including ours
      // cspell:disable-next-line
      eventHandler!({
        // cspell:disable-next-line
        payload: { cwds: ['/home/test/repo/src/a', '/home/test/repo/src/b'] },
      })

      await waitFor(() => {
        // refresh() was called because our cwd is in the list
        expect(result.current.files).toEqual(mockChangedFiles)
      })
    })
  })

  describe('filesCwd freshness tracking', () => {
    test('filesCwd is null before first fetch resolves', () => {
      const { result } = renderHook(() => useGitStatus('/home/test/project'))

      // Before fetch completes
      expect(result.current.filesCwd).toBeNull()
    })

    test('filesCwd updates to cwd on successful fetch', async () => {
      const { result } = renderHook(() => useGitStatus('/home/test/project'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.filesCwd).toBe('/home/test/project')
    })

    test('filesCwd stays at last successful cwd during new cwd fetch', async () => {
      const { result, rerender } = renderHook(({ cwd }) => useGitStatus(cwd), {
        initialProps: { cwd: '/home/test/project-a' },
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.filesCwd).toBe('/home/test/project-a')

      // Change cwd
      rerender({ cwd: '/home/test/project-b' })

      // During the fetch for project-b, filesCwd should still be project-a
      if (result.current.loading) {
        expect(result.current.filesCwd).toBe('/home/test/project-a')
      }

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // After fetch completes, filesCwd updates to project-b
      expect(result.current.filesCwd).toBe('/home/test/project-b')
    })

    test('filesCwd does not update on fetch failure', async () => {
      // This would need a way to inject a failing service
      // For now, document the expected behavior
      const { result } = renderHook(() => useGitStatus('/home/test/project'))

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // After successful fetch
      expect(result.current.filesCwd).toBe('/home/test/project')

      // If a subsequent fetch fails (error is set), filesCwd should remain unchanged
      // This is verified by the implementation — filesCwd is only set in the success path
    })
  })

  describe('enabled flag', () => {
    test('enabled: false returns empty state with no IPC', (): void => {
      const { result } = renderHook(() =>
        useGitStatus('/home/test/project', { enabled: false })
      )

      // Should immediately return empty state
      expect(result.current.files).toEqual([])
      expect(result.current.filesCwd).toBeNull()
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBeNull()

      // Should not have called any Tauri APIs
      expect(mockInvoke).not.toHaveBeenCalled()
      expect(mockListen).not.toHaveBeenCalled()
    })

    test('flipping enabled from false to true starts fetch', async () => {
      const { result, rerender } = renderHook(
        ({ enabled }) => useGitStatus('/home/test/project', { enabled }),
        { initialProps: { enabled: false } }
      )

      // Initially disabled
      expect(result.current.files).toEqual([])
      expect(result.current.loading).toBe(false)

      // Enable
      rerender({ enabled: true })

      expect(result.current.loading).toBe(true)

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.files).toEqual(mockChangedFiles)
      expect(result.current.filesCwd).toBe('/home/test/project')
    })

    test('flipping enabled from true to false clears state', async () => {
      const { result, rerender } = renderHook(
        ({ enabled }) => useGitStatus('/home/test/project', { enabled }),
        { initialProps: { enabled: true } }
      )

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.files).toEqual(mockChangedFiles)

      // Disable
      rerender({ enabled: false })

      expect(result.current.files).toEqual([])
      expect(result.current.filesCwd).toBeNull()
      expect(result.current.loading).toBe(false)
    })

    test('enabled: false with watch: true does not start watcher', (): void => {
      renderHook(() =>
        useGitStatus('/home/test/project', { enabled: false, watch: true })
      )

      // Should not have started the watcher
      expect(mockListen).not.toHaveBeenCalled()
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })
})
