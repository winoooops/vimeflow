import { describe, test, expect } from 'vitest'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'
import type { DiffHunk } from '../types'
import {
  diffIdentityForResponse,
  toPierreInputs,
  findRawDiffHunkIndex,
} from './pierreAdapter'

const baseFileDiff = {
  filePath: 'src/foo.ts',
  oldPath: null,
  newPath: null,
  hunks: [],
}

const makeResponse = (
  overrides: Partial<GetGitDiffResponse> = {}
): GetGitDiffResponse => ({
  fileDiff: baseFileDiff,
  oldText: '',
  newText: '',
  rawDiff: '',
  repoRoot: '',
  ...overrides,
})

describe('toPierreInputs', (): void => {
  test('modified file uses filePath on both sides when old/new paths are null', (): void => {
    const response = makeResponse({
      oldText: 'before contents',
      newText: 'after contents',
    })
    const result = toPierreInputs(response)

    expect(result.oldFile.name).toBe('src/foo.ts')
    expect(result.oldFile.contents).toBe('before contents')
    expect(result.newFile.name).toBe('src/foo.ts')
    expect(result.newFile.contents).toBe('after contents')
    expect(result.oldFile.cacheKey).toContain(result.identity)
    expect(result.newFile.cacheKey).toContain(result.identity)
    expect(result.diffCacheKey).toBe(
      `${result.oldFile.cacheKey}:${result.newFile.cacheKey}`
    )
  })

  test('renamed file uses each side actual path', (): void => {
    const response = makeResponse({
      fileDiff: {
        ...baseFileDiff,
        oldPath: 'src/old.ts',
        newPath: 'src/new.ts',
      },
      oldText: 'old contents',
      newText: 'new contents',
    })
    const result = toPierreInputs(response)

    expect(result.oldFile.name).toBe('src/old.ts')
    expect(result.newFile.name).toBe('src/new.ts')
  })

  test('untracked file passes empty oldText with name fallback', (): void => {
    const response = makeResponse({
      fileDiff: { ...baseFileDiff, filePath: 'src/untracked.ts' },
      oldText: '',
      newText: 'new content',
    })
    const result = toPierreInputs(response)

    expect(result.oldFile.name).toBe('src/untracked.ts')
    expect(result.oldFile.contents).toBe('')
    expect(result.newFile.name).toBe('src/untracked.ts')
    expect(result.newFile.contents).toBe('new content')
  })

  test('identity changes when raw diff changes', (): void => {
    const first = makeResponse({ rawDiff: '@@ -1 +1 @@\n-old\n+new\n' })
    const second = makeResponse({ rawDiff: '@@ -1 +1 @@\n-old\n+newer\n' })

    expect(diffIdentityForResponse(first)).not.toBe(
      diffIdentityForResponse(second)
    )
  })
})

describe('findRawDiffHunkIndex', (): void => {
  const makeHunk = (
    newStart: number,
    newLines: number,
    id = `hunk-${newStart}`
  ): DiffHunk => ({
    id,
    header: `@@ -${newStart},${newLines} +${newStart},${newLines} @@`,
    oldStart: newStart,
    oldLines: newLines,
    newStart,
    newLines,
    lines: [],
  })

  test('returns 0 for the first hunk when newStart + newLines match', (): void => {
    const response = makeResponse({
      fileDiff: {
        ...baseFileDiff,
        hunks: [makeHunk(1, 4), makeHunk(20, 6)],
      },
    })

    expect(findRawDiffHunkIndex(response, { newStart: 1, newLines: 4 })).toBe(0)
  })

  test('returns the correct index for a later hunk in a multi-hunk diff', (): void => {
    const response = makeResponse({
      fileDiff: {
        ...baseFileDiff,
        hunks: [makeHunk(1, 4), makeHunk(20, 6), makeHunk(50, 3)],
      },
    })

    expect(findRawDiffHunkIndex(response, { newStart: 50, newLines: 3 })).toBe(
      2
    )
  })

  test('returns -1 when newLines does not match (Pierre split differently)', (): void => {
    const response = makeResponse({
      fileDiff: {
        ...baseFileDiff,
        hunks: [makeHunk(1, 4)],
      },
    })

    // Same newStart but different newLines — Pierre split this region differently
    expect(findRawDiffHunkIndex(response, { newStart: 1, newLines: 2 })).toBe(
      -1
    )
  })

  test('returns -1 when newStart does not match', (): void => {
    const response = makeResponse({
      fileDiff: {
        ...baseFileDiff,
        hunks: [makeHunk(1, 4), makeHunk(20, 6)],
      },
    })

    expect(findRawDiffHunkIndex(response, { newStart: 5, newLines: 4 })).toBe(
      -1
    )
  })

  test('returns -1 on an empty hunks list', (): void => {
    const response = makeResponse()

    expect(findRawDiffHunkIndex(response, { newStart: 1, newLines: 4 })).toBe(
      -1
    )
  })
})
