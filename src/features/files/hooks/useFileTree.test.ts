import { describe, test, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useFileTree } from './useFileTree'

// Mock the service to avoid real filesystem access
vi.mock('../services/fileSystemService', () => ({
  createFileSystemService: vi.fn(() => ({
    listDir: vi.fn((path: string) => {
      if (path === '~') {
        return Promise.resolve([
          { id: 'f1', name: 'src/', type: 'folder' as const },
          { id: 'f2', name: 'package.json', type: 'file' as const },
        ])
      }
      if (path === '~/src') {
        return Promise.resolve([
          { id: 'f3', name: 'index.ts', type: 'file' as const },
        ])
      }

      return Promise.resolve([])
    }),
  })),
}))

describe('useFileTree', () => {
  test('loads nodes from initial path', async () => {
    const { result } = renderHook(() => useFileTree('~'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.nodes).toHaveLength(2)
    expect(result.current.currentPath).toBe('~')
    expect(result.current.error).toBeNull()
  })

  test('navigateTo changes path and reloads', async () => {
    const { result } = renderHook(() => useFileTree('~'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.navigateTo('~/src')
    })

    await waitFor(() => {
      expect(result.current.currentPath).toBe('~/src')
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.nodes).toHaveLength(1)
    expect(result.current.nodes[0].name).toBe('index.ts')
  })

  test('navigateUp goes to parent directory', async () => {
    const { result } = renderHook(() => useFileTree('~/src'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.navigateUp()
    })

    expect(result.current.currentPath).toBe('~')
  })

  test('navigateUp is a no-op at root ~', async () => {
    const { result } = renderHook(() => useFileTree('~'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.navigateUp()
    })

    expect(result.current.currentPath).toBe('~')
  })

  test('navigateUp is a no-op at root /', async () => {
    const { result } = renderHook(() => useFileTree('/'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.navigateUp()
    })

    expect(result.current.currentPath).toBe('/')
  })

  test('syncs with external cwd changes', async () => {
    const { result, rerender } = renderHook(
      ({ cwd }: { cwd: string }) => useFileTree(cwd),
      { initialProps: { cwd: '~' } }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    rerender({ cwd: '~/src' })

    await waitFor(() => {
      expect(result.current.currentPath).toBe('~/src')
    })
  })
})
