import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VimStatusBar } from './VimStatusBar'

describe('VimStatusBar', () => {
  test('displays vim mode correctly', () => {
    render(<VimStatusBar vimMode="NORMAL" />)

    expect(screen.getByText('-- NORMAL --')).toBeInTheDocument()
  })

  test('displays all vim modes correctly', () => {
    const { rerender } = render(<VimStatusBar vimMode="NORMAL" />)

    expect(screen.getByText('-- NORMAL --')).toBeInTheDocument()

    rerender(<VimStatusBar vimMode="INSERT" />)

    expect(screen.getByText('-- INSERT --')).toBeInTheDocument()

    rerender(<VimStatusBar vimMode="VISUAL" />)

    expect(screen.getByText('-- VISUAL --')).toBeInTheDocument()

    rerender(<VimStatusBar vimMode="COMMAND" />)

    expect(screen.getByText('-- COMMAND --')).toBeInTheDocument()
  })

  test('displays dirty indicator when isDirty is true', () => {
    render(<VimStatusBar vimMode="NORMAL" isDirty />)

    expect(screen.getByText('[+]')).toBeInTheDocument()
  })

  test('does not display dirty indicator when isDirty is false', () => {
    render(<VimStatusBar vimMode="NORMAL" />)

    expect(screen.queryByText('[+]')).not.toBeInTheDocument()
  })

  test('handles null vim mode gracefully', () => {
    render(<VimStatusBar vimMode={null} />)

    // Should still render without crashing
    expect(screen.getByTestId('vim-status-bar')).toBeInTheDocument()
  })

  test('applies correct styling to container', () => {
    render(<VimStatusBar vimMode="NORMAL" />)

    const statusBar = screen.getByTestId('vim-status-bar')

    expect(statusBar).toHaveClass('h-7')
    expect(statusBar).toHaveClass('bg-surface-container-low')
    expect(statusBar).toHaveClass('font-mono')
  })

  test('vim mode indicator has distinct styling', () => {
    render(<VimStatusBar vimMode="NORMAL" />)

    const modeIndicator = screen.getByText('-- NORMAL --')

    expect(modeIndicator).toHaveClass('bg-primary-container')
    expect(modeIndicator).toHaveClass('text-surface')
  })

  test('dirty indicator has correct styling', () => {
    render(<VimStatusBar vimMode="NORMAL" isDirty />)

    const dirtyIndicator = screen.getByText('[+]')

    expect(dirtyIndicator).toHaveClass('text-primary')
    expect(dirtyIndicator).toHaveClass('ml-2')
  })
})
