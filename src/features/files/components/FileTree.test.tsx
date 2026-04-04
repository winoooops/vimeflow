import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { FileTree } from './FileTree'
import type { FileNode, ContextMenuAction } from '../types'

describe('FileTree', () => {
  const mockNodes: FileNode[] = [
    {
      id: '1',
      name: 'src',
      type: 'folder',
      defaultExpanded: true,
      children: [
        {
          id: '2',
          name: 'test.ts',
          type: 'file',
          gitStatus: 'M',
        },
      ],
    },
    {
      id: '3',
      name: 'README.md',
      type: 'file',
    },
  ]

  const mockActions: ContextMenuAction[] = [
    { label: 'Rename', icon: 'edit' },
    { label: 'Delete', icon: 'delete', variant: 'danger' },
  ]

  test('renders tree container', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    const tree = screen.getByRole('tree', { name: /file tree/i })
    expect(tree).toBeInTheDocument()
  })

  test('renders all root nodes', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  test('renders expanded children', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    // src is defaultExpanded, so test.ts should be visible
    expect(screen.getByText('test.ts')).toBeInTheDocument()
  })

  test('context menu is hidden by default', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('shows context menu on right-click', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    fireEvent.contextMenu(screen.getByText('test.ts'))

    expect(
      screen.getByRole('menu', { name: /context menu/i })
    ).toBeInTheDocument()
  })

  test('context menu shows correct actions', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    fireEvent.contextMenu(screen.getByText('test.ts'))

    expect(
      screen.getByRole('menuitem', { name: /rename/i })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('menuitem', { name: /delete/i })
    ).toBeInTheDocument()
  })

  test('closes context menu on Escape', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    // Open context menu
    fireEvent.contextMenu(screen.getByText('test.ts'))
    expect(
      screen.getByRole('menu', { name: /context menu/i })
    ).toBeInTheDocument()

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('closes context menu on click outside', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    // Open context menu
    fireEvent.contextMenu(screen.getByText('test.ts'))
    expect(
      screen.getByRole('menu', { name: /context menu/i })
    ).toBeInTheDocument()

    // Click outside
    fireEvent.mouseDown(document)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('closes context menu when clicking menu item', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    // Open context menu
    fireEvent.contextMenu(screen.getByText('test.ts'))
    const renameButton = screen.getByRole('menuitem', { name: /rename/i })

    // Click menu item
    fireEvent.click(renameButton)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('has correct styling classes', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    const tree = screen.getByRole('tree', { name: /file tree/i })
    expect(tree).toHaveClass(
      'bg-surface-container-low',
      'rounded-xl',
      'p-4',
      'max-w-4xl',
      'mx-auto'
    )
  })

  test('renders empty tree gracefully', () => {
    render(<FileTree nodes={[]} contextMenuActions={mockActions} />)

    const tree = screen.getByRole('tree', { name: /file tree/i })
    expect(tree).toBeInTheDocument()
    expect(tree).toBeEmptyDOMElement()
  })
})
