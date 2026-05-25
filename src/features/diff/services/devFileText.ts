import { lstat, readFile, readlink } from 'node:fs/promises'

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

    return await readFile(filePath, 'utf-8')
  } catch (err) {
    if (hasFsErrorCode(err, 'ENOENT')) {
      return ''
    }

    throw err
  }
}
