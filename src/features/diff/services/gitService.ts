import type { GitStatusResponse } from '../types'
import { invoke } from '../../../lib/backend'
import { isDesktop } from '../../../lib/environment'
import type { GetGitDiffResponse } from '../../../bindings/GetGitDiffResponse'

/** Git service interface for diff operations */
export interface GitService {
  /** Get all files with git changes and the repository toplevel. */
  getStatus(): Promise<GitStatusResponse>

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

  /**
   * Stage a file or a specific hunk. When `hunkPatch` is provided it must be
   * the full unified-diff text for a single hunk (header + diff lines) as
   * produced by `extractHunkPatch`. Omitting it stages the entire file.
   */
  stageFile(file: string, hunkPatch?: string): Promise<void>

  /**
   * Unstage a file or a specific hunk. When `hunkPatch` is provided it is
   * applied in reverse to the index. Omitting it removes the entire file from
   * the index.
   */
  unstageFile(file: string, hunkPatch?: string): Promise<void>

  /**
   * Discard working-tree changes to a file or a specific hunk. When
   * `hunkPatch` is provided it is applied in reverse to the working tree.
   * Omitting it discards all changes to the file.
   *
   * `scope` controls how much of the file's history is discarded:
   * - `'unstaged'` (default): only the working-tree edits are reverted
   *   (`git checkout -- <file>` or reverse-patch). Staged changes are kept.
   * - `'both'`: staged changes are also dropped (`git reset HEAD <file>`
   *   followed by the working-tree discard). Use this when the user
   *   discards from the STAGED view so the file returns fully to HEAD.
   *   A staged-new file (`A ` status) is removed from disk entirely.
   */
  discardChanges(
    file: string,
    hunkPatch?: string,
    scope?: 'unstaged' | 'both'
  ): Promise<void>
}

/** HTTP implementation calling Vite dev middleware (for dev) */
export class HttpGitService implements GitService {
  async getStatus(): Promise<GitStatusResponse> {
    const response = await fetch('/api/git/status')

    if (!response.ok) {
      throw new Error(`Failed to fetch git status: ${response.statusText}`)
    }

    return response.json() as Promise<GitStatusResponse>
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

  async stageFile(file: string, hunkPatch?: string): Promise<void> {
    const body: Record<string, unknown> = { file }
    if (hunkPatch !== undefined) {
      body.hunkPatch = hunkPatch
    }

    const response = await fetch('/api/git/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Failed to stage ${file}: ${response.statusText}`)
    }
  }

  async unstageFile(file: string, hunkPatch?: string): Promise<void> {
    const body: Record<string, unknown> = { file }
    if (hunkPatch !== undefined) {
      body.hunkPatch = hunkPatch
    }

    const response = await fetch('/api/git/unstage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Failed to unstage ${file}: ${response.statusText}`)
    }
  }

  async discardChanges(
    file: string,
    hunkPatch?: string,
    scope: 'unstaged' | 'both' = 'unstaged'
  ): Promise<void> {
    const body: Record<string, unknown> = { file, scope }
    if (hunkPatch !== undefined) {
      body.hunkPatch = hunkPatch
    }

    const response = await fetch('/api/git/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  async getStatus(): Promise<GitStatusResponse> {
    try {
      return await invoke<GitStatusResponse>('git_status', { cwd: this.cwd })
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

  async stageFile(file: string, hunkPatch?: string): Promise<void> {
    try {
      await invoke<void>('stage_file', {
        cwd: this.cwd,
        path: file,
        hunkPatch,
      })
    } catch (error) {
      throw new Error(`Failed to stage ${file}: ${String(error)}`)
    }
  }

  async unstageFile(file: string, hunkPatch?: string): Promise<void> {
    try {
      await invoke<void>('unstage_file', {
        cwd: this.cwd,
        path: file,
        hunkPatch,
      })
    } catch (error) {
      throw new Error(`Failed to unstage ${file}: ${String(error)}`)
    }
  }

  async discardChanges(
    file: string,
    hunkPatch?: string,
    scope: 'unstaged' | 'both' = 'unstaged'
  ): Promise<void> {
    try {
      await invoke<void>('discard_file', {
        cwd: this.cwd,
        path: file,
        hunkPatch,
        scope,
      })
    } catch (error) {
      throw new Error(`Failed to discard changes to ${file}: ${String(error)}`)
    }
  }
}

/** Factory function to create the appropriate GitService implementation */
export const createGitService = (cwd = '.'): GitService => {
  // Check if running on the desktop host (Electron)
  if (isDesktop()) {
    return new DesktopGitService(cwd)
  }

  // Fallback to HTTP service (for Vite dev mode without Electron)
  return new HttpGitService()
}
