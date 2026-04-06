import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorStatusBar } from './EditorStatusBar'
import type { EditorStatusBarState } from '../types'

describe('EditorStatusBar', () => {
  const mockState: EditorStatusBarState = {
    vimMode: 'NORMAL',
    gitBranch: 'feat-editor-view',
    syncStatus: { behind: 2, ahead: 3 },
    fileName: 'App.tsx',
    encoding: 'UTF-8',
    language: 'TypeScript',
    cursor: { line: 42, column: 12 },
  }

  test('displays vim mode correctly', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    expect(screen.getByText(/NORMAL/i)).toBeInTheDocument()
  })

  test('displays all vim modes correctly', () => {
    const { rerender } = render(
      <EditorStatusBar state={mockState} isContextPanelOpen />
    )

    expect(screen.getByText(/NORMAL/i)).toBeInTheDocument()

    rerender(
      <EditorStatusBar
        state={{ ...mockState, vimMode: 'INSERT' }}
        isContextPanelOpen
      />
    )
    expect(screen.getByText(/INSERT/i)).toBeInTheDocument()

    rerender(
      <EditorStatusBar
        state={{ ...mockState, vimMode: 'VISUAL' }}
        isContextPanelOpen
      />
    )
    expect(screen.getByText(/VISUAL/i)).toBeInTheDocument()

    rerender(
      <EditorStatusBar
        state={{ ...mockState, vimMode: 'COMMAND' }}
        isContextPanelOpen
      />
    )
    expect(screen.getByText(/COMMAND/i)).toBeInTheDocument()
  })

  test('displays git branch', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    expect(screen.getByText('feat-editor-view')).toBeInTheDocument()
  })

  test('displays sync status with ahead and behind counts', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    // New format: "2 ↓ 3 ↑"
    expect(screen.getByText(/2 ↓ 3 ↑/)).toBeInTheDocument()
  })

  test('displays file name', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    expect(screen.getByText('App.tsx')).toBeInTheDocument()
  })

  test('displays cursor position', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    expect(screen.getByText('Ln 42, Col 12')).toBeInTheDocument()
  })

  test('displays file encoding', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    expect(screen.getByText('UTF-8')).toBeInTheDocument()
  })

  test('displays language with primary color', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    const language = screen.getByText('TypeScript')
    expect(language).toBeInTheDocument()
    expect(language).toHaveClass('text-primary')
  })

  test('applies correct styling to container when ContextPanel is open', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    const statusBar = screen.getByRole('status')

    expect(statusBar).toHaveClass('fixed')
    expect(statusBar).toHaveClass('bottom-0')
    expect(statusBar).toHaveClass('left-[308px]')
    expect(statusBar).toHaveClass('right-[280px]')
    expect(statusBar).toHaveClass('h-6')
    expect(statusBar).toHaveClass('z-30')
  })

  test('applies correct styling to container when ContextPanel is closed', () => {
    render(
      // eslint-disable-next-line react/jsx-boolean-value
      <EditorStatusBar state={mockState} isContextPanelOpen={false} />
    )

    const statusBar = screen.getByRole('status')

    expect(statusBar).toHaveClass('right-0')
    expect(statusBar).not.toHaveClass('right-[280px]')
  })

  test('vim mode indicator has distinct styling', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    const modeIndicator = screen.getByText(/NORMAL/i)

    expect(modeIndicator).toHaveClass('bg-primary')
    expect(modeIndicator).toHaveClass('text-background')
    expect(modeIndicator).toHaveClass('font-bold')
  })

  test('all status elements are visible and accessible', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    // Left section: vim mode, git branch, sync status
    expect(screen.getByText(/NORMAL/i)).toBeVisible()
    expect(screen.getByText('feat-editor-view')).toBeVisible()
    expect(screen.getByText(/2 ↓ 3 ↑/)).toBeVisible()

    // Right section: filename, encoding, language, cursor
    expect(screen.getByText('App.tsx')).toBeVisible()
    expect(screen.getByText('UTF-8')).toBeVisible()
    expect(screen.getByText('TypeScript')).toBeVisible()
    expect(screen.getByText('Ln 42, Col 12')).toBeVisible()
  })

  test('right section contains filename, encoding, language, and cursor position', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    expect(screen.getByText('App.tsx')).toBeInTheDocument()
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    expect(screen.getByText('Ln 42, Col 12')).toBeInTheDocument()
  })

  test('handles zero sync counts', () => {
    const stateWithNoSync: EditorStatusBarState = {
      ...mockState,
      syncStatus: { behind: 0, ahead: 0 },
    }

    render(<EditorStatusBar state={stateWithNoSync} isContextPanelOpen />)

    // New format: "0 ↓ 0 ↑"
    expect(screen.getByText(/0 ↓ 0 ↑/)).toBeInTheDocument()
  })

  test('uses semantic role for accessibility', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  test('displays git branch icon', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    const icon = screen.getByText('account_tree')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')
  })

  test('displays sync icon', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    const icon = screen.getByText('sync')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')
  })

  test('vim mode displays with dashes format', () => {
    render(<EditorStatusBar state={mockState} isContextPanelOpen />)

    expect(screen.getByText(/-- NORMAL --/)).toBeInTheDocument()
  })
})
