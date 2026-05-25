import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  isExpectedMissingGitShow,
  MAX_DIFF_FILE_TEXT_BYTES,
  readFileTextNoFollow,
} from './devFileText'

let tempDir: string | null = null

const makeTempDir = async (): Promise<string> => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'vimeflow-diff-'))

  return tempDir
}

afterEach(async () => {
  if (tempDir !== null) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('readFileTextNoFollow', () => {
  test('reads regular file text', async () => {
    const dir = await makeTempDir()
    const filePath = path.join(dir, 'file.txt')
    await writeFile(filePath, 'regular contents\n')

    await expect(readFileTextNoFollow(filePath)).resolves.toBe(
      'regular contents\n'
    )
  })

  test('returns empty text for missing files', async () => {
    const dir = await makeTempDir()

    await expect(
      readFileTextNoFollow(path.join(dir, 'missing.txt'))
    ).resolves.toBe('')
  })

  test('returns symlink target text without reading target contents', async () => {
    const dir = await makeTempDir()
    const targetPath = path.join(dir, 'target.txt')
    const linkPath = path.join(dir, 'link.txt')
    await writeFile(targetPath, 'outside secret\n')
    await symlink(targetPath, linkPath)

    await expect(readFileTextNoFollow(linkPath)).resolves.toBe(targetPath)
  })

  test('returns empty text for oversized regular files', async () => {
    const dir = await makeTempDir()
    const filePath = path.join(dir, 'large.bin')
    await writeFile(filePath, Buffer.alloc(MAX_DIFF_FILE_TEXT_BYTES + 1, 97))

    await expect(readFileTextNoFollow(filePath)).resolves.toBe('')
  })
})

describe('isExpectedMissingGitShow', () => {
  test('treats missing index stages as non-fatal git show misses', () => {
    expect(
      isExpectedMissingGitShow(
        "fatal: path 'conflict.txt' is in the index, but not at stage 0"
      )
    ).toBe(true)

    expect(
      isExpectedMissingGitShow(
        "fatal: path 'conflict.txt' is in the index, but not at stage 2"
      )
    ).toBe(true)
  })
})
