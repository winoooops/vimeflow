import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuAction } from '../types'

describe('ContextMenu', () => {
  const mockActions: ContextMenuAction[] = [
    { label: 'Rename', icon: 'edit' },
    { label: 'Delete', icon: 'delete', variant: 'danger' },
    { label: '', icon: '', separator: true },
    { label: 'Copy Path', icon: 'content_copy' },
    { label: 'Open in Editor', icon: 'open_in_new' },
    { label: 'View Diff', icon: 'difference' },
  ]

  const defaultProps = {
    visible: true,
    x: 100,
    y: 200,
    actions: mockActions,
    onClose: vi.fn(),
  }

  test('renders menu when visible', () => {
    render(<ContextMenu {...defaultProps} />)

    const menu = screen.getByRole('menu', { name: /context menu/i })
    expect(menu).toBeInTheDocument()
  })

  test('does not render when not visible', () => {
    render(<ContextMenu {...defaultProps}  />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('renders all action items', () => {
    render(<ContextMenu {...defaultProps} />)

    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /copy path/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /open in editor/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /view diff/i })).toBeInTheDocument()
  })

  test('renders separator', () => {
    render(<ContextMenu {...defaultProps} />)

    const separators = screen.getAllByRole('separator')
    expect(separators).toHaveLength(1)
  })

  test('positions menu at specified coordinates', () => {
    render(<ContextMenu {...defaultProps} />)

    const menu = screen.getByRole('menu', { name: /context menu/i })
    expect(menu).toHaveStyle({ left: '100px', top: '200px' })
  })

  test('danger variant has error styling', () => {
    render(<ContextMenu {...defaultProps} />)

    const deleteButton = screen.getByRole('menuitem', { name: /delete/i })
    expect(deleteButton).toHaveClass('text-error', 'hover:bg-error/20')
  })

  test('non-danger items have normal styling', () => {
    render(<ContextMenu {...defaultProps} />)

    const renameButton = screen.getByRole('menuitem', { name: /rename/i })
    expect(renameButton).toHaveClass('text-on-surface')
    expect(renameButton).not.toHaveClass('text-error')
  })

  test('closes menu when clicking menu item', () => {
    const onClose = vi.fn()
    render(<ContextMenu {...defaultProps} onClose={onClose} />)

    const renameButton = screen.getByRole('menuitem', { name: /rename/i })
    fireEvent.click(renameButton)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('closes menu on Escape key', () => {
    const onClose = vi.fn()
    render(<ContextMenu {...defaultProps} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('closes menu when clicking outside', () => {
    const onClose = vi.fn()
    render(<ContextMenu {...defaultProps} onClose={onClose} />)

    fireEvent.mouseDown(document)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('does not close when clicking inside menu', () => {
    const onClose = vi.fn()
    render(<ContextMenu {...defaultProps} onClose={onClose} />)

    const menu = screen.getByRole('menu', { name: /context menu/i })
    fireEvent.mouseDown(menu)

    expect(onClose).not.toHaveBeenCalled()
  })

  test('has glassmorphism styling', () => {
    render(<ContextMenu {...defaultProps} />)

    const menu = screen.getByRole('menu', { name: /context menu/i })
    expect(menu).toHaveClass('backdrop-blur-[16px]', 'bg-surface-container-highest/80')
  })

  test('has correct width', () => {
    render(<ContextMenu {...defaultProps} />)

    const menu = screen.getByRole('menu', { name: /context menu/i })
    expect(menu).toHaveClass('w-48')
  })
})
