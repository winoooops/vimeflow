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

  test('calls onFileSelect when file is clicked', async () => {
    const handleFileSelect = vi.fn()
    render(<FileExplorer onFileSelect={handleFileSelect} />)

    // Wait for tree to load
    await waitFor(() => {
      expect(
        screen.getByRole('tree', { name: 'File tree' })
      ).toBeInTheDocument()
    })

    // Click on a file node (auth.ts from mock data)
    const fileNode = screen.getByText('auth.ts')
    fileNode.click()

    // Verify callback was called with file node
    expect(handleFileSelect).toHaveBeenCalledTimes(1)
    expect(handleFileSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'node-auth-ts',
        name: 'auth.ts',
        type: 'file',
      })
    )
  })

  test('does not call onFileSelect when folder is clicked', async () => {
    const handleFileSelect = vi.fn()
    render(<FileExplorer onFileSelect={handleFileSelect} />)

    // Wait for tree to load
    await waitFor(() => {
      expect(
        screen.getByRole('tree', { name: 'File tree' })
      ).toBeInTheDocument()
    })

    // Click on a folder node (src/)
    const folderNode = screen.getByText('src/')
    folderNode.click()

    // Verify callback was NOT called (folders navigate, don't select)
    expect(handleFileSelect).not.toHaveBeenCalled()
  })
})
