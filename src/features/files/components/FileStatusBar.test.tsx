import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { FileStatusBar } from './FileStatusBar'

describe('FileStatusBar', () => {
  const defaultProps = {
    fileCount: 142,
    totalSize: '12.4 MB',
    encoding: 'UTF-8',
    gitBranch: 'main*',
    liveSyncActive: true,
  }

  test('renders status bar with role', () => {
    render(<FileStatusBar {...defaultProps} />)

    const statusBar = screen.getByRole('status', { name: /file status bar/i })
    expect(statusBar).toBeInTheDocument()
  })

  test('displays file count', () => {
    render(<FileStatusBar {...defaultProps} />)

    expect(screen.getByLabelText('142 files')).toBeInTheDocument()
  })

  test('displays total size', () => {
    render(<FileStatusBar {...defaultProps} />)

    expect(screen.getByLabelText(/total size 12.4 MB/i)).toBeInTheDocument()
  })

  test('displays encoding', () => {
    render(<FileStatusBar {...defaultProps} />)

    expect(screen.getByLabelText(/encoding UTF-8/i)).toBeInTheDocument()
  })

  test('displays git branch', () => {
    render(<FileStatusBar {...defaultProps} />)

    expect(screen.getByLabelText(/git branch main\*/i)).toBeInTheDocument()
  })

  test('displays live sync status', () => {
    render(<FileStatusBar {...defaultProps} />)

    expect(screen.getByLabelText('Live sync status')).toBeInTheDocument()
    expect(screen.getByText('Live Sync')).toBeInTheDocument()
  })

  test('shows pulse dot when live sync is active', () => {
    render(<FileStatusBar {...defaultProps} />)

    const pulseDot = screen.getByLabelText('Active')
    expect(pulseDot).toBeInTheDocument()
    expect(pulseDot).toHaveClass('animate-pulse', 'bg-secondary')
  })

  test('hides pulse dot when live sync is inactive', () => {
    render(<FileStatusBar {...defaultProps}  />)

    expect(screen.queryByLabelText('Active')).not.toBeInTheDocument()
  })

  test('has correct height class', () => {
    render(<FileStatusBar {...defaultProps} />)

    const statusBar = screen.getByRole('status', { name: /file status bar/i })
    expect(statusBar).toHaveClass('h-8')
  })

  test('has fixed positioning', () => {
    render(<FileStatusBar {...defaultProps} />)

    const statusBar = screen.getByRole('status', { name: /file status bar/i })
    expect(statusBar).toHaveClass('fixed', 'bottom-0', 'left-[308px]', 'right-[280px]')
  })
})
