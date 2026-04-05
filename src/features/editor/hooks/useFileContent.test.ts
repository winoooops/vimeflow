import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFileContent } from './useFileContent'
import * as fileService from '../services/fileService'
import type { FileContentResponse } from '../services/fileService'

vi.mock('../services/fileService')

describe('useFileContent', () => {
  const mockFetchFileContent = vi.mocked(fileService.fetchFileContent)

  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('initial state is empty', () => {
    const { result } = renderHook(() => useFileContent())

    expect(result.current.content).toBe(null)
    expect(result.current.language).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(null)
  })

  test('loads file content', async () => {
    const mockResponse: FileContentResponse = {
      content: 'export default function App() {}',
      language: 'typescript',
    }

    mockFetchFileContent.mockResolvedValueOnce(mockResponse)

    const { result } = renderHook(() => useFileContent())

    await result.current.loadFile('src/App.tsx')

    await waitFor(() => {
      expect(result.current.content).toBe(mockResponse.content)
    })

    expect(result.current.language).toBe(mockResponse.language)
    expect(result.current.error).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(mockFetchFileContent).toHaveBeenCalledWith('src/App.tsx')
  })

  test('handles fetch error', async () => {
    const errorMessage = 'File not found'
    mockFetchFileContent.mockRejectedValueOnce(new Error(errorMessage))

    const { result } = renderHook(() => useFileContent())

    await result.current.loadFile('nonexistent.ts')

    await waitFor(() => {
      expect(result.current.error).toBe(errorMessage)
    })

    expect(result.current.content).toBe(null)
    expect(result.current.language).toBe(null)
    expect(result.current.loading).toBe(false)
  })

  test('handles unknown error type', async () => {
    mockFetchFileContent.mockRejectedValueOnce('Unknown error')

    const { result } = renderHook(() => useFileContent())

    await result.current.loadFile('file.ts')

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to load file content')
    })

    expect(result.current.loading).toBe(false)
  })

  test('caches file content', async () => {
    const mockResponse: FileContentResponse = {
      content: 'const foo = "bar"',
      language: 'javascript',
    }

    mockFetchFileContent.mockResolvedValueOnce(mockResponse)

    const { result } = renderHook(() => useFileContent())

    // First load - should fetch
    await result.current.loadFile('src/utils.js')

    await waitFor(() => {
      expect(result.current.content).toBe(mockResponse.content)
    })

    expect(mockFetchFileContent).toHaveBeenCalledTimes(1)

    // Second load - should use cache
    await result.current.loadFile('src/utils.js')

    // Should still only be called once (cached)
    expect(mockFetchFileContent).toHaveBeenCalledTimes(1)
    expect(result.current.content).toBe(mockResponse.content)
  })

  test('loads different files', async () => {
    const mockResponse1: FileContentResponse = {
      content: 'file 1 content',
      language: 'typescript',
    }

    const mockResponse2: FileContentResponse = {
      content: 'file 2 content',
      language: 'javascript',
    }

    mockFetchFileContent
      .mockResolvedValueOnce(mockResponse1)
      .mockResolvedValueOnce(mockResponse2)

    const { result } = renderHook(() => useFileContent())

    // Load first file
    await result.current.loadFile('file1.ts')

    await waitFor(() => {
      expect(result.current.content).toBe('file 1 content')
    })

    // Load second file
    await result.current.loadFile('file2.js')

    await waitFor(() => {
      expect(result.current.content).toBe('file 2 content')
    })

    expect(mockFetchFileContent).toHaveBeenCalledTimes(2)
  })

  test('clears error on successful load after error', async () => {
    // First load fails
    mockFetchFileContent.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useFileContent())

    await result.current.loadFile('file1.ts')

    await waitFor(() => {
      expect(result.current.error).toBe('Network error')
    })

    // Second load succeeds
    const mockResponse: FileContentResponse = {
      content: 'success',
      language: 'typescript',
    }
    mockFetchFileContent.mockResolvedValueOnce(mockResponse)

    await result.current.loadFile('file2.ts')

    await waitFor(() => {
      expect(result.current.error).toBe(null)
      expect(result.current.content).toBe('success')
    })
  })

  test('loading state is set during fetch', async () => {
    const mockResponse: FileContentResponse = {
      content: 'test',
      language: 'typescript',
    }

    mockFetchFileContent.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(mockResponse), 100)
        })
    )

    const { result } = renderHook(() => useFileContent())

    const loadPromise = result.current.loadFile('file.ts')

    // Should be loading
    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    await loadPromise

    // Should be done loading
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })
})
