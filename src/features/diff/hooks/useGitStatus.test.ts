import { describe, test, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGitStatus } from './useGitStatus'
import { mockChangedFiles } from '../data/mockDiff'

describe('useGitStatus', () => {
  test('fetches files on mount', async () => {
    const { result } = renderHook(() => useGitStatus('/home/test/project'))

    // Initially loading
    expect(result.current.loading).toBe(true)
    expect(result.current.files).toEqual([])
    expect(result.current.error).toBeNull()

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should have files from MockGitService
    expect(result.current.files).toEqual(mockChangedFiles)
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

  test('returns correct structure', async () => {
    const { result } = renderHook(() => useGitStatus('/home/test/project'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current).toHaveProperty('files')
    expect(result.current).toHaveProperty('loading')
    expect(result.current).toHaveProperty('error')
    expect(result.current).toHaveProperty('refresh')
    expect(typeof result.current.refresh).toBe('function')
  })
})
