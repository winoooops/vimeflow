import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFileTree } from './useFileTree'
import * as fileService from '../services/fileService'
import type { FileNode } from '../types'

vi.mock('../services/fileService')

describe('useFileTree', () => {
  const mockFetchFileTree = vi.mocked(fileService.fetchFileTree)

  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('fetches file tree on mount', async () => {
    const mockTree: FileNode[] = [
      {
        id: 'src',
        name: 'src',
        type: 'folder',
        children: [],
      },
    ]

    mockFetchFileTree.mockResolvedValueOnce(mockTree)

    const { result } = renderHook(() => useFileTree())

    expect(result.current.loading).toBe(true)
    expect(result.current.tree).toEqual([])
    expect(result.current.error).toBe(null)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.tree).toEqual(mockTree)
    expect(result.current.error).toBe(null)
    expect(mockFetchFileTree).toHaveBeenCalledWith(undefined)
  })

  test('fetches file tree with root parameter', async () => {
    const mockTree: FileNode[] = [
      {
        id: 'components',
        name: 'components',
        type: 'folder',
        children: [],
      },
    ]

    mockFetchFileTree.mockResolvedValueOnce(mockTree)

    const { result } = renderHook(() => useFileTree('src'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.tree).toEqual(mockTree)
    expect(mockFetchFileTree).toHaveBeenCalledWith('src')
  })

  test('handles fetch error', async () => {
    const errorMessage = 'Invalid root path'
    mockFetchFileTree.mockRejectedValueOnce(new Error(errorMessage))

    const { result } = renderHook(() => useFileTree())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.tree).toEqual([])
    expect(result.current.error).toBe(errorMessage)
  })

  test('handles unknown error type', async () => {
    mockFetchFileTree.mockRejectedValueOnce('Unknown error')

    const { result } = renderHook(() => useFileTree())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Failed to load file tree')
  })

  test('refetch reloads the file tree', async () => {
    const mockTree1: FileNode[] = [
      {
        id: 'file1',
        name: 'file1.ts',
        type: 'file',
      },
    ]

    const mockTree2: FileNode[] = [
      {
        id: 'file2',
        name: 'file2.ts',
        type: 'file',
      },
    ]

    mockFetchFileTree.mockResolvedValueOnce(mockTree1)

    const { result } = renderHook(() => useFileTree())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.tree).toEqual(mockTree1)

    // Refetch with new data
    mockFetchFileTree.mockResolvedValueOnce(mockTree2)

    await result.current.refetch()

    await waitFor(() => {
      expect(result.current.tree).toEqual(mockTree2)
    })

    expect(mockFetchFileTree).toHaveBeenCalledTimes(2)
  })

  test('clears error on successful refetch', async () => {
    // First call fails
    mockFetchFileTree.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useFileTree())

    await waitFor(() => {
      expect(result.current.error).toBe('Network error')
    })

    // Second call succeeds
    const mockTree: FileNode[] = [{ id: 'file', name: 'file.ts', type: 'file' }]
    mockFetchFileTree.mockResolvedValueOnce(mockTree)

    await result.current.refetch()

    await waitFor(() => {
      expect(result.current.error).toBe(null)
      expect(result.current.tree).toEqual(mockTree)
    })
  })
})
