import { describe, test, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFileDiff } from './useFileDiff'
import { mockFileDiffs } from '../data/mockDiff'

describe('useFileDiff', () => {
  test('fetches diff when filePath is provided', async () => {
    const filePath = 'src/components/NavBar.tsx'
    const { result } = renderHook(() => useFileDiff(filePath))

    // Initially loading
    expect(result.current.loading).toBe(true)
    expect(result.current.diff).toBeNull()
    expect(result.current.error).toBeNull()

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should have diff from MockGitService
    expect(result.current.diff).toEqual(mockFileDiffs[filePath])
    expect(result.current.error).toBeNull()
  })

  test('returns null when filePath is null', () => {
    const { result } = renderHook(() => useFileDiff(null))

    expect(result.current.diff).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  test('re-fetches when filePath changes', async () => {
    const { result, rerender } = renderHook(({ path }) => useFileDiff(path), {
      initialProps: { path: 'src/components/NavBar.tsx' },
    })

    // Wait for initial fetch
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.diff).toEqual(
      mockFileDiffs['src/components/NavBar.tsx']
    )

    // Change file path
    rerender({ path: 'src/components/TerminalPanel.tsx' })

    // Should start loading again
    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    // Wait for new fetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.diff).toEqual(
      mockFileDiffs['src/components/TerminalPanel.tsx']
    )
  })

  test('handles staged parameter', async () => {
    const filePath = 'src/utils/api-helper.rs'
    const { result } = renderHook(() => useFileDiff(filePath, true))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.diff).toEqual(mockFileDiffs[filePath])
  })

  test('handles errors for non-existent files', async () => {
    const { result } = renderHook(() => useFileDiff('non-existent.ts'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.diff).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toContain('Diff not found for file')
  })

  test('returns correct structure', async () => {
    const { result } = renderHook(() =>
      useFileDiff('src/components/NavBar.tsx')
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current).toHaveProperty('diff')
    expect(result.current).toHaveProperty('loading')
    expect(result.current).toHaveProperty('error')
  })
})
