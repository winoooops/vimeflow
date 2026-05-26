import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MockGitService,
  HttpGitService,
  DesktopGitService,
  createGitService,
  type GitService,
} from './gitService'
import { mockChangedFiles, mockFileDiffs } from '../data/mockDiff'
import { invoke } from '../../../lib/backend'
import { isDesktop } from '../../../lib/environment'
import type { FileDiff } from '../types'

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

beforeEach(() => {
  mockedInvoke.mockReset()
  mockedIsDesktop.mockReturnValue(false)
})

describe('MockGitService', () => {
  let service: GitService

  beforeEach(() => {
    service = new MockGitService()
  })

  test('getStatus returns all changed files', async () => {
    const files = await service.getStatus()

    expect(files).toHaveLength(4)
    expect(files).toEqual(mockChangedFiles)
  })

  test('getDiff returns GetGitDiffResponse for existing file', async () => {
    const response = await service.getDiff('src/components/NavBar.tsx')

    expect(response.fileDiff).toEqual(
      mockFileDiffs['src/components/NavBar.tsx']
    )
    expect(response.fileDiff.hunks).toHaveLength(2)
    // MockGitService synthesizes oldText / newText / rawDiff from the fixture
    expect(response.oldText).toContain(
      "import { Link } from 'react-router-dom'"
    )

    expect(response.newText).toContain(
      "import { Link, useLocation } from 'react-router-dom'"
    )
    expect(response.oldText.endsWith('\n')).toBe(true)
    expect(response.newText.endsWith('\n')).toBe(true)
    expect(response.rawDiff).toMatch(
      /^diff --git a\/src\/components\/NavBar\.tsx b\/src\/components\/NavBar\.tsx/
    )
    expect(response.rawDiff).toContain('@@ -1,8 +1,10 @@')
    expect(response.rawDiff.endsWith('\n')).toBe(true)
  })

  test('getDiff keeps real paths in diff --git header for new files', async () => {
    const response = await service.getDiff('src/utils/api-helper.rs')

    expect(response.oldText).toBe('')
    expect(response.newText).toContain('use reqwest::Client;')
    expect(response.rawDiff).toContain(
      'diff --git a/src/utils/api-helper.rs b/src/utils/api-helper.rs'
    )
    expect(response.rawDiff).toContain('new file mode 100644\n')
    expect(response.rawDiff).toContain('--- /dev/null\n')
    expect(response.rawDiff).toContain('+++ b/src/utils/api-helper.rs\n')
    expect(response.rawDiff).not.toContain('a/dev/null')
    expect(response.fileDiff.oldPath).toBe('/dev/null')
    expect(response.fileDiff.newPath).toBe('src/utils/api-helper.rs')
  })

  test('getDiff infers new-file patch header from all-added hunks', async () => {
    const file = 'src/new-from-hunks.ts'

    const addedDiff: FileDiff = {
      filePath: file,
      hunks: [
        {
          id: 'hunk-0',
          header: '@@ -0,0 +1,2 @@',
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 2,
          lines: [
            { type: 'added', newLineNumber: 1, content: 'export const x = 1' },
            { type: 'added', newLineNumber: 2, content: '' },
          ],
        },
      ],
    }

    mockFileDiffs[file] = addedDiff

    try {
      const response = await service.getDiff(file)

      expect(response.oldText).toBe('')
      expect(response.newText).toBe('export const x = 1\n\n')
      expect(response.rawDiff).toContain(`diff --git a/${file} b/${file}`)
      expect(response.rawDiff).toContain('new file mode 100644\n')
      expect(response.rawDiff).toContain('--- /dev/null\n')
      expect(response.rawDiff).toContain(`+++ b/${file}\n`)
      expect(response.fileDiff.oldPath).toBeNull()
      expect(response.fileDiff.newPath).toBeNull()
    } finally {
      delete mockFileDiffs[file]
    }
  })

  test('getDiff keeps real paths in diff --git header for deleted files', async () => {
    const response = await service.getDiff('tsconfig.json')

    expect(response.oldText).toContain('"compilerOptions"')
    expect(response.newText).toBe('')
    expect(response.rawDiff).toContain(
      'diff --git a/tsconfig.json b/tsconfig.json'
    )
    expect(response.rawDiff).toContain('deleted file mode 100644\n')
    expect(response.rawDiff).toContain('--- a/tsconfig.json\n')
    expect(response.rawDiff).toContain('+++ /dev/null\n')
    expect(response.rawDiff).not.toContain('b/dev/null')
    expect(response.fileDiff.oldPath).toBe('tsconfig.json')
    expect(response.fileDiff.newPath).toBe('/dev/null')
  })

  test('getDiff infers deleted-file patch header from all-removed hunks', async () => {
    const file = 'src/deleted-from-hunks.ts'

    const deletedDiff: FileDiff = {
      filePath: file,
      hunks: [
        {
          id: 'hunk-0',
          header: '@@ -1,2 +0,0 @@',
          oldStart: 1,
          oldLines: 2,
          newStart: 0,
          newLines: 0,
          lines: [
            {
              type: 'removed',
              oldLineNumber: 1,
              content: 'export const x = 1',
            },
            { type: 'removed', oldLineNumber: 2, content: '' },
          ],
        },
      ],
    }

    mockFileDiffs[file] = deletedDiff

    try {
      const response = await service.getDiff(file)

      expect(response.oldText).toBe('export const x = 1\n\n')
      expect(response.newText).toBe('')
      expect(response.rawDiff).toContain(`diff --git a/${file} b/${file}`)
      expect(response.rawDiff).toContain('deleted file mode 100644\n')
      expect(response.rawDiff).toContain(`--- a/${file}\n`)
      expect(response.rawDiff).toContain('+++ /dev/null\n')
      expect(response.fileDiff.oldPath).toBeNull()
      expect(response.fileDiff.newPath).toBeNull()
    } finally {
      delete mockFileDiffs[file]
    }
  })

  test('getDiff preserves explicit no-newline markers in synthesized rawDiff', async () => {
    const file = 'no-newline.txt'

    const noNewlineDiff: FileDiff = {
      filePath: file,
      oldPath: file,
      newPath: file,
      hunks: [
        {
          id: 'hunk-0',
          header: '@@ -1 +1 @@',
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [
            {
              type: 'removed',
              oldLineNumber: 1,
              content: 'before',
              hasTrailingNewline: false,
            },
            {
              type: 'added',
              newLineNumber: 1,
              content: 'after',
              hasTrailingNewline: false,
            },
          ],
        },
      ],
    }
    mockFileDiffs[file] = noNewlineDiff

    try {
      const response = await service.getDiff(file)

      expect(response.oldText).toBe('before')
      expect(response.newText).toBe('after')
      expect(response.rawDiff).toContain(
        [
          '-before',
          '\\ No newline at end of file',
          '+after',
          '\\ No newline at end of file',
        ].join('\n')
      )
      expect(response.rawDiff.endsWith('\n')).toBe(true)
    } finally {
      delete mockFileDiffs[file]
    }
  })

  test('getDiff throws error for non-existent file', async () => {
    await expect(service.getDiff('non-existent.ts')).rejects.toThrow(
      'Diff not found for file: non-existent.ts'
    )
  })

  test('stageFile resolves successfully (whole file)', async () => {
    await expect(service.stageFile('src/test.ts')).resolves.toBeUndefined()
  })

  test('stageFile with hunk patch resolves successfully', async () => {
    await expect(
      service.stageFile('src/test.ts', '@@ -1,3 +1,4 @@\n context\n+added\n')
    ).resolves.toBeUndefined()
  })

  test('unstageFile resolves successfully (whole file)', async () => {
    await expect(service.unstageFile('src/test.ts')).resolves.toBeUndefined()
  })

  test('unstageFile with hunk patch resolves successfully', async () => {
    await expect(
      service.unstageFile('src/test.ts', '@@ -1,3 +1,4 @@\n context\n+added\n')
    ).resolves.toBeUndefined()
  })

  test('discardChanges resolves successfully (whole file)', async () => {
    await expect(service.discardChanges('src/test.ts')).resolves.toBeUndefined()
  })

  test('discardChanges with hunk patch resolves successfully', async () => {
    await expect(
      service.discardChanges(
        'src/test.ts',
        '@@ -1,3 +1,4 @@\n context\n+added\n'
      )
    ).resolves.toBeUndefined()
  })
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
        json: () => Promise.resolve(mockChangedFiles),
      })

      const files = await service.getStatus()

      expect(fetchMock).toHaveBeenCalledWith('/api/git/status')
      expect(files).toEqual(mockChangedFiles)
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

      const mockResponse = {
        fileDiff: mockFileDiffs[file],
        oldText: 'old',
        newText: 'new',
        rawDiff: '@@',
      }

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const response = await service.getDiff(file)

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/git/diff?file=${encodeURIComponent(file)}&staged=false`
      )
      expect(response).toEqual(mockResponse)
    })

    test('includes staged parameter when true', async () => {
      const file = 'src/test.ts'

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            fileDiff: mockFileDiffs[file],
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
            fileDiff: mockFileDiffs[file],
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
    test('posts to /api/git/discard with file and scope (whole file)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.discardChanges('src/test.ts')

      expect(fetchMock).toHaveBeenCalledWith('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts', scope: 'unstaged' }),
      })
    })

    test('posts to /api/git/discard with file and hunk patch', async () => {
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
      invokeMock.mockResolvedValueOnce(mockChangedFiles)

      const files = await service.getStatus()

      expect(invokeMock).toHaveBeenCalledWith('git_status', {
        cwd: '/home/user/project',
      })
      expect(files).toEqual(mockChangedFiles)
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
        fileDiff: mockFileDiffs['src/components/NavBar.tsx'],
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
        fileDiff: mockFileDiffs['src/components/NavBar.tsx'],
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
        fileDiff: mockFileDiffs['src/components/NavBar.tsx'],
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
    test('calls invoke with discard_file and cwd + path + scope (whole file)', async () => {
      invokeMock.mockResolvedValueOnce(undefined)

      await service.discardChanges('src/test.ts')

      expect(invokeMock).toHaveBeenCalledWith('discard_file', {
        cwd: '/home/user/project',
        path: 'src/test.ts',
        hunkPatch: undefined,
        scope: 'unstaged',
      })
    })

    test('calls invoke with discard_file and hunk patch', async () => {
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

    test('throws error on invoke failure', async () => {
      invokeMock.mockRejectedValueOnce(new Error('checkout failed'))

      await expect(service.discardChanges('src/test.ts')).rejects.toThrow(
        'Failed to discard changes to src/test.ts: Error: checkout failed'
      )
    })
  })
})

describe('createGitService', () => {
  test('returns MockGitService in test mode', () => {
    const service = createGitService()
    expect(service).toBeInstanceOf(MockGitService)
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
