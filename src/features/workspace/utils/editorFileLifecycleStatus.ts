import type { ChangedFile } from '../../diff/types'
import type { FileNode } from '../../files/types'

export type EditorFileLifecycleStatus = 'NEW' | 'DELETED'

export interface ResolveEditorFileLifecycleStatusInput {
  filePath: string | null
  gitStatusCwd: string
  files: ChangedFile[]
  filesCwd: string | null
  repoRoot?: string | null
  selectedFileExists?: boolean | null
}

const homePath = (): string | null => {
  if (typeof process === 'undefined') {
    return null
  }

  return process.env.HOME ?? process.env.USERPROFILE ?? null
}

export const expandTildePath = (path: string): string => {
  if (path !== '~' && !path.startsWith('~/')) {
    return path
  }

  const home = homePath()

  if (!home) {
    return path
  }

  return path === '~' ? home : `${home}${path.slice(1)}`
}

export const normalizePathForComparison = (path: string): string =>
  expandTildePath(path).replace(/\\/g, '/').replace(/\/+$/u, '')

const normalizePathSeparators = (path: string): string =>
  path.replace(/\\/g, '/').replace(/\/+$/u, '')

export const parentPathForGitStatus = (path: string | null): string | null => {
  if (!path) {
    return null
  }

  const normalizedPath = normalizePathForComparison(path)
  const parent = normalizedPath.replace(/\/[^/]*$/u, '')

  if (parent === normalizedPath || parent.length === 0) {
    return null
  }

  return parent
}

export const parentPathForFileLookup = (path: string | null): string | null => {
  if (!path) {
    return null
  }

  const normalizedPath = normalizePathSeparators(path)
  const parent = normalizedPath.replace(/\/[^/]*$/u, '')

  if (parent === normalizedPath || parent.length === 0) {
    return null
  }

  return parent
}

export const relativePathFromCwd = (
  path: string,
  cwd: string
): string | null => {
  const normalizedPath = normalizePathForComparison(path)
  const normalizedCwd = normalizePathForComparison(cwd)

  if (normalizedCwd === '') {
    return null
  }

  if (normalizedPath === normalizedCwd) {
    return ''
  }

  if (normalizedCwd === '/') {
    return normalizedPath.startsWith('/')
      ? normalizedPath.replace(/^\/+/u, '')
      : null
  }

  const cwdPrefix = `${normalizedCwd}/`

  if (!normalizedPath.startsWith(cwdPrefix)) {
    return null
  }

  return normalizedPath.slice(cwdPrefix.length)
}

export const fileNameFromPath = (path: string): string | null => {
  const normalizedPath = normalizePathForComparison(path)
  const segments = normalizedPath.split('/')
  const fileName = segments[segments.length - 1] ?? ''

  return fileName.length > 0 ? fileName : null
}

export const fileExistsInDirectory = (
  filePath: string,
  entries: readonly Pick<FileNode, 'name' | 'type'>[]
): boolean => {
  const fileName = fileNameFromPath(filePath)

  if (!fileName) {
    return false
  }

  return entries.some(
    (entry) =>
      entry.type === 'file' && entry.name.replace(/\/$/u, '') === fileName
  )
}

const NOT_FOUND_PATTERNS: readonly (string | RegExp)[] = [
  'ENOENT',
  'No such file or directory',
  /\bos error 2\b/,
  'The system cannot find the file specified',
]

/**
 * Determine whether a thrown value represents a missing file or directory.
 * The backend returns filesystem errors as bare strings; this heuristic only
 * treats clearly not-found signals as deleted so transient IPC, permission,
 * or I/O failures do not spuriously mark an existing file as deleted.
 */
export const isNotFoundError = (error: unknown): boolean => {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : ''

  return NOT_FOUND_PATTERNS.some((pattern) =>
    typeof pattern === 'string'
      ? message.includes(pattern)
      : pattern.test(message)
  )
}

/**
 * Build a stable primitive key representing the git state that is relevant to
 * a single selected file. React equality on the returned string is stable when
 * the underlying arrays change identity but the selected file's git state does
 * not, which avoids re-running existence probes on every git-watch poll.
 */
export const buildSelectedFileGitKey = (
  filePath: string | null,
  files: readonly ChangedFile[],
  filesCwd: string | null,
  repoRoot: string | null = null
): string => {
  if (!filePath) {
    return `${filesCwd ?? ''}:no-path`
  }

  const normalizedFilePath = normalizePathForComparison(filePath)

  const relativePath =
    repoRoot && repoRoot.length > 0
      ? relativePathFromCwd(filePath, repoRoot)
      : relativePathFromCwd(filePath, filesCwd ?? '')

  const changedFile = files.find(
    (file) =>
      normalizePathForComparison(file.path) === relativePath ||
      normalizePathForComparison(file.path) === normalizedFilePath
  )

  if (!changedFile) {
    return `${filesCwd ?? ''}:none`
  }

  return `${filesCwd ?? ''}:${changedFile.status}:${changedFile.staged ? 'staged' : 'unstaged'}`
}

export const resolveEditorFileLifecycleStatus = ({
  filePath,
  gitStatusCwd,
  files,
  filesCwd,
  repoRoot = null,
  selectedFileExists = null,
}: ResolveEditorFileLifecycleStatusInput): EditorFileLifecycleStatus | null => {
  if (!filePath) {
    return null
  }

  if (selectedFileExists === false) {
    return 'DELETED'
  }

  if (filesCwd !== gitStatusCwd) {
    return null
  }

  const normalizedFilePath = normalizePathForComparison(filePath)

  const relativePath =
    repoRoot && repoRoot.length > 0
      ? relativePathFromCwd(filePath, repoRoot)
      : relativePathFromCwd(filePath, gitStatusCwd)

  if (relativePath === null) {
    return null
  }

  const changedFile = files.find(
    (file) =>
      normalizePathForComparison(file.path) === relativePath ||
      normalizePathForComparison(file.path) === normalizedFilePath
  )

  if (!changedFile) {
    return null
  }

  if (changedFile.status === 'added' || changedFile.status === 'untracked') {
    return 'NEW'
  }

  if (changedFile.status === 'deleted') {
    return 'DELETED'
  }

  return null
}
