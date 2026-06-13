import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { FileExplorer } from './FileExplorer'
import { mockFileTree } from '../../../files/data/mockFileTree'
import type { IFileSystemService } from '../../../files/services/fileSystemService'

const originalClipboard = navigator.clipboard

const createTestFileSystemService = (): IFileSystemService => ({
  listDir: vi.fn().mockResolvedValue(mockFileTree),
  readFile: vi.fn().mockResolvedValue('content'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  renamePath: vi.fn().mockResolvedValue(undefined),
  deletePath: vi.fn().mockResolvedValue(undefined),
})

const waitForFileTree = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByRole('tree', { name: 'File tree' })).toBeInTheDocument()
  })
}

describe('FileExplorer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    })
  })

  test('renders with file-explorer testid', async () => {
    render(<FileExplorer />)
    expect(screen.getByTestId('file-explorer')).toBeInTheDocument()
    await waitForFileTree()
  })

  test('fills parent height (sized by sidebar resize)', async () => {
    render(<FileExplorer />)
    const explorer = screen.getByTestId('file-explorer')
    expect(explorer).toHaveClass('h-full')
    await waitForFileTree()
  })

  test('renders FILE EXPLORER header with folder_open icon', async () => {
    render(<FileExplorer />)
    expect(screen.getByText('File Explorer')).toBeInTheDocument()
    expect(screen.getAllByText('folder_open').length).toBeGreaterThan(0)
    await waitForFileTree()
  })

  test('renders refresh button', async () => {
    render(<FileExplorer />)
    expect(
      screen.getByRole('button', { name: 'Refresh file tree' })
    ).toBeInTheDocument()
    await waitForFileTree()
  })

  test('renders FileTree after loading', async () => {
    render(<FileExplorer />)
    await waitForFileTree()
    expect(screen.getByRole('tree', { name: 'File tree' })).toBeInTheDocument()
  })

  test('calls onFileSelect with canonical full path for nested files', async () => {
    const handleFileSelect = vi.fn()
    render(<FileExplorer onFileSelect={handleFileSelect} />)

    await waitForFileTree()

    // Click a file nested under src/middleware/ — the mock tree auto-expands it.
    const fileNode = screen.getByText('auth.ts')
    fireEvent.click(fileNode)

    // The full ancestry must be preserved so the editor reads/saves the right file.
    expect(handleFileSelect).toHaveBeenCalledTimes(1)
    expect(handleFileSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '~/src/middleware/auth.ts',
        name: 'auth.ts',
        type: 'file',
      })
    )
  })

  test('calls onFileSelect with root-level path for top-level files', async () => {
    const handleFileSelect = vi.fn()
    render(<FileExplorer onFileSelect={handleFileSelect} />)

    await waitForFileTree()

    // package.json sits at the tree root under cwd `~`
    const fileNode = screen.getByText('package.json')
    fireEvent.click(fileNode)

    expect(handleFileSelect).toHaveBeenCalledTimes(1)
    expect(handleFileSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '~/package.json',
        name: 'package.json',
        type: 'file',
      })
    )
  })

  test('does not call onFileSelect when folder is clicked', async () => {
    const handleFileSelect = vi.fn()
    render(<FileExplorer onFileSelect={handleFileSelect} />)

    await waitForFileTree()

    // Click on a folder node (src/)
    const folderNode = screen.getByText('src/')
    fireEvent.click(folderNode)

    await waitFor(() => {
      expect(screen.getByText('middleware/')).toBeInTheDocument()
    })

    // Verify callback was NOT called (folders navigate, don't select)
    expect(handleFileSelect).not.toHaveBeenCalled()
  })

  test('opens a context-menu file in the editor', async () => {
    const handleFileSelect = vi.fn()
    render(<FileExplorer onFileSelect={handleFileSelect} />)

    await waitForFileTree()

    fireEvent.contextMenu(screen.getByText('package.json'))
    fireEvent.click(screen.getByRole('menuitem', { name: /open in editor/i }))

    expect(handleFileSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '~/package.json',
        name: 'package.json',
        type: 'file',
      })
    )
  })

  test('opens a context-menu file in the diff viewer', async () => {
    const handleViewDiff = vi.fn()
    render(<FileExplorer onViewDiff={handleViewDiff} />)

    await waitForFileTree()

    fireEvent.contextMenu(screen.getByText('package.json'))
    fireEvent.click(screen.getByRole('menuitem', { name: /view diff/i }))

    expect(handleViewDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '~/package.json',
        name: 'package.json',
        type: 'file',
      })
    )
  })

  test('copies the context-menu target path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<FileExplorer />)

    await waitForFileTree()

    fireEvent.contextMenu(screen.getByText('package.json'))
    fireEvent.click(screen.getByRole('menuitem', { name: /copy path/i }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('~/package.json')
    })
  })

  test('renames the context-menu target and refreshes the tree', async () => {
    const service = createTestFileSystemService()
    vi.spyOn(window, 'prompt').mockReturnValue('renamed.json')

    render(<FileExplorer fileSystemService={service} />)

    await waitForFileTree()

    fireEvent.contextMenu(screen.getByText('package.json'))
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))

    await waitFor(() => {
      expect(service.renamePath).toHaveBeenCalledWith(
        '~/package.json',
        'renamed.json'
      )
    })
    expect(service.listDir).toHaveBeenCalledTimes(2)
  })

  test('deletes the context-menu target and refreshes the tree', async () => {
    const service = createTestFileSystemService()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<FileExplorer fileSystemService={service} />)

    await waitForFileTree()

    fireEvent.contextMenu(screen.getByText('package.json'))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))

    await waitFor(() => {
      expect(service.deletePath).toHaveBeenCalledWith('~/package.json')
    })
    expect(service.listDir).toHaveBeenCalledTimes(2)
  })
})
