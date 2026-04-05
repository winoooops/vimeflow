import type { ChangedFile, FileDiff } from '../types'
import { mockChangedFiles, mockFileDiffs } from '../data/mockDiff'

/** Git service interface for diff operations */
export interface GitService {
  /** Get all files with git changes */
  getStatus(): Promise<ChangedFile[]>

  /** Get diff for a specific file */
  getDiff(file: string, staged?: boolean): Promise<FileDiff>

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

  async getDiff(file: string, staged = false): Promise<FileDiff> {
    const params = new URLSearchParams({ file, staged: String(staged) })
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

/** Factory function to create the appropriate GitService implementation */
export const createGitService = (): GitService => {
  if (import.meta.env.MODE === 'test') {
    return new MockGitService()
  }

  return new HttpGitService()
}
