import { lstat, readFile, readlink } from 'node:fs/promises'

export const MAX_DIFF_FILE_TEXT_BYTES = 2 * 1024 * 1024

export const isExpectedMissingGitShow = (message: string): boolean =>
  message.includes('does not exist in') ||
  message.includes('exists on disk, but not in') ||
  message.includes('is in the index, but not at stage ')

const hasFsErrorCode = (err: unknown, code: string): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { readonly code?: unknown }).code === code

export const readFileTextNoFollow = async (
  filePath: string
): Promise<string> => {
  try {
    const metadata = await lstat(filePath)

    if (metadata.isSymbolicLink()) {
      return await readlink(filePath)
    }

    if (!metadata.isFile() || metadata.size > MAX_DIFF_FILE_TEXT_BYTES) {
      return ''
    }

    return await readFile(filePath, 'utf-8')
  } catch (err) {
    if (hasFsErrorCode(err, 'ENOENT')) {
      return ''
    }

    throw err
  }
}
