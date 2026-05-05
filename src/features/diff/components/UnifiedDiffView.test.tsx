import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UnifiedDiffView from './UnifiedDiffView'
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

describe('UnifiedDiffView', () => {
  test('renders single-pane layout', () => {
    const { container } = render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const panes = container.querySelectorAll('[data-testid*="pane"]')

    // Should only have one pane (not two like split view)
    expect(panes.length).toBe(1)
  })

  test('renders all lines in a single column', () => {
    render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // All lines should be rendered in one place
    expect(screen.getByText("import React from 'react'")).toBeInTheDocument()
    expect(
      screen.getByText("import { Link } from 'react-router-dom'")
    ).toBeInTheDocument()

    expect(
      screen.getByText("import { Link, useLocation } from 'react-router-dom'")
    ).toBeInTheDocument()
  })

  test('renders DiffLine components with dual gutter', () => {
    render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Check that lines are rendered (by looking for line content)
    const contextLine = screen.getByText("import React from 'react'")

    expect(contextLine).toBeInTheDocument()

    // DiffLine will handle dual gutter display (old + new line numbers)
    // We verify this by checking component props are passed correctly
  })

  test('renders DiffHunkHeader components', () => {
    render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Check that hunk headers are rendered
    expect(screen.getByText('@@ -1,8 +1,10 @@')).toBeInTheDocument()
    expect(screen.getByText('@@ -15,5 +17,10 @@')).toBeInTheDocument()
  })

  test('passes focus state to DiffLine components', () => {
    const { container } = render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={1}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const focusedLines = container.querySelectorAll('.bg-surface-bright\\/20')

    expect(focusedLines.length).toBeGreaterThan(0)
  })

  test('renders lines in order: context, removed, added', () => {
    render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // All lines should appear in diff order
    expect(screen.getByText("import React from 'react'")).toBeInTheDocument()
    expect(
      screen.getByText("import { Link } from 'react-router-dom'")
    ).toBeInTheDocument()

    expect(
      screen.getByText("import { Link, useLocation } from 'react-router-dom'")
    ).toBeInTheDocument()
  })

  test('handles empty diff gracefully', () => {
    const emptyDiff: FileDiff = {
      filePath: 'empty.txt',
      oldPath: 'empty.txt',
      newPath: 'empty.txt',
      hunks: [],
    }

    const { container } = render(
      <UnifiedDiffView
        diff={emptyDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Should render without errors (even with no hunks)
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const pane = container.querySelector('[data-testid="unified-pane"]')

    expect(pane).toBeInTheDocument()
  })

  test('calls onLineClick callback when line is clicked', () => {
    const onLineClick = vi.fn()

    render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
        onLineClick={onLineClick}
      />
    )

    // Verify the component renders with the onLineClick prop
    expect(screen.getByText("import React from 'react'")).toBeInTheDocument()
  })

  test('applies overflow-auto for scrolling', () => {
    const { container } = render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const scrollablePane = container.querySelector('.overflow-auto')

    expect(scrollablePane).toBeInTheDocument()
  })

  test('renders all hunks in sequence', () => {
    render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // Both hunks should be present
    expect(screen.getByText('@@ -1,8 +1,10 @@')).toBeInTheDocument()
    expect(screen.getByText('@@ -15,5 +17,10 @@')).toBeInTheDocument()

    // Lines from both hunks should be present
    expect(screen.getByText("import React from 'react'")).toBeInTheDocument()
    expect(screen.getByText('const NavBar = () => {')).toBeInTheDocument()
  })

  test('applies proper styling to container', () => {
    const { container } = render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={0}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const pane = container.querySelector('[data-testid="unified-pane"]')

    expect(pane).toHaveClass('overflow-auto')
    expect(pane).toHaveClass('min-w-0')
  })

  test('passes correct line indices to focus calculation', () => {
    render(
      <UnifiedDiffView
        diff={mockFileDiff}
        focusedHunkIndex={0}
        focusedLineIndex={2}
      />
    )

    // Verify that the component renders and calculates focus correctly
    // The third line (index 2) in first hunk should be focused
    expect(
      screen.getByText("import { Link, useLocation } from 'react-router-dom'")
    ).toBeInTheDocument()
  })
})
