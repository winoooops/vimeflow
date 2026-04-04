import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import type { Command } from '../types'
import { CommandResults } from './CommandResults'

describe('CommandResults', () => {
  const mockCommands: Command[] = [
    {
      id: 'cmd1',
      label: 'Open File',
      icon: 'description',
      description: 'Open a file by name',
    },
    {
      id: 'cmd2',
      label: 'Set Theme',
      icon: 'settings',
      description: 'Change color theme',
    },
    {
      id: 'cmd3',
      label: 'Help',
      icon: 'help',
    },
  ]

  test('renders with role listbox', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={mockOnSelect}
      />
    )

    const listbox = screen.getByRole('listbox')
    expect(listbox).toBeInTheDocument()
  })

  test('renders filtered list of results', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={mockOnSelect}
      />
    )

    // All three commands should be rendered
    expect(screen.getByText('Open File')).toBeInTheDocument()
    expect(screen.getByText('Set Theme')).toBeInTheDocument()
    expect(screen.getByText('Help')).toBeInTheDocument()
  })

  test('renders empty list when no results', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={[]}
        selectedIndex={0}
        onSelect={mockOnSelect}
      />
    )

    const listbox = screen.getByRole('listbox')

    expect(listbox).toBeInTheDocument()
    // No options should be rendered
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  test('selectedIndex highlights correct item', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={1}
        onSelect={mockOnSelect}
      />
    )

    const options = screen.getAllByRole('option')

    // First item should NOT be selected
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[0]).not.toHaveClass('bg-primary-container/10')

    // Second item SHOULD be selected
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveClass('bg-primary-container/10')

    // Third item should NOT be selected
    expect(options[2]).toHaveAttribute('aria-selected', 'false')
    expect(options[2]).not.toHaveClass('bg-primary-container/10')
  })

  test('aria-activedescendant points to selected item', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={1}
        onSelect={mockOnSelect}
      />
    )

    const listbox = screen.getByRole('listbox')

    expect(listbox).toHaveAttribute('aria-activedescendant', 'command-cmd2')
  })

  test('aria-activedescendant is undefined when no results', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={[]}
        selectedIndex={0}
        onSelect={mockOnSelect}
      />
    )

    const listbox = screen.getByRole('listbox')

    expect(listbox).not.toHaveAttribute('aria-activedescendant')
  })

  test('aria-activedescendant is undefined when selectedIndex out of bounds', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={99}
        onSelect={mockOnSelect}
      />
    )

    const listbox = screen.getByRole('listbox')

    expect(listbox).not.toHaveAttribute('aria-activedescendant')
  })

  test('calls onSelect with correct index when item clicked', async () => {
    const user = userEvent.setup()

    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={mockOnSelect}
      />
    )

    const options = screen.getAllByRole('option')

    // Click the second item
    await user.click(options[1])

    expect(mockOnSelect).toHaveBeenCalledTimes(1)
    expect(mockOnSelect).toHaveBeenCalledWith(1)
  })

  test('calls onSelect with correct index when first item clicked', async () => {
    const user = userEvent.setup()

    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={1}
        onSelect={mockOnSelect}
      />
    )

    const options = screen.getAllByRole('option')

    // Click the first item
    await user.click(options[0])

    expect(mockOnSelect).toHaveBeenCalledTimes(1)
    expect(mockOnSelect).toHaveBeenCalledWith(0)
  })

  test('calls onSelect with correct index when last item clicked', async () => {
    const user = userEvent.setup()

    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={mockOnSelect}
      />
    )

    const options = screen.getAllByRole('option')

    // Click the last item
    await user.click(options[2])

    expect(mockOnSelect).toHaveBeenCalledTimes(1)
    expect(mockOnSelect).toHaveBeenCalledWith(2)
  })

  test('has correct Tailwind classes for scrolling', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={mockOnSelect}
      />
    )

    const listbox = screen.getByRole('listbox')

    expect(listbox).toHaveClass('p-2', 'overflow-y-auto', 'max-h-96')
  })

  test('renders descriptions when present', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={mockOnSelect}
      />
    )

    // First two commands have descriptions
    expect(screen.getByText('Open a file by name')).toBeInTheDocument()
    expect(screen.getByText('Change color theme')).toBeInTheDocument()

    // Third command has no description
    expect(screen.queryByText('Help description')).not.toBeInTheDocument()
  })

  test('renders icons for all commands', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={mockOnSelect}
      />
    )

    expect(screen.getByText('description')).toBeInTheDocument()
    expect(screen.getByText('settings')).toBeInTheDocument()
    expect(screen.getByText('help')).toBeInTheDocument()
  })
})
