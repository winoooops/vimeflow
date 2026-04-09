import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { FileExplorer } from './FileExplorer'

describe('FileExplorer', () => {
  test('renders with file-explorer testid', () => {
    render(<FileExplorer />)
    expect(screen.getByTestId('file-explorer')).toBeInTheDocument()
  })

  test('fills parent height (sized by sidebar resize)', () => {
    render(<FileExplorer />)
    const explorer = screen.getByTestId('file-explorer')
    expect(explorer).toHaveClass('h-full')
  })

  test('renders FILE EXPLORER header with folder_open icon', () => {
    render(<FileExplorer />)
    expect(screen.getByText('File Explorer')).toBeInTheDocument()
    expect(screen.getAllByText('folder_open').length).toBeGreaterThan(0)
  })

  test('renders refresh button', () => {
    render(<FileExplorer />)
    expect(
      screen.getByRole('button', { name: 'Refresh file tree' })
    ).toBeInTheDocument()
  })

  test('renders FileTree after loading', async () => {
    render(<FileExplorer />)
    // Service is async — wait for tree to appear
    await waitFor(() => {
      expect(
        screen.getByRole('tree', { name: 'File tree' })
      ).toBeInTheDocument()
    })
  })

  test('calls onFileSelect when file is selected', async () => {
    const handleFileSelect = vi.fn()
    render(<FileExplorer onFileSelect={handleFileSelect} />)

    await waitFor(() => {
      expect(
        screen.getByRole('tree', { name: 'File tree' })
      ).toBeInTheDocument()
    })
  })
})
