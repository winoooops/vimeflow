import { describe, test, expect } from 'vitest'
import { matchChangedFile } from './matchChangedFile'
import type { ChangedFile } from '../../diff/types'

const ROOT = '/home/u/proj'

const file = (path: string, extra: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  status: 'modified',
  staged: false,
  ...extra,
})

describe('matchChangedFile', () => {
  test('matches an exact repo-relative path', () => {
    const target = file('src/a.ts', { insertions: 5, deletions: 2 })
    expect(
      matchChangedFile([target, file('README.md')], 'src/a.ts', ROOT)
    ).toBe(target)
  })

  test('matches an absolute path under the cwd', () => {
    const target = file('src/a.ts')
    expect(matchChangedFile([target], `${ROOT}/src/a.ts`, ROOT)).toBe(target)
  })

  test('matches a nested file when cwd is the repo root', () => {
    const target = file('packages/app/a.ts')
    expect(matchChangedFile([target], `${ROOT}/packages/app/a.ts`, ROOT)).toBe(
      target
    )
  })

  test('matches a backslash-separated absolute path', () => {
    const target = file('src/a.ts')
    expect(matchChangedFile([target], 'C:\\repo\\src\\a.ts', 'C:\\repo')).toBe(
      target
    )
  })

  test('does not match a different file with the same basename', () => {
    // A relative 'src/a.ts' must not resolve to a top-level 'a.ts'.
    expect(matchChangedFile([file('a.ts')], 'src/a.ts', ROOT)).toBeNull()
  })

  test('does not suffix-match an unrelated shorter path', () => {
    // An absolute tool path must not resolve to an unrelated shorter git path.
    expect(
      matchChangedFile([file('a.ts')], `${ROOT}/src/a.ts`, ROOT)
    ).toBeNull()
  })

  test('prefers the unstaged row over the staged one', () => {
    // git emits the staged row first; a live edit is the working-tree change.
    const staged = file('src/a.ts', { staged: true, insertions: 1 })
    const unstaged = file('src/a.ts', { staged: false, insertions: 5 })
    expect(matchChangedFile([staged, unstaged], `${ROOT}/src/a.ts`, ROOT)).toBe(
      unstaged
    )
  })

  test('returns null when only a staged row matches', () => {
    // A pre-staged file with no working-tree change is not the live edit yet.
    expect(
      matchChangedFile(
        [file('src/a.ts', { staged: true })],
        `${ROOT}/src/a.ts`,
        ROOT
      )
    ).toBeNull()
  })

  test('returns null when no file matches', () => {
    expect(matchChangedFile([file('src/a.ts')], 'src/nope.ts', ROOT)).toBeNull()
  })
})
