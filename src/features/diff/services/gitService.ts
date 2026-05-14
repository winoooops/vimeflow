import type { ChangedFile, FileDiff } from '../types'
import { mockChangedFiles, mockFileDiffs } from '../data/mockDiff'
import { invoke } from '../../../lib/backend'
import { isDesktop } from '../../../lib/environment'

/** Git service interface for diff operations */
export interface GitService {
  /** Get all files with git changes */
  getStatus(): Promise<ChangedFile[]>

  /** Get diff for a specific file */
  getDiff(
    file: string,
    staged?: boolean,
    untracked?: boolean
  ): Promise<FileDiff>

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

  async getDiff(file: string): Promise<FileDiff> {
    if (!(file in mockFileDiffs)) {
      throw new Error(`Diff not found for file: ${file}`)
    }

    return Promise.resolve(mockFileDiffs[file])
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
  ): Promise<FileDiff> {
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

    return response.json() as Promise<FileDiff>
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

/** Tauri implementation calling Rust backend via invoke() */
export class TauriGitService implements GitService {
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
  ): Promise<FileDiff> {
    try {
      const args = {
        cwd: this.cwd,
        file,
        staged,
        ...(untracked !== undefined ? { untracked } : {}),
      }

      return await invoke<FileDiff>('get_git_diff', args)
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

  // Check if running on the desktop host (Tauri today, Electron in PR-D)
  if (isDesktop()) {
    return new TauriGitService(cwd)
  }

  // Fallback to HTTP service (for Vite dev mode without Tauri)
  return new HttpGitService()
}
