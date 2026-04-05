/* eslint-disable react/jsx-boolean-value */
import { render, screen } from '@testing-library/react'
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
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toBeInTheDocument()
  })

  test('renders icon', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const icon = screen.getByText('description')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')
  })

  test('renders label', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const label = screen.getByText('Test Command')
    expect(label).toBeInTheDocument()
  })

  test('renders description when present', () => {
    const mockOnSelect = vi.fn()

    const commandWithDescription: Command = {
      ...mockCommand,
      description: 'This is a test description',
    }

    render(
      <CommandResultItem
        command={commandWithDescription}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const description = screen.getByText('This is a test description')
    expect(description).toBeInTheDocument()
    expect(description).toHaveClass('text-sm')
  })

  test('selected state applies correct background styles without border', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected
        onSelect={mockOnSelect}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveClass('bg-primary-container/10')
    expect(option).not.toHaveClass('border')
  })

  test('selected state applies filled icon variation', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected
        onSelect={mockOnSelect}
      />
    )

    const icon = screen.getByText('description')
    expect(icon).toHaveStyle({ fontVariationSettings: '"FILL" 1' })
    expect(icon).toHaveClass('text-primary-container')
  })

  test('unselected state applies hover background styles', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveClass('hover:bg-surface-container-highest/50')
    expect(option).not.toHaveClass('bg-primary-container/10')
  })

  test('unselected state applies outlined icon variation', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const icon = screen.getByText('description')
    expect(icon).toHaveStyle({ fontVariationSettings: '"FILL" 0' })
    expect(icon).toHaveClass('text-on-surface-variant')
  })

  test('Enter badge visible when selected', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected
        onSelect={mockOnSelect}
      />
    )

    const badge = screen.getByText('Enter')
    expect(badge).toBeInTheDocument()
    const icon = screen.getByText('keyboard_return')
    expect(icon).toBeInTheDocument()
  })

  test('Enter badge hidden when not selected', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const badge = screen.getByText('Enter')
    expect(badge).toBeInTheDocument()
  })

  test('Enter badge includes keyboard_return icon', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected
        onSelect={mockOnSelect}
      />
    )

    const icon = screen.getByText('keyboard_return')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')
  })

  test('aria-selected is true when selected', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected
        onSelect={mockOnSelect}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveAttribute('aria-selected', 'true')
  })

  test('aria-selected is false when not selected', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveAttribute('aria-selected', 'false')
  })

  test('calls onSelect when clicked', async () => {
    const user = userEvent.setup()

    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const option = screen.getByRole('option')

    await user.click(option)

    expect(mockOnSelect).toHaveBeenCalledTimes(1)
  })

  test('has cursor-pointer class', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const option = screen.getByRole('option')
    expect(option).toHaveClass('cursor-pointer')
  })

  test('renders different icons correctly', () => {
    const mockOnSelect = vi.fn()

    const commandWithDifferentIcon: Command = {
      ...mockCommand,
      icon: 'folder',
    }

    render(
      <CommandResultItem
        command={commandWithDifferentIcon}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const icon = screen.getByText('folder')
    expect(icon).toBeInTheDocument()
  })
})
