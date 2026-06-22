import { describe, expect, test } from 'vitest'
import type { ChangedFile } from '../../diff/types'
import {
  expandTildePath,
  fileExistsInDirectory,
  fileNameFromPath,
  isNotFoundError,
  normalizePathForComparison,
  parentPathForFileLookup,
  parentPathForGitStatus,
  relativePathFromCwd,
  resolveEditorFileLifecycleStatus,
} from './editorFileLifecycleStatus'

const file = (path: string, status: ChangedFile['status']): ChangedFile => ({
  path,
  status,
  staged: false,
})

describe('editorFileLifecycleStatus', () => {
  test('expands home-relative editor paths for git status matching', () => {
    const home = process.env.HOME ?? process.env.USERPROFILE

    if (!home) {
      return
    }

    expect(expandTildePath('~/repo/src/new.ts')).toBe(`${home}/repo/src/new.ts`)
    expect(parentPathForGitStatus('~/repo/src/new.ts')).toBe(
      normalizePathForComparison(`${home}/repo/src`)
    )
  })

  test('keeps home-relative paths intact for filesystem parent lookup', () => {
    expect(parentPathForFileLookup('~/repo/src/new.ts')).toBe('~/repo/src')
  })

  test('normalizes absolute paths into cwd-relative paths', () => {
    expect(relativePathFromCwd('/repo/src/new.ts', '/repo')).toBe('src/new.ts')
    expect(relativePathFromCwd('/repo/src/new.ts', '/other')).toBeNull()
  })

  test('matches the selected file against parent directory entries', () => {
    expect(fileNameFromPath('/repo/src/new.ts')).toBe('new.ts')

    expect(
      fileExistsInDirectory('/repo/src/new.ts', [
        { name: 'new.ts', type: 'file' },
        { name: 'nested/', type: 'folder' },
      ])
    ).toBe(true)

    expect(
      fileExistsInDirectory('/repo/src/new.ts', [
        { name: 'new.ts/', type: 'folder' },
      ])
    ).toBe(false)
  })

  test.each([
    ['added', 'NEW'],
    ['untracked', 'NEW'],
    ['deleted', 'DELETED'],
  ] as const)(
    'maps git %s status to editor %s lifecycle status',
    (gitStatus, editorStatus) => {
      expect(
        resolveEditorFileLifecycleStatus({
          filePath: '/repo/src/new.ts',
          gitStatusCwd: '/repo',
          files: [file('src/new.ts', gitStatus)],
          filesCwd: '/repo',
        })
      ).toBe(editorStatus)
    }
  )

  test('marks the selected file deleted when its parent listing no longer contains it', () => {
    expect(
      resolveEditorFileLifecycleStatus({
        filePath: '/repo/src/dummy.ts',
        gitStatusCwd: '/repo',
        files: [],
        filesCwd: '/repo',
        selectedFileExists: false,
      })
    ).toBe('DELETED')
  })

  test('uses repo-root-relative paths when git status reports a repo root', () => {
    const home = process.env.HOME ?? process.env.USERPROFILE

    if (!home) {
      return
    }

    expect(
      resolveEditorFileLifecycleStatus({
        filePath: '~/repo/packages/app/src/new.ts',
        gitStatusCwd: `${home}/repo/packages/app`,
        repoRoot: `${home}/repo`,
        files: [file('packages/app/src/new.ts', 'untracked')],
        filesCwd: `${home}/repo/packages/app`,
      })
    ).toBe('NEW')
  })

  test('returns null for unchanged, stale, missing, or out-of-scope paths', () => {
    expect(
      resolveEditorFileLifecycleStatus({
        filePath: '/repo/src/changed.ts',
        gitStatusCwd: '/repo',
        files: [file('src/changed.ts', 'modified')],
        filesCwd: '/repo',
      })
    ).toBeNull()

    expect(
      resolveEditorFileLifecycleStatus({
        filePath: '/repo/src/new.ts',
        gitStatusCwd: '/repo',
        files: [file('src/new.ts', 'untracked')],
        filesCwd: '/other',
      })
    ).toBeNull()

    expect(
      resolveEditorFileLifecycleStatus({
        filePath: null,
        gitStatusCwd: '/repo',
        files: [file('src/new.ts', 'untracked')],
        filesCwd: '/repo',
      })
    ).toBeNull()

    expect(
      resolveEditorFileLifecycleStatus({
        filePath: '/other/src/new.ts',
        gitStatusCwd: '/repo',
        files: [file('src/new.ts', 'untracked')],
        filesCwd: '/repo',
      })
    ).toBeNull()
  })

  test('normalizes cwd paths before comparing', () => {
    expect(
      resolveEditorFileLifecycleStatus({
        filePath: '/repo/src/new.ts',
        gitStatusCwd: '/repo/',
        files: [file('src/new.ts', 'untracked')],
        filesCwd: '/repo',
      })
    ).toBe('NEW')

    expect(
      resolveEditorFileLifecycleStatus({
        filePath: '/repo/src/new.ts',
        gitStatusCwd: '/repo',
        files: [file('src/new.ts', 'untracked')],
        filesCwd: '~/repo',
      })
    ).toBeNull()
  })

  test('folds case on case-insensitive platforms', () => {
    const originalPlatform = process.platform

    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    })

    expect(
      resolveEditorFileLifecycleStatus({
        filePath: '/Repo/src/new.ts',
        gitStatusCwd: '/repo',
        files: [file('src/new.ts', 'untracked')],
        filesCwd: '/Repo',
      })
    ).toBe('NEW')

    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    })
  })

  test.each([
    ['ENOENT', true],
    ['No such file or directory (os error 2)', true],
    ['The system cannot find the file specified', true],
    ["invalid path '/foo': No such file or directory (os error 2)", true],
    ['EACCES: permission denied', false],
    ['session not found', false],
    ['backend unavailable', false],
  ] as const)('isNotFoundError(%s) returns %s', (message, expected) => {
    expect(isNotFoundError(new Error(message))).toBe(expected)
    expect(isNotFoundError(message)).toBe(expected)
  })
})
