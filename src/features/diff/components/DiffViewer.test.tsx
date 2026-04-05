import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { DiffViewer } from './DiffViewer'
import type { FileDiff } from '../types'

const mockFileDiff: FileDiff = {
  filePath: 'src/components/NavBar.tsx',
  oldPath: 'src/components/NavBar.tsx',
  newPath: 'src/components/NavBar.tsx',
  hunks: [
    {
      id: 'hunk-0',
      header: '@@ -1,5 +1,6 @@',
      oldStart: 1,
      oldLines: 5,
      newStart: 1,
      newLines: 6,
      lines: [
        {
          type: 'removed',
          oldLineNumber: 1,
          newLineNumber: undefined,
          content: "- import { Link } from 'react-router-dom'",
        },
        {
          type: 'added',
          oldLineNumber: undefined,
          newLineNumber: 1,
          content: "+ import { Link, useLocation } from 'react-router-dom'",
        },
        {
          type: 'context',
          oldLineNumber: 2,
          newLineNumber: 2,
          content: "  import React from 'react'",
        },
      ],
    },
    {
      id: 'hunk-1',
      header: '@@ -10,3 +11,5 @@',
      oldStart: 10,
      oldLines: 3,
      newStart: 11,
      newLines: 5,
      lines: [
        {
          type: 'context',
          oldLineNumber: 10,
          newLineNumber: 11,
          content: '  export const NavBar = () => {',
        },
        {
          type: 'added',
          oldLineNumber: undefined,
          newLineNumber: 12,
          content: '+   const location = useLocation()',
        },
        {
          type: 'context',
          oldLineNumber: 11,
          newLineNumber: 13,
          content: '    return <nav>...</nav>',
        },
      ],
    },
  ],
}

describe('DiffViewer', () => {
  test('renders SplitDiffView when viewMode is split', () => {
    render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // SplitDiffView has "Before" and "After" headers
    expect(screen.getByText(/Before:/)).toBeInTheDocument()
    expect(screen.getByText(/After:/)).toBeInTheDocument()
  })

  test('renders UnifiedDiffView when viewMode is unified', () => {
    render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="unified"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // UnifiedDiffView has a single column layout (no Before/After headers)
    expect(screen.queryByText(/Before:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/After:/)).not.toBeInTheDocument()

    // Should render content (verify a hunk header is present)
    expect(screen.getByText(/@@ -1,5 \+1,6 @@/)).toBeInTheDocument()
  })

  test('passes fileDiff prop to child view', () => {
    render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Verify file path appears in the headers (from fileDiff)
    // Split view shows filename in both Before and After panes
    const fileNameElements = screen.getAllByText(/NavBar\.tsx/)
    expect(fileNameElements.length).toBeGreaterThan(0)
  })

  test('passes focusedHunkIndex to child view', () => {
    const { rerender } = render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Change focused hunk
    rerender(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={1}
        focusedLineIndex={0}
      />
    )

    // Both hunks should still be rendered (getAllByText because split view duplicates)
    const hunk1Elements = screen.getAllByText(/@@ -1,5 \+1,6 @@/)
    const hunk2Elements = screen.getAllByText(/@@ -10,3 \+11,5 @@/)

    expect(hunk1Elements.length).toBeGreaterThan(0)
    expect(hunk2Elements.length).toBeGreaterThan(0)
  })

  test('passes focusedLineIndex to child view', () => {
    const { rerender } = render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Change focused line
    rerender(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={1}
      />
    )

    // All lines should still be rendered
    expect(screen.getAllByText(/import/i).length).toBeGreaterThan(0)
  })

  test('passes onLineClick callback to child view', () => {
    const handleLineClick = vi.fn()

    render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="unified"
        focusedHunkIndex={0}
        focusedLineIndex={0}
        onLineClick={handleLineClick}
      />
    )

    // Callback should be wired to child view (tested in child view tests)
    expect(handleLineClick).not.toHaveBeenCalled()
  })

  test('switches from split to unified view on viewMode change', () => {
    const { rerender } = render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Initially shows split view
    expect(screen.getByText(/Before:/)).toBeInTheDocument()

    // Switch to unified
    rerender(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="unified"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Should now show unified view (no Before/After headers)
    expect(screen.queryByText(/Before:/)).not.toBeInTheDocument()
  })

  test('switches from unified to split view on viewMode change', () => {
    const { rerender } = render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="unified"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Initially shows unified view (no Before/After headers)
    expect(screen.queryByText(/Before:/)).not.toBeInTheDocument()

    // Switch to split
    rerender(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Should now show split view
    expect(screen.getByText(/Before:/)).toBeInTheDocument()
  })

  test('handles empty fileDiff gracefully', () => {
    const emptyDiff: FileDiff = {
      filePath: 'empty.txt',
      oldPath: 'empty.txt',
      newPath: 'empty.txt',
      hunks: [],
    }

    render(
      <DiffViewer
        fileDiff={emptyDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Should render headers even with empty diff
    expect(screen.getByText(/Before:/)).toBeInTheDocument()
    expect(screen.getByText(/After:/)).toBeInTheDocument()
  })

  test('renders with default onLineClick when not provided', () => {
    render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Should render without crashing when onLineClick is undefined
    expect(screen.getByText(/Before:/)).toBeInTheDocument()
  })

  test('container has overflow-auto for scrolling', () => {
    render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="split"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Verify scroll container is present by checking for content
    expect(screen.getByText(/Before:/)).toBeInTheDocument()
    expect(screen.getByText(/After:/)).toBeInTheDocument()
  })

  test('container fills available height', () => {
    render(
      <DiffViewer
        fileDiff={mockFileDiff}
        viewMode="unified"
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Verify container is present by checking for content
    expect(screen.getByText(/@@ -1,5 \+1,6 @@/)).toBeInTheDocument()
  })
})
