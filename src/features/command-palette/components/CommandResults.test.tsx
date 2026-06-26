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
    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const listbox = screen.getByRole('listbox')
    expect(listbox).toBeInTheDocument()
  })

  test('renders filtered list of results', () => {
    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(screen.getByText('Open File')).toBeInTheDocument()
    expect(screen.getByText('Set Theme')).toBeInTheDocument()
    expect(screen.getByText('Help')).toBeInTheDocument()
  })

  test('renders empty list when no results', () => {
    render(
      <CommandResults
        filteredResults={[]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const listbox = screen.getByRole('listbox')

    expect(listbox).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  test('selectedIndex highlights correct item', () => {
    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={1}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const options = screen.getAllByRole('option')

    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[0]).not.toHaveClass('bg-primary-container/10')

    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveClass('bg-primary-container/10')

    expect(options[2]).toHaveAttribute('aria-selected', 'false')
    expect(options[2]).not.toHaveClass('bg-primary-container/10')
  })

  test('listbox has id for aria-controls reference', () => {
    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={1}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const listbox = screen.getByRole('listbox')

    expect(listbox).toHaveAttribute('id', 'command-palette-listbox')
  })

  test('option elements have ids for aria-activedescendant', () => {
    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const options = screen.getAllByRole('option')

    expect(options[0]).toHaveAttribute('id', 'command-cmd1')
    expect(options[1]).toHaveAttribute('id', 'command-cmd2')
    expect(options[2]).toHaveAttribute('id', 'command-cmd3')
  })

  test('calls onExecute with correct index when item clicked', async () => {
    const user = userEvent.setup()
    const onExecute = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={vi.fn()}
        onExecute={onExecute}
      />
    )

    const options = screen.getAllByRole('option')

    await user.click(options[1])

    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(onExecute).toHaveBeenCalledWith(1)
  })

  test('calls onExecute with last index when last item clicked', async () => {
    const user = userEvent.setup()
    const onExecute = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={vi.fn()}
        onExecute={onExecute}
      />
    )

    const options = screen.getAllByRole('option')

    await user.click(options[2])

    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(onExecute).toHaveBeenCalledWith(2)
  })

  test('calls onSelect with correct index when item hovered', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onExecute = vi.fn()

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={onSelect}
        onExecute={onExecute}
      />
    )

    const options = screen.getAllByRole('option')

    await user.hover(options[1])

    expect(onSelect).toHaveBeenCalledWith(1)
    expect(onExecute).not.toHaveBeenCalled()
  })

  test('scrolls the active row into view within the container only', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={2}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(scrollSpy).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    })

    scrollSpy.mockRestore()
  })

  test('does not scroll when selectedIndex is negative', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')

    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={-1}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(scrollSpy).not.toHaveBeenCalled()

    scrollSpy.mockRestore()
  })

  test('has correct Tailwind classes for dynamic-height scrolling', () => {
    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const listbox = screen.getByRole('listbox')

    expect(listbox).toHaveClass('p-[6px]', 'overflow-y-auto', 'max-h-[60vh]')
  })

  test('renders descriptions when present', () => {
    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(screen.getByText('Open a file by name')).toBeInTheDocument()
    expect(screen.getByText('Change color theme')).toBeInTheDocument()

    expect(screen.queryByText('Help description')).not.toBeInTheDocument()
  })

  test('renders icons for all commands', () => {
    render(
      <CommandResults
        filteredResults={mockCommands}
        selectedIndex={0}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(screen.getByText('description')).toBeInTheDocument()
    expect(screen.getByText('settings')).toBeInTheDocument()
    expect(screen.getByText('help')).toBeInTheDocument()
  })
})
