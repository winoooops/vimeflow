import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ContextPanelType } from '../types'
import { ContextSwitcher } from './ContextSwitcher'

describe('ContextSwitcher', () => {
  const mockOnTabChange = vi.fn()

  beforeEach(() => {
    mockOnTabChange.mockClear()
  })

  const defaultProps = {
    activeTab: 'files' as ContextPanelType,
    onTabChange: mockOnTabChange,
  }

  test('renders all three tabs', () => {
    render(<ContextSwitcher {...defaultProps} />)

    expect(screen.getByRole('button', { name: /files/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /diff/i })).toBeInTheDocument()
  })

  test('renders files tab with 📁 emoji', () => {
    render(<ContextSwitcher {...defaultProps} />)

    const filesTab = screen.getByRole('button', { name: /files/i })

    expect(filesTab.textContent).toContain('📁')
    expect(filesTab.textContent).toContain('Files')
  })

  test('renders editor tab with 📝 emoji', () => {
    render(<ContextSwitcher {...defaultProps} />)

    const editorTab = screen.getByRole('button', { name: /editor/i })

    expect(editorTab.textContent).toContain('📝')
    expect(editorTab.textContent).toContain('Editor')
  })

  test('renders diff tab with ± emoji', () => {
    render(<ContextSwitcher {...defaultProps} />)

    const diffTab = screen.getByRole('button', { name: /diff/i })

    expect(diffTab.textContent).toContain('±')
    expect(diffTab.textContent).toContain('Diff')
  })

  test('applies active styling to files tab when active', () => {
    render(<ContextSwitcher {...defaultProps} activeTab="files" />)

    const filesTab = screen.getByRole('button', { name: /files/i })

    expect(filesTab).toHaveClass('text-primary')
    expect(filesTab).toHaveClass('border-b-primary')
  })

  test('applies active styling to editor tab when active', () => {
    render(<ContextSwitcher {...defaultProps} activeTab="editor" />)

    const editorTab = screen.getByRole('button', { name: /editor/i })

    expect(editorTab).toHaveClass('text-primary')
    expect(editorTab).toHaveClass('border-b-primary')
  })

  test('applies active styling to diff tab when active', () => {
    render(<ContextSwitcher {...defaultProps} activeTab="diff" />)

    const diffTab = screen.getByRole('button', { name: /diff/i })

    expect(diffTab).toHaveClass('text-primary')
    expect(diffTab).toHaveClass('border-b-primary')
  })

  test('applies inactive styling to files tab when not active', () => {
    render(<ContextSwitcher {...defaultProps} activeTab="editor" />)

    const filesTab = screen.getByRole('button', { name: /files/i })

    expect(filesTab).toHaveClass('text-on-surface/60')
    expect(filesTab).toHaveClass('border-b-transparent')
  })

  test('applies inactive styling to editor tab when not active', () => {
    render(<ContextSwitcher {...defaultProps} activeTab="files" />)

    const editorTab = screen.getByRole('button', { name: /editor/i })

    expect(editorTab).toHaveClass('text-on-surface/60')
    expect(editorTab).toHaveClass('border-b-transparent')
  })

  test('applies inactive styling to diff tab when not active', () => {
    render(<ContextSwitcher {...defaultProps} activeTab="files" />)

    const diffTab = screen.getByRole('button', { name: /diff/i })

    expect(diffTab).toHaveClass('text-on-surface/60')
    expect(diffTab).toHaveClass('border-b-transparent')
  })

  test('calls onTabChange with files when files tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ContextSwitcher {...defaultProps} activeTab="editor" />)

    const filesTab = screen.getByRole('button', { name: /files/i })
    await user.click(filesTab)

    expect(mockOnTabChange).toHaveBeenCalledWith('files')
    expect(mockOnTabChange).toHaveBeenCalledTimes(1)
  })

  test('calls onTabChange with editor when editor tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ContextSwitcher {...defaultProps} activeTab="files" />)

    const editorTab = screen.getByRole('button', { name: /editor/i })
    await user.click(editorTab)

    expect(mockOnTabChange).toHaveBeenCalledWith('editor')
    expect(mockOnTabChange).toHaveBeenCalledTimes(1)
  })

  test('calls onTabChange with diff when diff tab is clicked', async () => {
    const user = userEvent.setup()
    render(<ContextSwitcher {...defaultProps} activeTab="files" />)

    const diffTab = screen.getByRole('button', { name: /diff/i })
    await user.click(diffTab)

    expect(mockOnTabChange).toHaveBeenCalledWith('diff')
    expect(mockOnTabChange).toHaveBeenCalledTimes(1)
  })

  test('renders tabs in a horizontal flex container', () => {
    render(<ContextSwitcher {...defaultProps} />)

    const tabRow = screen.getByTestId('context-switcher')

    expect(tabRow).toHaveClass('flex')
  })

  test('applies design tokens for background and spacing', () => {
    render(<ContextSwitcher {...defaultProps} />)

    const tabRow = screen.getByTestId('context-switcher')

    expect(tabRow).toHaveClass('bg-surface-container-low')
    // No border-b per "No-Line Rule" - structural boundaries via background color shifts
  })

  test('applies hover styles to inactive tabs', () => {
    render(<ContextSwitcher {...defaultProps} activeTab="files" />)

    const editorTab = screen.getByRole('button', { name: /editor/i })

    expect(editorTab).toHaveClass('hover:text-on-surface')
    expect(editorTab).toHaveClass('hover:bg-surface-container/30')
  })
})
