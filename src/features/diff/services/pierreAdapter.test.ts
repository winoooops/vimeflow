import { describe, test, expect } from 'vitest'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'
import { toPierreInputs } from './pierreAdapter'

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
})
