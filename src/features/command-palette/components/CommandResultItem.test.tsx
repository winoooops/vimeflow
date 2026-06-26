/* eslint-disable react/jsx-boolean-value */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import type { Command } from '../types'
import { CommandResultItem } from './CommandResultItem'

describe('CommandResultItem', () => {
  const mockCommand: Command = {
    id: 'test',
    label: 'Test Command',
    icon: 'description',
  }

  test('renders with role option', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toBeInTheDocument()
  })

  test('renders icon', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const icon = screen.getByText('description')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')
  })

  test('renders verb label', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const label = screen.getByText('Test Command')
    expect(label).toBeInTheDocument()
    expect(label).toHaveClass('font-mono', 'text-primary-container')
  })

  test('renders description when present', () => {
    const commandWithDescription: Command = {
      ...mockCommand,
      description: 'This is a test description',
    }

    render(
      <CommandResultItem
        id="command-test"
        command={commandWithDescription}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const description = screen.getByText('This is a test description')
    expect(description).toBeInTheDocument()
    expect(description).toHaveClass('text-sm')
  })

  test('selected state applies bg tint and 2px left-accent border', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveClass('bg-primary-container/10')
    expect(option).toHaveClass('border-l-2')
    expect(option).toHaveClass('border-primary-container')
  })

  test('selected state applies filled icon variation', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const icon = screen.getByText('description')
    expect(icon).toHaveStyle({ fontVariationSettings: '"FILL" 1' })
    expect(icon).toHaveClass('text-primary-container')
  })

  test('unselected state applies hover background and transparent left border placeholder', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveClass('hover:bg-surface-container-highest/50')
    expect(option).not.toHaveClass('bg-primary-container/10')
    expect(option).toHaveClass('border-l-2')
    expect(option).toHaveClass('border-transparent')
  })

  test('unselected state applies outlined icon variation', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const icon = screen.getByText('description')
    expect(icon).toHaveStyle({ fontVariationSettings: '"FILL" 0' })
    expect(icon).toHaveClass('text-on-surface-variant')
  })

  test('renders shortcut chips when command.shortcut is present', () => {
    const commandWithShortcut: Command = {
      ...mockCommand,
      shortcut: ['Ctrl', 'N'],
    }

    render(
      <CommandResultItem
        id="command-test"
        command={commandWithShortcut}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(screen.getByText('Ctrl')).toBeInTheDocument()
    expect(screen.getByText('N')).toBeInTheDocument()
    expect(screen.getByTestId('command-shortcut')).toBeInTheDocument()
  })

  test('renders nothing on the right when command has no shortcut', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(screen.queryByTestId('command-shortcut')).toBeNull()
  })

  test('brightens shortcut chips on the active row', () => {
    const commandWithShortcut: Command = {
      ...mockCommand,
      shortcut: ['Ctrl', 'N'],
    }

    render(
      <CommandResultItem
        id="command-test"
        command={commandWithShortcut}
        isSelected
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const chip = screen.getByText('Ctrl')
    expect(chip).toHaveClass('text-primary-container')
    expect(chip).toHaveClass('border-primary-container/40')
  })

  test('idle shortcut chips use the variant tone', () => {
    const commandWithShortcut: Command = {
      ...mockCommand,
      shortcut: ['Ctrl', 'N'],
    }

    render(
      <CommandResultItem
        id="command-test"
        command={commandWithShortcut}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const chip = screen.getByText('Ctrl')
    expect(chip).toHaveClass('text-on-surface-variant')
    expect(chip).toHaveClass('bg-surface-container-highest')
  })

  test('aria-selected is true when selected', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveAttribute('aria-selected', 'true')
  })

  test('aria-selected is false when not selected', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveAttribute('aria-selected', 'false')
  })

  test('hover selects the row via onSelect', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onExecute = vi.fn()

    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={onSelect}
        onExecute={onExecute}
      />
    )

    await user.hover(screen.getByRole('option'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onExecute).not.toHaveBeenCalled()
  })

  test('click runs the row via onExecute', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onExecute = vi.fn()

    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={onSelect}
        onExecute={onExecute}
      />
    )

    await user.click(screen.getByRole('option'))

    expect(onExecute).toHaveBeenCalledTimes(1)
  })

  test('prevents default on mousedown to keep input focus', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const notCancelled = fireEvent.mouseDown(screen.getByRole('option'))

    expect(notCancelled).toBe(false)
  })

  test('has cursor-pointer class', () => {
    render(
      <CommandResultItem
        id="command-test"
        command={mockCommand}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveClass('cursor-pointer')
  })

  test('renders different icons correctly', () => {
    const commandWithDifferentIcon: Command = {
      ...mockCommand,
      icon: 'folder',
    }

    render(
      <CommandResultItem
        id="command-test"
        command={commandWithDifferentIcon}
        isSelected={false}
        onSelect={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    const icon = screen.getByText('folder')
    expect(icon).toBeInTheDocument()
  })
})
