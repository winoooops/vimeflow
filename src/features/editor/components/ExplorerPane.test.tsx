import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { ExplorerPane } from './ExplorerPane'
import type { FileNode, ContextMenuAction } from '../types'

const mockFileTree: FileNode[] = [
  {
    id: 'node-src',
    name: 'src',
    type: 'folder',
    defaultExpanded: true,
    children: [
      {
        id: 'node-file',
        name: 'index.ts',
        type: 'file',
      },
    ],
  },
]

const mockContextMenuActions: ContextMenuAction[] = [
  { label: 'Rename', icon: 'edit' },
  { label: 'Delete', icon: 'delete', variant: 'danger' },
]

describe('ExplorerPane', () => {
  test('renders EXPLORER header label', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByText('EXPLORER')).toBeInTheDocument()
  })

  test('renders collapse button with keyboard_double_arrow_left icon', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    const button = screen.getByRole('button', { name: /collapse explorer/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveTextContent('keyboard_double_arrow_left')
  })

  test('renders file tree with provided nodes', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
  })

  test('calls onToggle when collapse button is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={onToggle}
      />
    )

    const button = screen.getByRole('button', { name: /collapse explorer/i })
    await user.click(button)

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test('applies w-64 width when isOpen is true', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    const nav = screen.getByRole('navigation', { name: /file explorer/i })
    expect(nav).toHaveClass('w-64')
    expect(nav).not.toHaveClass('w-0')
  })

  test('applies w-0 and overflow-hidden when isOpen is false', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        // eslint-disable-next-line react/jsx-boolean-value
        isOpen={false}
        onToggle={vi.fn()}
      />
    )

    const nav = screen.getByRole('navigation', { name: /file explorer/i })
    expect(nav).toHaveClass('w-0')
    expect(nav).toHaveClass('overflow-hidden')
  })

  test('applies transition-all duration-300 for smooth animation', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    const nav = screen.getByRole('navigation', { name: /file explorer/i })
    expect(nav).toHaveClass('transition-all')
    expect(nav).toHaveClass('duration-300')
  })

  test('applies glassmorphism background styling', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    const nav = screen.getByRole('navigation', { name: /file explorer/i })
    expect(nav).toHaveClass('bg-surface-container-low/50')
    expect(nav).toHaveClass('backdrop-blur-lg')
  })

  test('applies border-r with ghost border styling', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    const nav = screen.getByRole('navigation', { name: /file explorer/i })
    expect(nav).toHaveClass('border-r')
    expect(nav).toHaveClass('border-outline-variant/10')
  })

  test('header has proper text styling', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    const label = screen.getByText('EXPLORER')
    expect(label).toHaveClass('text-xs')
    expect(label).toHaveClass('font-bold')
    expect(label).toHaveClass('uppercase')
    expect(label).toHaveClass('tracking-widest')
    expect(label).toHaveClass('text-on-surface-variant/70')
  })

  test('renders file tree within the explorer pane', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    // Verify the file tree is rendered
    const tree = screen.getByRole('tree')
    expect(tree).toBeInTheDocument()
  })

  test('passes onNodeSelect callback to FileTree', async () => {
    const user = userEvent.setup()
    const onNodeSelect = vi.fn()

    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
        onNodeSelect={onNodeSelect}
      />
    )

    // Click on a file node
    const fileNode = screen.getByText('index.ts')
    await user.click(fileNode)

    expect(onNodeSelect).toHaveBeenCalledTimes(1)
    expect(onNodeSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'node-file',
        name: 'index.ts',
        type: 'file',
      })
    )
  })

  test('renders with aria-label for accessibility', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    const nav = screen.getByRole('navigation', { name: /file explorer/i })
    expect(nav).toBeInTheDocument()
  })

  test('file tree container has thin-scrollbar class', () => {
    const { container } = render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    // Find the scrollable div that contains the file tree
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const scrollableDiv = container.querySelector('.overflow-y-auto')
    expect(scrollableDiv).toHaveClass('thin-scrollbar')
  })

  test('renders reopen button that is hidden when pane is open', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        isOpen
        onToggle={vi.fn()}
      />
    )

    const reopenButton = screen.getByRole('button', {
      name: /open explorer panel/i,
    })
    expect(reopenButton).toBeInTheDocument()
    expect(reopenButton).toHaveClass('opacity-0')
    expect(reopenButton).toHaveClass('pointer-events-none')
  })

  test('reopen button is visible when pane is collapsed', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        // eslint-disable-next-line react/jsx-boolean-value
        isOpen={false}
        onToggle={vi.fn()}
      />
    )

    const reopenButton = screen.getByRole('button', {
      name: /open explorer panel/i,
    })
    expect(reopenButton).toBeInTheDocument()
    expect(reopenButton).toHaveClass('opacity-100')
  })

  test('reopen button has correct position styling', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        // eslint-disable-next-line react/jsx-boolean-value
        isOpen={false}
        onToggle={vi.fn()}
      />
    )

    const reopenButton = screen.getByRole('button', {
      name: /open explorer panel/i,
    })
    expect(reopenButton).toHaveClass('fixed')
    expect(reopenButton).toHaveClass('left-[308px]')
    expect(reopenButton).toHaveClass('top-14')
    expect(reopenButton).toHaveClass('z-30')
  })

  test('reopen button has correct size and border styling', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        // eslint-disable-next-line react/jsx-boolean-value
        isOpen={false}
        onToggle={vi.fn()}
      />
    )

    const reopenButton = screen.getByRole('button', {
      name: /open explorer panel/i,
    })
    expect(reopenButton).toHaveClass('w-6')
    expect(reopenButton).toHaveClass('h-10')
    expect(reopenButton).toHaveClass('rounded-r-lg')
    expect(reopenButton).toHaveClass('border-r')
    expect(reopenButton).toHaveClass('border-y')
  })

  test('reopen button has chevron_right icon', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        // eslint-disable-next-line react/jsx-boolean-value
        isOpen={false}
        onToggle={vi.fn()}
      />
    )

    const reopenButton = screen.getByRole('button', {
      name: /open explorer panel/i,
    })
    expect(reopenButton).toHaveTextContent('chevron_right')
  })

  test('clicking reopen button calls onToggle', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        // eslint-disable-next-line react/jsx-boolean-value
        isOpen={false}
        onToggle={onToggle}
      />
    )

    const reopenButton = screen.getByRole('button', {
      name: /open explorer panel/i,
    })
    await user.click(reopenButton)

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test('reopen button has smooth transition animation', () => {
    render(
      <ExplorerPane
        fileTree={mockFileTree}
        contextMenuActions={mockContextMenuActions}
        // eslint-disable-next-line react/jsx-boolean-value
        isOpen={false}
        onToggle={vi.fn()}
      />
    )

    const reopenButton = screen.getByRole('button', {
      name: /open explorer panel/i,
    })
    expect(reopenButton).toHaveClass('transition-all')
    expect(reopenButton).toHaveClass('duration-300')
  })
})
