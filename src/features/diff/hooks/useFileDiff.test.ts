import { describe, test, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useFileDiff } from './useFileDiff'
import { mockFileDiffs } from '../data/mockDiff'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'
import type { GitService } from '../services/gitService'
import * as gitServiceModule from '../services/gitService'

describe('useFileDiff', () => {
  test('fetches diff when filePath is provided', async () => {
    const filePath = 'src/components/NavBar.tsx'
    const { result } = renderHook(() => useFileDiff(filePath))

    // Initially loading
    expect(result.current.loading).toBe(true)
    expect(result.current.diff).toBeNull()
    expect(result.current.response).toBeNull()
    expect(result.current.error).toBeNull()

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should have diff from MockGitService (derived getter still works)
    expect(result.current.diff).toEqual(mockFileDiffs[filePath])
    // Backing response should carry the same parsed fileDiff
    expect(result.current.response?.fileDiff).toEqual(mockFileDiffs[filePath])
    expect(result.current.error).toBeNull()
  })

  test('returns null when filePath is null', () => {
    const { result } = renderHook(() => useFileDiff(null))

    expect(result.current.diff).toBeNull()
    expect(result.current.response).toBeNull()
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
    expect(result.current.response).toBeNull()
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

    expect(result.current).toHaveProperty('response')
    expect(result.current).toHaveProperty('diff')
    expect(result.current).toHaveProperty('loading')
    expect(result.current).toHaveProperty('error')
  })

  test('response exposes oldText/newText/rawDiff for Pierre renderer', async () => {
    // MockGitService synthesizes oldText/newText/rawDiff from the mock
    // FileDiff's hunks. NavBar's diff has both added and removed lines, so
    // both oldText and newText must contain reconstructed content.
    const { result } = renderHook(() =>
      useFileDiff('src/components/NavBar.tsx')
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const response = result.current.response
    expect(response).not.toBeNull()
    // NavBar's mock fixture has context + removed + added lines, so the
    // reconstructed oldText must include the removed import line and the
    // reconstructed newText must include the added one.
    expect(response?.oldText).toContain(
      "import { Link } from 'react-router-dom'"
    )

    expect(response?.newText).toContain(
      "import { Link, useLocation } from 'react-router-dom'"
    )
    // rawDiff should start with the unified-diff `---`/`+++` headers and
    // include the hunk header from the fixture.
    expect(response?.rawDiff).toContain('--- a/src/components/NavBar.tsx')
    expect(response?.rawDiff).toContain('+++ b/src/components/NavBar.tsx')
    expect(response?.rawDiff).toContain('@@ -1,8 +1,10 @@')
  })

  test('keeps the current same-file response visible while refreshToken re-fetches', async () => {
    const filePath = 'src/components/NavBar.tsx'
    const fileDiff = mockFileDiffs[filePath]

    const makeResponse = (newText: string): GetGitDiffResponse => ({
      fileDiff: {
        ...fileDiff,
        oldPath: fileDiff.oldPath ?? null,
        newPath: fileDiff.newPath ?? null,
      },
      oldText: 'old',
      newText,
      rawDiff: 'raw diff',
      repoRoot: '/repo',
    })

    let resolveSecond!: (response: GetGitDiffResponse) => void

    const secondFetch = new Promise<GetGitDiffResponse>((resolve) => {
      resolveSecond = resolve
    })

    const getDiff = vi
      .fn<GitService['getDiff']>()
      .mockResolvedValueOnce(makeResponse('new v1'))
      .mockReturnValueOnce(secondFetch)

    vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue({
      getStatus: vi.fn(),
      getDiff,
      stageFile: vi.fn(),
      unstageFile: vi.fn(),
      discardChanges: vi.fn(),
    } as unknown as GitService)

    const { result, rerender } = renderHook(
      ({ token }) => useFileDiff(filePath, false, '/repo', false, token),
      { initialProps: { token: 'revision-1' } }
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.response?.newText).toBe('new v1')

    rerender({ token: 'revision-2' })

    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    expect(result.current.response?.newText).toBe('new v1')

    await act(async () => {
      resolveSecond(makeResponse('new v2'))
      await secondFetch
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.response?.newText).toBe('new v2')
    expect(getDiff).toHaveBeenCalledTimes(2)
  })
})
