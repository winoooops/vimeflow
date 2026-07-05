import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useFileDiff } from './useFileDiff'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'
import type { FileDiff } from '../types'
import type { GitService } from '../services/gitService'
import * as gitServiceModule from '../services/gitService'

const makeDiff = (
  filePath: string,
  oldContent: string | null,
  newContent: string
): FileDiff => {
  const isNewFile = oldContent === null

  return {
    filePath,
    oldPath: isNewFile ? '/dev/null' : filePath,
    newPath: filePath,
    hunks: [
      {
        id: 'hunk-0',
        header: isNewFile ? '@@ -0,0 +1 @@' : '@@ -1 +1 @@',
        oldStart: isNewFile ? 0 : 1,
        oldLines: isNewFile ? 0 : 1,
        newStart: 1,
        newLines: 1,
        lines: [
          ...(oldContent === null
            ? []
            : [
                {
                  type: 'removed' as const,
                  oldLineNumber: 1,
                  content: oldContent,
                },
              ]),
          { type: 'added', newLineNumber: 1, content: newContent },
        ],
      },
    ],
  }
}

const navBarDiff = makeDiff('src/components/NavBar.tsx', 'old nav', 'new nav')

const terminalDiff = makeDiff(
  'src/components/TerminalPanel.tsx',
  'old terminal',
  'new terminal'
)

const apiDiff = makeDiff('src/utils/api-helper.rs', null, 'use reqwest;')

const fileDiffs: Record<string, FileDiff> = {
  [navBarDiff.filePath]: navBarDiff,
  [terminalDiff.filePath]: terminalDiff,
  [apiDiff.filePath]: apiDiff,
}

const makeResponse = (
  fileDiff: FileDiff,
  newText = `new text for ${fileDiff.filePath}`
): GetGitDiffResponse => ({
  fileDiff: {
    ...fileDiff,
    oldPath: fileDiff.oldPath ?? null,
    newPath: fileDiff.newPath ?? null,
  },
  oldText: `old text for ${fileDiff.filePath}`,
  newText,
  rawDiff: `${fileDiff.hunks[0].header}\n-old\n+${newText}\n`,
  repoRoot: '/repo',
})

const getDiff = vi.fn<GitService['getDiff']>()

const gitService: GitService = {
  getStatus: vi.fn(),
  getDiff,
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  discardChanges: vi.fn(),
}

describe('useFileDiff', () => {
  beforeEach(() => {
    getDiff.mockImplementation((file) => {
      const fileDiff = fileDiffs[file]

      if (!fileDiff) {
        return Promise.reject(new Error(`Diff not found for file: ${file}`))
      }

      return Promise.resolve(makeResponse(fileDiff))
    })

    vi.spyOn(gitServiceModule, 'createGitService').mockReturnValue(gitService)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    getDiff.mockReset()
  })

  test('fetches diff when filePath is provided', async () => {
    const filePath = navBarDiff.filePath
    const { result } = renderHook(() => useFileDiff(filePath))

    expect(result.current.loading).toBe(true)
    expect(result.current.diff).toBeNull()
    expect(result.current.response).toBeNull()
    expect(result.current.error).toBeNull()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.diff).toEqual(navBarDiff)
    expect(result.current.response?.fileDiff).toEqual(navBarDiff)
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
      initialProps: { path: navBarDiff.filePath },
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.diff).toEqual(navBarDiff)

    rerender({ path: terminalDiff.filePath })

    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.diff).toEqual(terminalDiff)
  })

  test('passes staged parameter to the git service', async () => {
    const filePath = apiDiff.filePath
    const { result } = renderHook(() => useFileDiff(filePath, true))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.diff).toEqual(apiDiff)
    expect(getDiff).toHaveBeenCalledWith(filePath, true, undefined)
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
    const { result } = renderHook(() => useFileDiff(navBarDiff.filePath))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current).toHaveProperty('response')
    expect(result.current).toHaveProperty('diff')
    expect(result.current).toHaveProperty('loading')
    expect(result.current).toHaveProperty('error')
  })

  test('response exposes oldText/newText/rawDiff for Pierre renderer', async () => {
    const { result } = renderHook(() => useFileDiff(navBarDiff.filePath))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const response = result.current.response
    expect(response).not.toBeNull()
    expect(response?.oldText).toContain(navBarDiff.filePath)
    expect(response?.newText).toContain(navBarDiff.filePath)
    expect(response?.rawDiff).toContain('@@ -1 +1 @@')
  })

  test('keeps same-file background updates pending until accepted', async () => {
    const filePath = navBarDiff.filePath

    let resolveSecond!: (response: GetGitDiffResponse) => void

    const secondFetch = new Promise<GetGitDiffResponse>((resolve) => {
      resolveSecond = resolve
    })

    getDiff
      .mockResolvedValueOnce(makeResponse(navBarDiff, 'new v1'))
      .mockReturnValueOnce(secondFetch)

    const { result, rerender } = renderHook(
      ({ token }) => useFileDiff(filePath, false, '/repo', false, token),
      { initialProps: { token: 'revision-1' } }
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.response?.newText).toBe('new v1')
    expect(result.current.latestDiffStatus).toBeNull()

    rerender({ token: 'revision-2' })

    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    expect(result.current.response?.newText).toBe('new v1')
    expect(result.current.latestDiffStatus).toBe('updating')

    await act(async () => {
      resolveSecond(makeResponse(navBarDiff, 'new v2'))
      await secondFetch
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.response?.newText).toBe('new v1')
    expect(result.current.latestDiffStatus).toBe('updating')

    await waitFor(() => {
      expect(result.current.latestDiffStatus).toBe('ready')
    })

    act(() => {
      result.current.acceptLatestDiff()
    })

    expect(result.current.response?.newText).toBe('new v2')
    expect(result.current.latestDiffStatus).toBeNull()
    expect(getDiff).toHaveBeenCalledTimes(2)
  })

  test('keeps the latest-diff ready state visible during continuous background updates', async () => {
    const filePath = navBarDiff.filePath

    let resolveSecond!: (response: GetGitDiffResponse) => void
    let resolveThird!: (response: GetGitDiffResponse) => void

    const secondFetch = new Promise<GetGitDiffResponse>((resolve) => {
      resolveSecond = resolve
    })

    const thirdFetch = new Promise<GetGitDiffResponse>((resolve) => {
      resolveThird = resolve
    })

    getDiff
      .mockResolvedValueOnce(makeResponse(navBarDiff, 'new v1'))
      .mockReturnValueOnce(secondFetch)
      .mockReturnValueOnce(thirdFetch)

    const { result, rerender } = renderHook(
      ({ token }) => useFileDiff(filePath, false, '/repo', false, token),
      { initialProps: { token: 'revision-1' } }
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    rerender({ token: 'revision-2' })

    await act(async () => {
      resolveSecond(makeResponse(navBarDiff, 'new v2'))
      await secondFetch
    })

    await waitFor(() => {
      expect(result.current.latestDiffStatus).toBe('ready')
    })

    rerender({ token: 'revision-3' })

    await waitFor(() => {
      expect(result.current.loading).toBe(true)
    })

    expect(result.current.response?.newText).toBe('new v1')
    expect(result.current.latestDiffStatus).toBe('ready')

    await act(async () => {
      resolveThird(makeResponse(navBarDiff, 'new v3'))
      await thirdFetch
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.response?.newText).toBe('new v1')
    expect(result.current.latestDiffStatus).toBe('ready')

    act(() => {
      result.current.acceptLatestDiff()
    })

    expect(result.current.response?.newText).toBe('new v3')
    expect(result.current.latestDiffStatus).toBeNull()
  })
})
