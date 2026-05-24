import type { ChangedFile, FileDiff } from '../types'
import { mockChangedFiles, mockFileDiffs } from '../data/mockDiff'
import { invoke } from '../../../lib/backend'
import { isDesktop } from '../../../lib/environment'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

/**
 * Synthesize a `GetGitDiffResponse` payload from a parsed `FileDiff`. Used by
 * `MockGitService` and `HttpGitService` (legacy `/api/git/diff` shape) so
 * callers always receive the full Pierre-ready payload (parsed FileDiff +
 * oldText + newText + rawDiff) regardless of source. Reconstructs plausible
 * before/after file contents from the diff's hunks; sufficient for tests and
 * the dev fallback path.
 */
const synthesizeDiffResponse = (fileDiff: FileDiff): GetGitDiffResponse => {
  const oldLines: string[] = []
  const newLines: string[] = []
  const rawDiffLines: string[] = []
  const oldPath = fileDiff.oldPath ?? fileDiff.filePath
  const newPath = fileDiff.newPath ?? fileDiff.filePath

  rawDiffLines.push(`--- a/${oldPath}`)
  rawDiffLines.push(`+++ b/${newPath}`)

  for (const hunk of fileDiff.hunks) {
    rawDiffLines.push(hunk.header)
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        oldLines.push(line.content)
        newLines.push(line.content)
        rawDiffLines.push(` ${line.content}`)
      } else if (line.type === 'removed') {
        oldLines.push(line.content)
        rawDiffLines.push(`-${line.content}`)
      } else {
        newLines.push(line.content)
        rawDiffLines.push(`+${line.content}`)
      }
    }
  }

  // Bindings `FileDiff` declares `oldPath: string | null` / `newPath: string |
  // null`; the local `FileDiff` declares them as optional `string | undefined`.
  // Same runtime shape (Pierre and the parser treat absent identically), but
  // ts-rs surfaces `null` so we widen the local shape to satisfy the bindings
  // contract. Task 1.10 collapses the two shapes into one.
  return {
    fileDiff: fileDiff as GetGitDiffResponse['fileDiff'],
    oldText: oldLines.join('\n'),
    newText: newLines.join('\n'),
    rawDiff: rawDiffLines.join('\n'),
  }
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
