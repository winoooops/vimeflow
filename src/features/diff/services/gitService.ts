import type { ChangedFile, FileDiff } from '../types'
import { mockChangedFiles, mockFileDiffs } from '../data/mockDiff'
import { invoke } from '../../../lib/backend'
import { isDesktop } from '../../../lib/environment'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

/**
 * Synthesize a `GetGitDiffResponse` payload from a parsed `FileDiff`. Used by
 * `MockGitService` so tests receive the full Pierre-ready payload (parsed
 * FileDiff + oldText + newText + rawDiff). Reconstructs plausible before/after
 * file contents from the diff's hunks, preserving explicit no-newline metadata
 * when fixtures provide it. This is intentionally hunk-only content because
 * mock fixtures do not carry complete file bodies.
 */
const synthesizeDiffResponse = (fileDiff: FileDiff): GetGitDiffResponse => {
  const oldLines: DiffTextLine[] = []
  const newLines: DiffTextLine[] = []
  const rawDiffLines: string[] = []
  const changeKind = inferSyntheticChangeKind(fileDiff)
  const oldPath = fileDiff.oldPath ?? fileDiff.filePath
  const newPath = fileDiff.newPath ?? fileDiff.filePath
  const patchOldPath = changeKind === 'added' ? '/dev/null' : oldPath
  const patchNewPath = changeKind === 'deleted' ? '/dev/null' : newPath
  const [diffOldPath, diffNewPath] = diffHeaderPaths(oldPath, newPath)

  const normalizedFileDiff: GetGitDiffResponse['fileDiff'] = {
    ...fileDiff,
    oldPath: fileDiff.oldPath ?? null,
    newPath: fileDiff.newPath ?? null,
  }

  rawDiffLines.push(`diff --git ${diffOldPath} ${diffNewPath}`)
  if (changeKind === 'added') {
    rawDiffLines.push('new file mode 100644')
  } else if (changeKind === 'deleted') {
    rawDiffLines.push('deleted file mode 100644')
  }
  rawDiffLines.push(`--- ${patchSidePath('a', patchOldPath)}`)
  rawDiffLines.push(`+++ ${patchSidePath('b', patchNewPath)}`)

  for (const hunk of fileDiff.hunks) {
    rawDiffLines.push(hunk.header)
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        oldLines.push(toDiffTextLine(line))
        newLines.push(toDiffTextLine(line))
        appendRawDiffLine(rawDiffLines, ' ', line)
      } else if (line.type === 'removed') {
        oldLines.push(toDiffTextLine(line))
        appendRawDiffLine(rawDiffLines, '-', line)
      } else {
        newLines.push(toDiffTextLine(line))
        appendRawDiffLine(rawDiffLines, '+', line)
      }
    }
  }

  return {
    fileDiff: normalizedFileDiff,
    oldText: linesToText(oldLines),
    newText: linesToText(newLines),
    rawDiff: rawLinesToText(rawDiffLines),
  }
}

interface DiffTextLine {
  content: string
  hasTrailingNewline?: boolean
}

type SyntheticChangeKind = 'added' | 'deleted' | 'modified'

const NO_NEWLINE_MARKER = '\\ No newline at end of file'

const inferSyntheticChangeKind = (fileDiff: FileDiff): SyntheticChangeKind => {
  if (fileDiff.oldPath === '/dev/null') {
    return 'added'
  }

  if (fileDiff.newPath === '/dev/null') {
    return 'deleted'
  }

  const lines = fileDiff.hunks.flatMap((hunk) => hunk.lines)
  const hasAdded = lines.some((line) => line.type === 'added')
  const hasRemoved = lines.some((line) => line.type === 'removed')
  const hasContext = lines.some((line) => line.type === 'context')

  if (
    hasAdded &&
    !hasRemoved &&
    !hasContext &&
    fileDiff.hunks.every((hunk) => hunk.oldLines === 0)
  ) {
    return 'added'
  }

  if (
    hasRemoved &&
    !hasAdded &&
    !hasContext &&
    fileDiff.hunks.every((hunk) => hunk.newLines === 0)
  ) {
    return 'deleted'
  }

  return 'modified'
}

const toDiffTextLine = (line: DiffTextLine): DiffTextLine => ({
  content: line.content,
  hasTrailingNewline: line.hasTrailingNewline,
})

const appendRawDiffLine = (
  rawDiffLines: string[],
  prefix: ' ' | '-' | '+',
  line: DiffTextLine
): void => {
  rawDiffLines.push(`${prefix}${line.content}`)

  if (line.hasTrailingNewline === false) {
    rawDiffLines.push(NO_NEWLINE_MARKER)
  }
}

const linesToText = (lines: readonly DiffTextLine[]): string => {
  if (lines.length === 0) {
    return ''
  }

  const text = lines.map((line) => line.content).join('\n')
  const lastLine = lines[lines.length - 1]

  return lastLine.hasTrailingNewline === false ? text : `${text}\n`
}

const rawLinesToText = (lines: readonly string[]): string =>
  lines.length > 0 ? `${lines.join('\n')}\n` : ''

const patchSidePath = (prefix: 'a' | 'b', filePath: string): string =>
  filePath === '/dev/null' ? '/dev/null' : `${prefix}/${filePath}`

const diffHeaderPaths = (
  oldPath: string,
  newPath: string
): readonly [string, string] => {
  if (oldPath === '/dev/null') {
    return [`a/${newPath}`, `b/${newPath}`]
  }

  if (newPath === '/dev/null') {
    return [`a/${oldPath}`, `b/${oldPath}`]
  }

  return [`a/${oldPath}`, `b/${newPath}`]
}

/** Git service interface for diff operations */
export interface GitService {
  /** Get all files with git changes */
  getStatus(): Promise<ChangedFile[]>

  /**
   * Get diff for a specific file. Returns the parsed `FileDiff` plus the raw
   * before/after file contents (`oldText` / `newText`) and the unified-diff
   * text (`rawDiff`) that Pierre's renderer / hunk extractors require.
   */
  getDiff(
    file: string,
    staged?: boolean,
    untracked?: boolean
  ): Promise<GetGitDiffResponse>

  /** Stage a file or specific hunk */
  stageFile(file: string, hunkIndex?: number): Promise<void>

  /** Unstage a file or specific hunk */
  unstageFile(file: string, hunkIndex?: number): Promise<void>

  /** Discard changes to a file or hunk */
  discardChanges(file: string, hunkIndex?: number): Promise<void>
}

/** Mock implementation using static mock data (for tests) */
export class MockGitService implements GitService {
  async getStatus(): Promise<ChangedFile[]> {
    return Promise.resolve([...mockChangedFiles])
  }

  async getDiff(file: string): Promise<GetGitDiffResponse> {
    if (!(file in mockFileDiffs)) {
      throw new Error(`Diff not found for file: ${file}`)
    }

    return Promise.resolve(synthesizeDiffResponse(mockFileDiffs[file]))
  }

  async stageFile(): Promise<void> {
    return Promise.resolve()
  }

  async unstageFile(): Promise<void> {
    return Promise.resolve()
  }

  async discardChanges(): Promise<void> {
    return Promise.resolve()
  }
}

/** HTTP implementation calling Vite dev middleware (for dev) */
export class HttpGitService implements GitService {
  async getStatus(): Promise<ChangedFile[]> {
    const response = await fetch('/api/git/status')

    if (!response.ok) {
      throw new Error(`Failed to fetch git status: ${response.statusText}`)
    }

    return response.json() as Promise<ChangedFile[]>
  }

  async getDiff(
    file: string,
    staged = false,
    untracked?: boolean
  ): Promise<GetGitDiffResponse> {
    const params = new URLSearchParams({ file, staged: String(staged) })
    if (untracked !== undefined) {
      params.set('untracked', String(untracked))
    }
    const response = await fetch(`/api/git/diff?${params}`)

    if (!response.ok) {
      throw new Error(
        `Failed to fetch diff for ${file}: ${response.statusText}`
      )
    }

    return response.json() as Promise<GetGitDiffResponse>
  }

  async stageFile(file: string, hunkIndex?: number): Promise<void> {
    const response = await fetch('/api/git/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, hunkIndex }),
    })

    if (!response.ok) {
      throw new Error(`Failed to stage ${file}: ${response.statusText}`)
    }
  }

  async unstageFile(file: string, hunkIndex?: number): Promise<void> {
    const response = await fetch('/api/git/unstage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, hunkIndex }),
    })

    if (!response.ok) {
      throw new Error(`Failed to unstage ${file}: ${response.statusText}`)
    }
  }

  async discardChanges(file: string, hunkIndex?: number): Promise<void> {
    const response = await fetch('/api/git/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, hunkIndex }),
    })

    if (!response.ok) {
      throw new Error(
        `Failed to discard changes to ${file}: ${response.statusText}`
      )
    }
  }
}

/** Desktop implementation calling Rust backend via invoke() */
export class DesktopGitService implements GitService {
  private readonly cwd: string

  constructor(cwd = '.') {
    this.cwd = cwd
  }

  async getStatus(): Promise<ChangedFile[]> {
    try {
      return await invoke<ChangedFile[]>('git_status', { cwd: this.cwd })
    } catch (error) {
      throw new Error(`Failed to get git status: ${String(error)}`)
    }
  }

  async getDiff(
    file: string,
    staged = false,
    untracked?: boolean
  ): Promise<GetGitDiffResponse> {
    try {
      const args = {
        cwd: this.cwd,
        file,
        staged,
        ...(untracked !== undefined ? { untracked } : {}),
      }

      return await invoke<GetGitDiffResponse>('get_git_diff', args)
    } catch (error) {
      throw new Error(`Failed to get diff for ${file}: ${String(error)}`)
    }
  }

  stageFile(): Promise<void> {
    return Promise.reject(new Error('stageFile not implemented'))
  }

  unstageFile(): Promise<void> {
    return Promise.reject(new Error('unstageFile not implemented'))
  }

  discardChanges(): Promise<void> {
    return Promise.reject(new Error('discardChanges not implemented'))
  }
}

/** Factory function to create the appropriate GitService implementation */
export const createGitService = (cwd = '.'): GitService => {
  if (import.meta.env.MODE === 'test') {
    return new MockGitService()
  }

  // Check if running on the desktop host (Electron)
  if (isDesktop()) {
    return new DesktopGitService(cwd)
  }

  // Fallback to HTTP service (for Vite dev mode without Electron)
  return new HttpGitService()
}
