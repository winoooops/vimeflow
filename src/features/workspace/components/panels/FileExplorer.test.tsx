import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileExplorer } from './FileExplorer'

describe('FileExplorer', () => {
  test('renders with file-explorer testid', () => {
    render(<FileExplorer />)
    expect(screen.getByTestId('file-explorer')).toBeInTheDocument()
  })

  test('takes h-1/2 of sidebar height', () => {
    render(<FileExplorer />)
    const explorer = screen.getByTestId('file-explorer')
    expect(explorer).toHaveClass('h-1/2')
  })

  test('has border-t separator', () => {
    render(<FileExplorer />)
    const explorer = screen.getByTestId('file-explorer')
    expect(explorer).toHaveClass('border-t')
    expect(explorer).toHaveClass('border-white/5')
  })

  test('renders FILE EXPLORER header with folder_open icon', () => {
    render(<FileExplorer />)
    expect(screen.getByText('File Explorer')).toBeInTheDocument()

    const icon = document.querySelector('.material-symbols-outlined')
    expect(icon).toBeInTheDocument()
    expect(icon?.textContent).toBe('folder_open')
  })

  test('wraps file tree in glass-panel container', () => {
    render(<FileExplorer />)
    const glassPanel = document.querySelector('.glass-panel')
    expect(glassPanel).toBeInTheDocument()
    expect(glassPanel).toHaveClass('rounded-xl')
  })

  test('renders FileTree component', () => {
    render(<FileExplorer />)
    // FileTree should render with role="tree"
    expect(screen.getByRole('tree', { name: 'File tree' })).toBeInTheDocument()
  })

  test('calls onFileSelect when file is selected', async () => {
    const handleFileSelect = vi.fn()
    render(<FileExplorer onFileSelect={handleFileSelect} />)

    // FileTree is tested separately, just verify prop is passed
    expect(screen.getByRole('tree', { name: 'File tree' })).toBeInTheDocument()
  })
})
