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

  test('getDiff returns diff for existing file', async () => {
    const diff = await service.getDiff('src/components/NavBar.tsx')

    expect(diff).toEqual(mockFileDiffs['src/components/NavBar.tsx'])
    expect(diff.hunks).toHaveLength(2)
  })

  test('getDiff throws error for non-existent file', async () => {
    await expect(service.getDiff('non-existent.ts')).rejects.toThrow(
      'Diff not found for file: non-existent.ts'
    )
  })

  test('stageFile resolves successfully', async () => {
    await expect(service.stageFile('src/test.ts')).resolves.toBeUndefined()
  })

  test('stageFile with hunk index resolves successfully', async () => {
    await expect(service.stageFile('src/test.ts', 0)).resolves.toBeUndefined()
  })

  test('unstageFile resolves successfully', async () => {
    await expect(service.unstageFile('src/test.ts')).resolves.toBeUndefined()
  })

  test('unstageFile with hunk index resolves successfully', async () => {
    await expect(service.unstageFile('src/test.ts', 0)).resolves.toBeUndefined()
  })

  test('discardChanges resolves successfully', async () => {
    await expect(service.discardChanges('src/test.ts')).resolves.toBeUndefined()
  })

  test('discardChanges with hunk index resolves successfully', async () => {
    await expect(
      service.discardChanges('src/test.ts', 0)
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
      const mockDiff = mockFileDiffs[file]

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDiff),
      })

      const diff = await service.getDiff(file)

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/git/diff?file=${encodeURIComponent(file)}&staged=false`
      )
      expect(diff).toEqual(mockDiff)
    })

    test('includes staged parameter when true', async () => {
      const file = 'src/test.ts'

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFileDiffs[file]),
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
        json: () => Promise.resolve(mockFileDiffs[file]),
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
    test('posts to /api/git/stage with file', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.stageFile('src/test.ts')

      expect(fetchMock).toHaveBeenCalledWith('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts' }),
      })
    })

    test('posts to /api/git/stage with file and hunk index', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.stageFile('src/test.ts', 2)

      expect(fetchMock).toHaveBeenCalledWith('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts', hunkIndex: 2 }),
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
    test('posts to /api/git/unstage with file', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.unstageFile('src/test.ts')

      expect(fetchMock).toHaveBeenCalledWith('/api/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts' }),
      })
    })

    test('posts to /api/git/unstage with file and hunk index', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.unstageFile('src/test.ts', 1)

      expect(fetchMock).toHaveBeenCalledWith('/api/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts', hunkIndex: 1 }),
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
    test('posts to /api/git/discard with file', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.discardChanges('src/test.ts')

      expect(fetchMock).toHaveBeenCalledWith('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts' }),
      })
    })

    test('posts to /api/git/discard with file and hunk index', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await service.discardChanges('src/test.ts', 3)

      expect(fetchMock).toHaveBeenCalledWith('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'src/test.ts', hunkIndex: 3 }),
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
      const mockDiff = mockFileDiffs['src/components/NavBar.tsx']
      invokeMock.mockResolvedValueOnce(mockDiff)

      const diff = await service.getDiff('src/components/NavBar.tsx', false)

      expect(invokeMock).toHaveBeenCalledWith('get_git_diff', {
        cwd: '/home/user/project',
        file: 'src/components/NavBar.tsx',
        staged: false,
      })
      expect(diff).toEqual(mockDiff)
    })

    test('calls invoke with staged=true when requested', async () => {
      const mockDiff = mockFileDiffs['src/components/NavBar.tsx']
      invokeMock.mockResolvedValueOnce(mockDiff)

      await service.getDiff('src/components/NavBar.tsx', true)

      expect(invokeMock).toHaveBeenCalledWith('get_git_diff', {
        cwd: '/home/user/project',
        file: 'src/components/NavBar.tsx',
        staged: true,
      })
    })

    test('passes untracked flag to get_git_diff', async () => {
      const mockDiff = mockFileDiffs['src/components/NavBar.tsx']
      invokeMock.mockResolvedValueOnce(mockDiff)

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
    test('throws not implemented error', async () => {
      await expect(service.stageFile('src/test.ts')).rejects.toThrow(
        'stageFile not implemented'
      )
    })
  })

  describe('unstageFile', () => {
    test('throws not implemented error', async () => {
      await expect(service.unstageFile('src/test.ts')).rejects.toThrow(
        'unstageFile not implemented'
      )
    })
  })

  describe('discardChanges', () => {
    test('throws not implemented error', async () => {
      await expect(service.discardChanges('src/test.ts')).rejects.toThrow(
        'discardChanges not implemented'
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
