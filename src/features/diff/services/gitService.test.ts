import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  HttpGitService,
  DesktopGitService,
  createGitService,
  type GitService,
} from './gitService'
import { invoke } from '../../../lib/backend'
import { isDesktop } from '../../../lib/environment'
import type { ChangedFile, FileDiff } from '../types'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../../lib/environment', () => ({
  isDesktop: vi.fn(),
  isBrowser: vi.fn(),
  getEnvironment: vi.fn(),
  isTest: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
const mockedIsDesktop = vi.mocked(isDesktop)

const changedFilesFixture: ChangedFile[] = [
  {
    path: 'src/components/NavBar.tsx',
    status: 'modified',
    insertions: 1,
    deletions: 1,
    staged: false,
  },
]

const fileDiffFixture: FileDiff = {
  filePath: 'src/components/NavBar.tsx',
  oldPath: 'src/components/NavBar.tsx',
  newPath: 'src/components/NavBar.tsx',
  hunks: [
    {
      id: 'hunk-0',
      header: '@@ -1 +1 @@',
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [
        { type: 'removed', oldLineNumber: 1, content: 'old' },
        { type: 'added', newLineNumber: 1, content: 'new' },
      ],
    },
  ],
}

const diffResponseFixture: GetGitDiffResponse = {
  fileDiff: {
    ...fileDiffFixture,
    oldPath: fileDiffFixture.oldPath ?? null,
    newPath: fileDiffFixture.newPath ?? null,
  },
  oldText: 'old\n',
  newText: 'new\n',
  rawDiff: '@@ -1 +1 @@\n-old\n+new\n',
  repoRoot: '/repo',
}

beforeEach(() => {
  mockedInvoke.mockReset()
  mockedIsDesktop.mockReturnValue(false)
})

describe('HttpGitService', () => {
  let service: GitService
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    service = new HttpGitService()
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getStatus', () => {
    test('fetches status from /api/git/status', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ files: changedFilesFixture, repoRoot: '/repo' }),
      })

      const response = await service.getStatus()

      expect(fetchMock).toHaveBeenCalledWith('/api/git/status')
      expect(response.files).toEqual(changedFilesFixture)
      expect(response.repoRoot).toBe('/repo')
    })

    test('throws error on failed request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      })

      await expect(service.getStatus()).rejects.toThrow(
        'Failed to fetch git status: Internal Server Error'
      )
    })
  })

  describe('getDiff', () => {
    test('fetches diff from /api/git/diff with file param', async () => {
      const file = 'src/components/NavBar.tsx'

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(diffResponseFixture),
      })

      const response = await service.getDiff(file)

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/git/diff?file=${encodeURIComponent(file)}&staged=false`
      )
      expect(response).toEqual(diffResponseFixture)
    })

    test('includes staged parameter when true', async () => {
      const file = 'src/test.ts'

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            fileDiff: fileDiffFixture,
            oldText: '',
            newText: '',
            rawDiff: '',
          }),
      })

      await service.getDiff(file, true)

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/git/diff?file=${encodeURIComponent(file)}&staged=true`
      )
    })

    test('includes untracked parameter when provided', async () => {
      const file = 'src/components/NavBar.tsx'

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            fileDiff: fileDiffFixture,
            oldText: '',
            newText: '',
            rawDiff: '',
          }),
      })

      await service.getDiff(file, false, true)

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/git/diff?file=${encodeURIComponent(file)}&staged=false&untracked=true`
      )
    })

    test('throws error on failed request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      })

      await expect(service.getDiff('missing.ts')).rejects.toThrow(
        'Failed to fetch diff for missing.ts: Not Found'
      )
    })
  })

  describe('stageFile', () => {
    test('posts to /api/git/stage with file only (whole file)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.stageFile('src/test.ts')

      expect(fetchMock).toHaveBeenCalledWith('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts' }),
      })
    })

    test('posts to /api/git/stage with file and hunk patch', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      const patch = '@@ -1,3 +1,4 @@\n context\n+added\n'
      await service.stageFile('src/test.ts', patch)

      expect(fetchMock).toHaveBeenCalledWith('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts', hunkPatch: patch }),
      })
    })

    test('throws error on failed request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
      })

      await expect(service.stageFile('src/test.ts')).rejects.toThrow(
        'Failed to stage src/test.ts: Bad Request'
      )
    })
  })

  describe('unstageFile', () => {
    test('posts to /api/git/unstage with file only (whole file)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.unstageFile('src/test.ts')

      expect(fetchMock).toHaveBeenCalledWith('/api/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts' }),
      })
    })

    test('posts to /api/git/unstage with file and hunk patch', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      const patch = '@@ -1,4 +1,3 @@\n context\n-removed\n'
      await service.unstageFile('src/test.ts', patch)

      expect(fetchMock).toHaveBeenCalledWith('/api/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts', hunkPatch: patch }),
      })
    })

    test('throws error on failed request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      })

      await expect(service.unstageFile('src/test.ts')).rejects.toThrow(
        'Failed to unstage src/test.ts: Internal Server Error'
      )
    })
  })

  describe('discardChanges', () => {
    test('posts to /api/git/discard with file and default scope=unstaged (whole file)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.discardChanges('src/test.ts')

      expect(fetchMock).toHaveBeenCalledWith('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts', scope: 'unstaged' }),
      })
    })

    test('posts to /api/git/discard with scope=both when requested', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.discardChanges('src/test.ts', undefined, 'both')

      expect(fetchMock).toHaveBeenCalledWith('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts', scope: 'both' }),
      })
    })

    test('posts to /api/git/discard with file and hunk patch (unstaged scope)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      const patch = '@@ -1,3 +1,4 @@\n context\n+added\n'
      await service.discardChanges('src/test.ts', patch)

      expect(fetchMock).toHaveBeenCalledWith('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: 'src/test.ts',
          scope: 'unstaged',
          hunkPatch: patch,
        }),
      })
    })

    test('posts to /api/git/discard with hunk patch and scope=both for staged discard', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      const patch = '@@ -1,3 +1,4 @@\n context\n+added\n'
      await service.discardChanges('src/test.ts', patch, 'both')

      expect(fetchMock).toHaveBeenCalledWith('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: 'src/test.ts',
          scope: 'both',
          hunkPatch: patch,
        }),
      })
    })

    test('throws error on failed request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
      })

      await expect(service.discardChanges('src/test.ts')).rejects.toThrow(
        'Failed to discard changes to src/test.ts: Forbidden'
      )
    })
  })
})

describe('DesktopGitService', () => {
  let service: GitService
  let invokeMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    invokeMock = mockedInvoke
    service = new DesktopGitService('/home/user/project')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getStatus', () => {
    test('calls invoke with git_status command and correct args', async () => {
      invokeMock.mockResolvedValueOnce({
        files: changedFilesFixture,
        repoRoot: '/repo',
      })

      const response = await service.getStatus()

      expect(invokeMock).toHaveBeenCalledWith('git_status', {
        cwd: '/home/user/project',
      })
      expect(response.files).toEqual(changedFilesFixture)
      expect(response.repoRoot).toBe('/repo')
    })

    test('throws error on invoke failure', async () => {
      invokeMock.mockRejectedValueOnce(new Error('Git command failed'))

      await expect(service.getStatus()).rejects.toThrow(
        'Failed to get git status: Error: Git command failed'
      )
    })
  })

  describe('getDiff', () => {
    test('calls invoke with get_git_diff command and correct args', async () => {
      const mockResponse = {
        fileDiff: fileDiffFixture,
        oldText: 'old',
        newText: 'new',
        rawDiff: '@@',
      }
      invokeMock.mockResolvedValueOnce(mockResponse)

      const response = await service.getDiff('src/components/NavBar.tsx', false)

      expect(invokeMock).toHaveBeenCalledWith('get_git_diff', {
        cwd: '/home/user/project',
        file: 'src/components/NavBar.tsx',
        staged: false,
      })
      expect(response).toEqual(mockResponse)
    })

    test('calls invoke with staged=true when requested', async () => {
      invokeMock.mockResolvedValueOnce({
        fileDiff: fileDiffFixture,
        oldText: '',
        newText: '',
        rawDiff: '',
      })

      await service.getDiff('src/components/NavBar.tsx', true)

      expect(invokeMock).toHaveBeenCalledWith('get_git_diff', {
        cwd: '/home/user/project',
        file: 'src/components/NavBar.tsx',
        staged: true,
      })
    })

    test('passes untracked flag to get_git_diff', async () => {
      invokeMock.mockResolvedValueOnce({
        fileDiff: fileDiffFixture,
        oldText: '',
        newText: '',
        rawDiff: '',
      })

      await service.getDiff('src/components/NavBar.tsx', false, true)

      expect(invokeMock).toHaveBeenCalledWith('get_git_diff', {
        cwd: '/home/user/project',
        file: 'src/components/NavBar.tsx',
        staged: false,
        untracked: true,
      })
    })

    test('throws error on invoke failure', async () => {
      invokeMock.mockRejectedValueOnce(new Error('Diff failed'))

      await expect(
        service.getDiff('src/components/NavBar.tsx')
      ).rejects.toThrow(
        'Failed to get diff for src/components/NavBar.tsx: Error: Diff failed'
      )
    })
  })

  describe('stageFile', () => {
    test('calls invoke with stage_file and cwd + path (whole file)', async () => {
      invokeMock.mockResolvedValueOnce(undefined)

      await service.stageFile('src/test.ts')

      expect(invokeMock).toHaveBeenCalledWith('stage_file', {
        cwd: '/home/user/project',
        path: 'src/test.ts',
        hunkPatch: undefined,
      })
    })

    test('calls invoke with stage_file and hunk patch', async () => {
      invokeMock.mockResolvedValueOnce(undefined)

      const patch = '@@ -1,3 +1,4 @@\n context\n+added\n'
      await service.stageFile('src/test.ts', patch)

      expect(invokeMock).toHaveBeenCalledWith('stage_file', {
        cwd: '/home/user/project',
        path: 'src/test.ts',
        hunkPatch: patch,
      })
    })

    test('throws error on invoke failure', async () => {
      invokeMock.mockRejectedValueOnce(new Error('apply failed'))

      await expect(service.stageFile('src/test.ts')).rejects.toThrow(
        'Failed to stage src/test.ts: Error: apply failed'
      )
    })
  })

  describe('unstageFile', () => {
    test('calls invoke with unstage_file and cwd + path (whole file)', async () => {
      invokeMock.mockResolvedValueOnce(undefined)

      await service.unstageFile('src/test.ts')

      expect(invokeMock).toHaveBeenCalledWith('unstage_file', {
        cwd: '/home/user/project',
        path: 'src/test.ts',
        hunkPatch: undefined,
      })
    })

    test('calls invoke with unstage_file and hunk patch', async () => {
      invokeMock.mockResolvedValueOnce(undefined)

      const patch = '@@ -1,4 +1,3 @@\n context\n-removed\n'
      await service.unstageFile('src/test.ts', patch)

      expect(invokeMock).toHaveBeenCalledWith('unstage_file', {
        cwd: '/home/user/project',
        path: 'src/test.ts',
        hunkPatch: patch,
      })
    })

    test('throws error on invoke failure', async () => {
      invokeMock.mockRejectedValueOnce(new Error('reset failed'))

      await expect(service.unstageFile('src/test.ts')).rejects.toThrow(
        'Failed to unstage src/test.ts: Error: reset failed'
      )
    })
  })

  describe('discardChanges', () => {
    test('calls invoke with discard_file and default scope=unstaged (whole file)', async () => {
      invokeMock.mockResolvedValueOnce(undefined)

      await service.discardChanges('src/test.ts')

      expect(invokeMock).toHaveBeenCalledWith('discard_file', {
        cwd: '/home/user/project',
        path: 'src/test.ts',
        hunkPatch: undefined,
        scope: 'unstaged',
      })
    })

    test('calls invoke with discard_file and scope=both for staged discard', async () => {
      invokeMock.mockResolvedValueOnce(undefined)

      await service.discardChanges('src/test.ts', undefined, 'both')

      expect(invokeMock).toHaveBeenCalledWith('discard_file', {
        cwd: '/home/user/project',
        path: 'src/test.ts',
        hunkPatch: undefined,
        scope: 'both',
      })
    })

    test('calls invoke with discard_file and hunk patch (unstaged scope)', async () => {
      invokeMock.mockResolvedValueOnce(undefined)

      const patch = '@@ -1,3 +1,4 @@\n context\n+added\n'
      await service.discardChanges('src/test.ts', patch)

      expect(invokeMock).toHaveBeenCalledWith('discard_file', {
        cwd: '/home/user/project',
        path: 'src/test.ts',
        hunkPatch: patch,
        scope: 'unstaged',
      })
    })

    test('calls invoke with discard_file and hunk patch with scope=both', async () => {
      invokeMock.mockResolvedValueOnce(undefined)

      const patch = '@@ -1,3 +1,4 @@\n context\n+added\n'
      await service.discardChanges('src/test.ts', patch, 'both')

      expect(invokeMock).toHaveBeenCalledWith('discard_file', {
        cwd: '/home/user/project',
        path: 'src/test.ts',
        hunkPatch: patch,
        scope: 'both',
      })
    })

    test('throws error on invoke failure', async () => {
      invokeMock.mockRejectedValueOnce(new Error('checkout failed'))

      await expect(service.discardChanges('src/test.ts')).rejects.toThrow(
        'Failed to discard changes to src/test.ts: Error: checkout failed'
      )
    })
  })
})

describe('createGitService', () => {
  test('returns HttpGitService in test mode without desktop host', () => {
    const service = createGitService()
    expect(service).toBeInstanceOf(HttpGitService)
  })

  test('returns DesktopGitService when isDesktop() is true', () => {
    vi.stubEnv('MODE', 'development')
    mockedIsDesktop.mockReturnValue(true)
    try {
      const service = createGitService('/test/path')

      expect(service).toBeInstanceOf(DesktopGitService)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test('returns HttpGitService in development mode without desktop host', () => {
    vi.stubEnv('MODE', 'development')
    mockedIsDesktop.mockReturnValue(false)
    try {
      const service = createGitService()

      expect(service).toBeInstanceOf(HttpGitService)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
