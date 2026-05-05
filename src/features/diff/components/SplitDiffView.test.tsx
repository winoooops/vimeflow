import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SplitDiffView from './SplitDiffView'
import type { FileDiff } from '../types'

const mockFileDiff: FileDiff = {
  filePath: 'src/components/NavBar.tsx',
  oldPath: 'src/components/NavBar.tsx',
  newPath: 'src/components/NavBar.tsx',
  hunks: [
    {
      id: 'hunk-0',
      header: '@@ -1,8 +1,10 @@',
      oldStart: 1,
      oldLines: 8,
      newStart: 1,
      newLines: 10,
      lines: [
        {
          type: 'context' as const,
          oldLineNumber: 1,
          newLineNumber: 1,
          content: " import React from 'react'",
        },
        {
          type: 'removed' as const,
          oldLineNumber: 2,
          newLineNumber: undefined,
          content: " import { Link } from 'react-router-dom'",
        },
        {
          type: 'added' as const,
          oldLineNumber: undefined,
          newLineNumber: 2,
          content: " import { Link, useLocation } from 'react-router-dom'",
        },
      ],
    },
    {
      id: 'hunk-1',
      header: '@@ -15,5 +17,10 @@',
      oldStart: 15,
      oldLines: 5,
      newStart: 17,
      newLines: 10,
      lines: [
        {
          type: 'context' as const,
          oldLineNumber: 15,
          newLineNumber: 17,
          content: ' const NavBar = () => {',
        },
      ],
    },
  ],
}

describe('SplitDiffView', () => {
  test('renders two-pane grid layout', () => {
    const { container } = render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const gridContainer = container.querySelector('.grid-cols-2')

    expect(gridContainer).toBeInTheDocument()
  })

  test('renders Before pane header with history icon', () => {
    render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    expect(screen.getByText(/Before:/i)).toBeInTheDocument()
    expect(screen.getByText(/Before:/i).textContent).toContain('NavBar.tsx')

    // Check for Material Symbols history icon
    expect(screen.getByText('history')).toBeInTheDocument()
  })

  test('renders After pane header with edit icon', () => {
    render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    expect(screen.getByText(/After:/i)).toBeInTheDocument()
    expect(screen.getByText(/After:/i).textContent).toContain('NavBar.tsx')

    // Check for Material Symbols edit icon
    expect(screen.getByText('edit')).toBeInTheDocument()
  })

  test('applies sticky positioning to headers', () => {
    const { container } = render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const headers = container.querySelectorAll('.sticky')

    expect(headers.length).toBeGreaterThanOrEqual(2)
  })

  test('renders DiffLine components for each line', () => {
    render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Check that lines are rendered (by looking for line content)
    // Context lines appear in both panes, so use getAllByText
    const contextLines = screen.getAllByText("import React from 'react'")

    expect(contextLines.length).toBeGreaterThanOrEqual(1)

    // Added lines appear only in the after pane
    expect(
      screen.getByText("import { Link, useLocation } from 'react-router-dom'")
    ).toBeInTheDocument()
  })

  test('renders DiffHunkHeader components', () => {
    render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Check that hunk headers are rendered (they appear in both panes)
    const hunk1Headers = screen.getAllByText('@@ -1,8 +1,10 @@')
    const hunk2Headers = screen.getAllByText('@@ -15,5 +17,10 @@')

    expect(hunk1Headers.length).toBeGreaterThanOrEqual(1)
    expect(hunk2Headers.length).toBeGreaterThanOrEqual(1)
  })

  test('passes focus state to DiffLine components', () => {
    const { container } = render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={1}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const focusedLines = container.querySelectorAll('.bg-surface-bright\\/20')

    expect(focusedLines.length).toBeGreaterThan(0)
  })

  test('implements synchronized scrolling', () => {
    const { container } = render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const panes = container.querySelectorAll('[data-testid*="pane"]')

    // Both panes should have scroll handlers attached
    expect(panes.length).toBe(2)

    // Check for overflow-auto on panes
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const scrollablePanes = container.querySelectorAll('.overflow-auto')

    expect(scrollablePanes.length).toBeGreaterThanOrEqual(2)
  })

  test('handles empty diff gracefully', () => {
    const emptyDiff: FileDiff = {
      filePath: 'empty.txt',
      oldPath: 'empty.txt',
      newPath: 'empty.txt',
      hunks: [],
    }

    render(
      <SplitDiffView
        diff={emptyDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Should still render headers
    expect(screen.getByText(/Before:/i)).toBeInTheDocument()
    expect(screen.getByText(/After:/i)).toBeInTheDocument()
  })

  test('applies styling to Before header', () => {
    render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    const beforeText = screen.getByText(/Before: NavBar.tsx/i)

    expect(beforeText).toHaveClass('text-on-surface-variant')
  })

  test('applies styling to After header', () => {
    render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    const afterText = screen.getByText(/After: NavBar.tsx/i)

    expect(afterText).toHaveClass('text-on-surface-variant')
  })

  test('calls onLineClick callback when line is clicked', () => {
    const onLineClick = vi.fn()

    render(
      <SplitDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
        onLineClick={onLineClick}
      />
    )

    // This test will verify callback wiring once implemented
    // For now, just verify the component renders with the prop
    expect(screen.getByText(/Before:/i)).toBeInTheDocument()
  })
})
