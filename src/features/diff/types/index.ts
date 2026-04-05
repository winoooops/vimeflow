import type { GitStatus } from '../../files/types'

/** A file with git changes, used in the changed files sidebar */
export interface ChangedFile {
  path: string // e.g. 'src/components/NavBar.tsx'
  status: GitStatus // M | A | D | U (reused from files feature)
  insertions: number // +12
  deletions: number // -3
  staged: boolean // whether file is in the index
}

/** Parsed diff for a single file */
export interface FileDiff {
  filePath: string
  oldPath: string // for renames
  newPath: string
  hunks: DiffHunk[]
}

/** A single hunk within a diff */
export interface DiffHunk {
  id: string // unique identifier (e.g. 'hunk-0')
  header: string // @@ -102,7 +102,6 @@
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

/** A single line within a hunk */
export interface DiffLine {
  type: 'added' | 'removed' | 'context'
  oldLineNumber?: number // undefined for added lines
  newLineNumber?: number // undefined for removed lines
  content: string
  highlights?: LineHighlight[] // word-level diff highlights
}

/** Character range for word-level diff highlighting */
export interface LineHighlight {
  start: number
  end: number
}

/** View mode for the diff viewer */
export type DiffViewMode = 'split' | 'unified'

/** Focus target for keyboard navigation */
export type DiffFocusTarget = 'fileList' | 'diffViewer'
