import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { FileTreeNode } from './FileTreeNode'
import type { FileNode } from '../types'

describe('FileTreeNode', () => {
  const mockOnContextMenu = vi.fn()

  test('renders file node', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'test.ts',
      type: 'file',
    }

    render(<FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />)

    expect(screen.getByText('test.ts')).toBeInTheDocument()
  })

  test('renders folder node', () => {
    const folderNode: FileNode = {
      id: '1',
      name: 'src',
      type: 'folder',
    }

    render(<FileTreeNode node={folderNode} onContextMenu={mockOnContextMenu} />)

    expect(screen.getByText('src')).toBeInTheDocument()
  })

  test('folder shows chevron icon', () => {
    const folderNode: FileNode = {
      id: '1',
      name: 'src',
      type: 'folder',
    }

    const { container } = render(
      <FileTreeNode node={folderNode} onContextMenu={mockOnContextMenu} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const chevron = container.querySelector('.material-symbols-outlined')
    expect(chevron).toHaveTextContent('chevron_right')
  })

  test('file does not show chevron icon', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'test.ts',
      type: 'file',
    }

    const { container } = render(
      <FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const icons = container.querySelectorAll('.material-symbols-outlined')

    const chevron = Array.from(icons).find((icon) =>
      icon.textContent?.includes('chevron_right')
    )
    expect(chevron).toBeUndefined()
  })

  test('folder expands and collapses on click', () => {
    const folderNode: FileNode = {
      id: '1',
      name: 'src',
      type: 'folder',
      children: [
        {
          id: '2',
          name: 'test.ts',
          type: 'file',
        },
      ],
    }

    render(<FileTreeNode node={folderNode} onContextMenu={mockOnContextMenu} />)

    // Initially collapsed
    expect(screen.queryByText('test.ts')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(screen.getByText('src'))
    expect(screen.getByText('test.ts')).toBeInTheDocument()

    // Click to collapse
    fireEvent.click(screen.getByText('src'))
    expect(screen.queryByText('test.ts')).not.toBeInTheDocument()
  })

  test('folder respects defaultExpanded prop', () => {
    const folderNode: FileNode = {
      id: '1',
      name: 'src',
      type: 'folder',
      defaultExpanded: true,
      children: [
        {
          id: '2',
          name: 'test.ts',
          type: 'file',
        },
      ],
    }

    render(<FileTreeNode node={folderNode} onContextMenu={mockOnContextMenu} />)

    // Should be expanded by default
    expect(screen.getByText('test.ts')).toBeInTheDocument()
  })

  test('displays git status badge for modified file', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'test.ts',
      type: 'file',
      gitStatus: 'modified',
    }

    render(<FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />)

    expect(screen.getByLabelText(/git status: modified/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/git status: modified/i)).toHaveTextContent(
      'modified'
    )
  })

  test('displays git status badge for added file', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'test.ts',
      type: 'file',
      gitStatus: 'added',
    }

    render(<FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />)

    expect(screen.getByLabelText(/git status: added/i)).toHaveTextContent(
      'added'
    )
  })

  test('displays git status badge for deleted file', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'test.ts',
      type: 'file',
      gitStatus: 'deleted',
    }

    render(<FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />)

    expect(screen.getByLabelText(/git status: deleted/i)).toHaveTextContent(
      'deleted'
    )
  })

  test('renders without drag-related visual noise', () => {
    const folderNode: FileNode = {
      id: '1',
      name: 'src',
      type: 'folder',
      isDragTarget: true,
    }

    render(<FileTreeNode node={folderNode} onContextMenu={mockOnContextMenu} />)

    // Drag badges are no longer rendered in the minimal design
    expect(screen.queryByLabelText(/drop target/i)).not.toBeInTheDocument()
  })

  test('calls onContextMenu when right-clicked', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'test.ts',
      type: 'file',
    }

    render(<FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />)

    fireEvent.contextMenu(screen.getByText('test.ts'))

    expect(mockOnContextMenu).toHaveBeenCalledTimes(1)
    expect(mockOnContextMenu).toHaveBeenCalledWith(expect.any(Object), fileNode)
  })

  test('renders TypeScript file with description icon', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'test.ts',
      type: 'file',
    }

    const { container } = render(
      <FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const icons = container.querySelectorAll('.material-symbols-outlined')

    const fileIcon = Array.from(icons).find((icon) =>
      icon.textContent?.includes('description')
    )
    expect(fileIcon).toBeDefined()
  })

  test('renders JSON file with settings icon', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'package.json',
      type: 'file',
    }

    const { container } = render(
      <FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const icons = container.querySelectorAll('.material-symbols-outlined')

    const fileIcon = Array.from(icons).find((icon) =>
      icon.textContent?.includes('settings')
    )
    expect(fileIcon).toBeDefined()
  })

  test('renders Rust file with code_blocks icon', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'main.rs',
      type: 'file',
    }

    const { container } = render(
      <FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const icons = container.querySelectorAll('.material-symbols-outlined')

    const fileIcon = Array.from(icons).find((icon) =>
      icon.textContent?.includes('code_blocks')
    )
    expect(fileIcon).toBeDefined()
  })

  test('renders nested children recursively', () => {
    const folderNode: FileNode = {
      id: '1',
      name: 'src',
      type: 'folder',
      defaultExpanded: true,
      children: [
        {
          id: '2',
          name: 'components',
          type: 'folder',
          defaultExpanded: true,
          children: [
            {
              id: '3',
              name: 'Button.tsx',
              type: 'file',
            },
          ],
        },
      ],
    }

    render(<FileTreeNode node={folderNode} onContextMenu={mockOnContextMenu} />)

    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('components')).toBeInTheDocument()
    expect(screen.getByText('Button.tsx')).toBeInTheDocument()
  })

  test('uses custom icon when provided', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'custom.file',
      type: 'file',
      icon: 'star',
    }

    const { container } = render(
      <FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const icons = container.querySelectorAll('.material-symbols-outlined')

    const fileIcon = Array.from(icons).find((icon) =>
      icon.textContent?.includes('star')
    )
    expect(fileIcon).toBeDefined()
  })

  test('has treeitem role', () => {
    const fileNode: FileNode = {
      id: '1',
      name: 'test.ts',
      type: 'file',
    }

    render(<FileTreeNode node={fileNode} onContextMenu={mockOnContextMenu} />)

    expect(screen.getByRole('treeitem')).toBeInTheDocument()
  })

  test('folder has aria-expanded attribute', () => {
    const folderNode: FileNode = {
      id: '1',
      name: 'src',
      type: 'folder',
      children: [],
    }

    render(<FileTreeNode node={folderNode} onContextMenu={mockOnContextMenu} />)

    const treeitem = screen.getByRole('treeitem')
    expect(treeitem).toHaveAttribute('aria-expanded', 'false')

    // Expand folder
    fireEvent.click(screen.getByText('src'))
    expect(treeitem).toHaveAttribute('aria-expanded', 'true')
  })
})
