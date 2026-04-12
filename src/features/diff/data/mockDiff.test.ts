import { describe, test, expect } from 'vitest'
import { mockChangedFiles, mockFileDiffs } from './mockDiff'

describe('Mock Diff Data', () => {
  test('mockChangedFiles contains all expected files', () => {
    expect(mockChangedFiles).toHaveLength(4)

    const paths = mockChangedFiles.map((file) => file.path)
    expect(paths).toContain('src/components/NavBar.tsx')
    expect(paths).toContain('src/components/TerminalPanel.tsx')
    expect(paths).toContain('src/utils/api-helper.rs')
    expect(paths).toContain('tsconfig.json')
  })

  test('NavBar.tsx has correct metadata', () => {
    const navBar = mockChangedFiles.find(
      (f) => f.path === 'src/components/NavBar.tsx'
    )
    expect(navBar).toBeDefined()
    expect(navBar?.status).toBe('modified')
    expect(navBar?.insertions).toBe(12)
    expect(navBar?.deletions).toBe(3)
    expect(navBar?.staged).toBe(false)
  })

  test('TerminalPanel.tsx has correct metadata', () => {
    const terminal = mockChangedFiles.find(
      (f) => f.path === 'src/components/TerminalPanel.tsx'
    )
    expect(terminal).toBeDefined()
    expect(terminal?.status).toBe('modified')
    expect(terminal?.insertions).toBe(8)
    expect(terminal?.deletions).toBe(5)
    expect(terminal?.staged).toBe(false)
  })

  test('api-helper.rs has correct metadata (added file)', () => {
    const apiHelper = mockChangedFiles.find(
      (f) => f.path === 'src/utils/api-helper.rs'
    )
    expect(apiHelper).toBeDefined()
    expect(apiHelper?.status).toBe('added')
    expect(apiHelper?.insertions).toBe(45)
    expect(apiHelper?.deletions).toBe(0)
    expect(apiHelper?.staged).toBe(true)
  })

  test('tsconfig.json has correct metadata (deleted file)', () => {
    const tsconfig = mockChangedFiles.find((f) => f.path === 'tsconfig.json')
    expect(tsconfig).toBeDefined()
    expect(tsconfig?.status).toBe('deleted')
    expect(tsconfig?.insertions).toBe(0)
    expect(tsconfig?.deletions).toBe(18)
    expect(tsconfig?.staged).toBe(false)
  })

  test('mockFileDiffs contains all expected files', () => {
    expect(Object.keys(mockFileDiffs)).toHaveLength(4)
    expect(mockFileDiffs['src/components/NavBar.tsx']).toBeDefined()
    expect(mockFileDiffs['src/components/TerminalPanel.tsx']).toBeDefined()
    expect(mockFileDiffs['src/utils/api-helper.rs']).toBeDefined()
    expect(mockFileDiffs['tsconfig.json']).toBeDefined()
  })

  test('NavBar.tsx diff has two hunks', () => {
    const diff = mockFileDiffs['src/components/NavBar.tsx']
    expect(diff.hunks).toHaveLength(2)
    expect(diff.hunks[0].id).toBe('hunk-0')
    expect(diff.hunks[1].id).toBe('hunk-1')
  })

  test('TerminalPanel.tsx diff has one hunk', () => {
    const diff = mockFileDiffs['src/components/TerminalPanel.tsx']
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].id).toBe('hunk-0')
  })

  test('api-helper.rs diff is all additions (new file)', () => {
    const diff = mockFileDiffs['src/utils/api-helper.rs']
    expect(diff.oldPath).toBe('/dev/null')
    expect(diff.newPath).toBe('src/utils/api-helper.rs')
    expect(diff.hunks).toHaveLength(1)

    const allLinesAreAdded = diff.hunks[0].lines.every(
      (line) => line.type === 'added'
    )
    expect(allLinesAreAdded).toBe(true)
  })

  test('tsconfig.json diff is all deletions (deleted file)', () => {
    const diff = mockFileDiffs['tsconfig.json']
    expect(diff.oldPath).toBe('tsconfig.json')
    expect(diff.newPath).toBe('/dev/null')
    expect(diff.hunks).toHaveLength(1)

    const allLinesAreRemoved = diff.hunks[0].lines.every(
      (line) => line.type === 'removed'
    )
    expect(allLinesAreRemoved).toBe(true)
  })

  test('diff lines have correct line numbering', () => {
    const diff = mockFileDiffs['src/components/NavBar.tsx']
    const firstHunk = diff.hunks[0]

    // Context lines should have both old and new line numbers
    const contextLines = firstHunk.lines.filter(
      (line) => line.type === 'context'
    )
    contextLines.forEach((line) => {
      expect(line.oldLineNumber).toBeDefined()
      expect(line.newLineNumber).toBeDefined()
    })

    // Added lines should only have new line numbers
    const addedLines = firstHunk.lines.filter((line) => line.type === 'added')
    addedLines.forEach((line) => {
      expect(line.oldLineNumber).toBeUndefined()
      expect(line.newLineNumber).toBeDefined()
    })

    // Removed lines should only have old line numbers
    const removedLines = firstHunk.lines.filter(
      (line) => line.type === 'removed'
    )
    removedLines.forEach((line) => {
      expect(line.oldLineNumber).toBeDefined()
      expect(line.newLineNumber).toBeUndefined()
    })
  })

  test('word-level highlights are present on some lines', () => {
    const diff = mockFileDiffs['src/components/NavBar.tsx']
    const firstHunk = diff.hunks[0]

    const linesWithHighlights = firstHunk.lines.filter(
      (line) => line.highlights && line.highlights.length > 0
    )
    expect(linesWithHighlights.length).toBeGreaterThan(0)

    // Verify highlight structure
    linesWithHighlights.forEach((line) => {
      line.highlights?.forEach((highlight) => {
        expect(highlight.start).toBeGreaterThanOrEqual(0)
        expect(highlight.end).toBeGreaterThan(highlight.start)
      })
    })
  })
})
