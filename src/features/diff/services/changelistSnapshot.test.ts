import { describe, expect, test, vi } from 'vitest'
import { fetchChangelistSnapshot } from './changelistSnapshot'
import type { ChangedFile, FileDiff } from '../types'

const entry = (
  path: string,
  staged: boolean,
  status: ChangedFile['status'] = 'modified'
): ChangedFile => ({
  path,
  status,
  staged,
})

const diffOf = (path: string): FileDiff => ({
  filePath: path,
  hunks: [
    {
      id: 'hunk-1-1',
      header: '@@ -1,1 +1,2 @@',
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      lines: [],
    },
  ],
})

describe('fetchChangelistSnapshot', () => {
  test('pairs a snapshot entry and a request file per ChangedFile', async () => {
    const fetchFileDiff = vi.fn(
      (path: string): Promise<FileDiff> => Promise.resolve(diffOf(path))
    )

    const result = await fetchChangelistSnapshot(
      [
        entry('src/a.ts', false),
        entry('src/a.ts', true),
        entry('new.ts', false, 'untracked'),
      ],
      fetchFileDiff,
      '/repo/'
    )

    expect(result.files).toHaveLength(3)
    expect(result.files[0]).toMatchObject({ path: 'src/a.ts', staged: false })
    expect(result.files[1]).toMatchObject({ path: 'src/a.ts', staged: true })
    expect(result.requestFiles[2]).toMatchObject({
      path: 'new.ts',
      untracked: true,
      promptPath: '/repo/new.ts',
    })
    expect(fetchFileDiff).toHaveBeenCalledWith('new.ts', false, true)
  })

  test('rejects atomically when any fetch fails', async () => {
    const fetchFileDiff = vi.fn(
      (path: string): Promise<FileDiff> =>
        path === 'bad.ts'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(diffOf(path))
    )

    await expect(
      fetchChangelistSnapshot(
        [entry('a.ts', false), entry('bad.ts', false)],
        fetchFileDiff,
        ''
      )
    ).rejects.toThrow('boom')
  })

  test('caps concurrency at 8', async () => {
    let active = 0
    let maxActive = 0

    const fetchFileDiff = vi.fn(async (path: string): Promise<FileDiff> => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1

      return diffOf(path)
    })

    const entries = Array.from({ length: 20 }, (_, i) =>
      entry(`f${i}.ts`, false)
    )
    await fetchChangelistSnapshot(entries, fetchFileDiff, '')

    expect(maxActive).toBeLessThanOrEqual(8)
  })
})
