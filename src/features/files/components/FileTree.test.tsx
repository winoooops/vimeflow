import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
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

  test('tree container has no wrapper styling (inherits from parent)', () => {
    render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

    const tree = screen.getByRole('tree', { name: /file tree/i })
    // Minimal container — no background, padding, or rounding; parent controls those
    expect(tree).not.toHaveClass('bg-surface-container-low')
    expect(tree).not.toHaveClass('rounded-xl')
  })

  test('renders empty tree gracefully', () => {
    render(<FileTree nodes={[]} contextMenuActions={mockActions} />)

    const tree = screen.getByRole('tree', { name: /file tree/i })
    expect(tree).toBeInTheDocument()
    expect(tree).toBeEmptyDOMElement()
  })

  describe('keyboard navigation', () => {
    // Selection state is stored as a data attribute on the row. Testing
    // Library has no a11y query for "currently-selected custom treeitem",
    // so fall back to a scoped attribute query within the tree container.
    /* eslint-disable testing-library/no-node-access */
    const getSelectedRow = (): HTMLElement | null => {
      const tree = screen.getByRole('tree', { name: /file tree/i })

      return tree.querySelector<HTMLElement>(
        '[data-file-tree-row="true"][data-selected="true"]'
      )
    }
    /* eslint-enable testing-library/no-node-access */

    test('tree container is focusable', () => {
      render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

      const tree = screen.getByRole('tree', { name: /file tree/i })
      expect(tree).toHaveAttribute('tabindex', '0')
    })

    test('first visible row is selected on mount', () => {
      render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

      const selected = getSelectedRow()
      expect(selected).not.toBeNull()
      expect(selected?.textContent).toContain('src')
    })

    test('j moves selection to next visible row', () => {
      render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

      const tree = screen.getByRole('tree', { name: /file tree/i })
      fireEvent.keyDown(tree, { key: 'j' })

      expect(getSelectedRow()?.textContent).toContain('test.ts')
    })

    test('k moves selection to previous visible row', () => {
      render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

      const tree = screen.getByRole('tree', { name: /file tree/i })
      fireEvent.keyDown(tree, { key: 'j' })
      fireEvent.keyDown(tree, { key: 'j' })
      expect(getSelectedRow()?.textContent).toContain('README.md')

      fireEvent.keyDown(tree, { key: 'k' })
      expect(getSelectedRow()?.textContent).toContain('test.ts')
    })

    test('ArrowDown is treated as j', () => {
      render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

      const tree = screen.getByRole('tree', { name: /file tree/i })
      fireEvent.keyDown(tree, { key: 'ArrowDown' })
      expect(getSelectedRow()?.textContent).toContain('test.ts')
    })

    test('j stops at the last row', () => {
      render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

      const tree = screen.getByRole('tree', { name: /file tree/i })
      for (let i = 0; i < 10; i += 1) {
        fireEvent.keyDown(tree, { key: 'j' })
      }
      expect(getSelectedRow()?.textContent).toContain('README.md')
    })

    test('k stops at the first row', () => {
      render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

      const tree = screen.getByRole('tree', { name: /file tree/i })
      fireEvent.keyDown(tree, { key: 'k' })
      fireEvent.keyDown(tree, { key: 'k' })
      expect(getSelectedRow()?.textContent).toContain('src')
    })

    test('l activates the selected file row', () => {
      const onNodeSelect = vi.fn()
      render(
        <FileTree
          nodes={mockNodes}
          contextMenuActions={mockActions}
          onNodeSelect={onNodeSelect}
        />
      )

      const tree = screen.getByRole('tree', { name: /file tree/i })
      fireEvent.keyDown(tree, { key: 'j' })
      fireEvent.keyDown(tree, { key: 'l' })

      expect(onNodeSelect).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test.ts' }),
        expect.any(String)
      )
    })

    test('h collapses an expanded folder', () => {
      render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

      expect(screen.getByText('test.ts')).toBeInTheDocument()

      const tree = screen.getByRole('tree', { name: /file tree/i })
      fireEvent.keyDown(tree, { key: 'h' })

      expect(screen.queryByText('test.ts')).not.toBeInTheDocument()
    })

    test('h jumps to parent row when on a non-expanded row', () => {
      render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

      const tree = screen.getByRole('tree', { name: /file tree/i })
      fireEvent.keyDown(tree, { key: 'j' })
      expect(getSelectedRow()?.textContent).toContain('test.ts')

      fireEvent.keyDown(tree, { key: 'h' })
      expect(getSelectedRow()?.textContent).toContain('src')
    })

    test('scrolls the selected row into view when navigating', () => {
      const scrollSpy = vi.fn()
      const original = HTMLElement.prototype.scrollIntoView
      HTMLElement.prototype.scrollIntoView = scrollSpy

      try {
        render(<FileTree nodes={mockNodes} contextMenuActions={mockActions} />)

        const tree = screen.getByRole('tree', { name: /file tree/i })
        scrollSpy.mockClear()
        fireEvent.keyDown(tree, { key: 'j' })

        expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' })
      } finally {
        HTMLElement.prototype.scrollIntoView = original
      }
    })
  })
})
