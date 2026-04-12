import { describe, test, expect } from 'vitest'
import type {
  ChangedFile,
  FileDiff,
  DiffHunk,
  DiffLine,
  LineHighlight,
  DiffViewMode,
  DiffFocusTarget,
} from './index'

describe('Diff Types', () => {
  test('ChangedFile type exports correctly', () => {
    const changedFile: ChangedFile = {
      path: 'src/test.ts',
      status: 'modified',
      insertions: 10,
      deletions: 5,
      staged: false,
    }

    expect(changedFile.path).toBe('src/test.ts')
    expect(changedFile.status).toBe('modified')
    expect(changedFile.insertions).toBe(10)
    expect(changedFile.deletions).toBe(5)
    expect(changedFile.staged).toBe(false)
  })

  test('FileDiff type exports correctly', () => {
    const fileDiff: FileDiff = {
      filePath: 'src/test.ts',
      oldPath: 'src/test.ts',
      newPath: 'src/test.ts',
      hunks: [],
    }

    expect(fileDiff.filePath).toBe('src/test.ts')
    expect(fileDiff.hunks).toEqual([])
  })

  test('DiffHunk type exports correctly', () => {
    const hunk: DiffHunk = {
      id: 'hunk-0',
      header: '@@ -1,3 +1,4 @@',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      lines: [],
    }

    expect(hunk.id).toBe('hunk-0')
    expect(hunk.header).toBe('@@ -1,3 +1,4 @@')
  })

  test('DiffLine type exports correctly', () => {
    const addedLine: DiffLine = {
      type: 'added',
      newLineNumber: 5,
      content: '  console.log("added")',
    }

    const removedLine: DiffLine = {
      type: 'removed',
      oldLineNumber: 3,
      content: '  console.log("removed")',
    }

    const contextLine: DiffLine = {
      type: 'context',
      oldLineNumber: 1,
      newLineNumber: 1,
      content: 'import React from "react"',
    }

    expect(addedLine.type).toBe('added')
    expect(removedLine.type).toBe('removed')
    expect(contextLine.type).toBe('context')
  })

  test('LineHighlight type exports correctly', () => {
    const highlight: LineHighlight = {
      start: 0,
      end: 5,
    }

    expect(highlight.start).toBe(0)
    expect(highlight.end).toBe(5)
  })

  test('DiffViewMode type accepts valid values', () => {
    const splitMode: DiffViewMode = 'split'
    const unifiedMode: DiffViewMode = 'unified'

    expect(splitMode).toBe('split')
    expect(unifiedMode).toBe('unified')
  })

  test('DiffFocusTarget type accepts valid values', () => {
    const fileListFocus: DiffFocusTarget = 'fileList'
    const diffViewerFocus: DiffFocusTarget = 'diffViewer'

    expect(fileListFocus).toBe('fileList')
    expect(diffViewerFocus).toBe('diffViewer')
  })
})
