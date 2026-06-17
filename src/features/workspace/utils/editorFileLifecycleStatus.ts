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
