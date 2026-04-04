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

  test('selected state applies correct background styles', () => {
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
    expect(option).toHaveClass('border')
    expect(option).toHaveClass('border-primary-container/10')
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
    expect(option).toHaveClass('hover:bg-surface-container-low/30')
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
    expect(icon).toHaveClass('text-on-surface/60')
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

    const badge = screen.getByText('↵')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('opacity-100')
  })

  test('Enter badge has group-hover opacity when not selected', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const badge = screen.getByText('↵')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('opacity-0')
    expect(badge).toHaveClass('group-hover:opacity-100')
  })

  test('Enter badge has correct styling', () => {
    const mockOnSelect = vi.fn()

    render(
      <CommandResultItem
        command={mockCommand}
        isSelected={false}
        onSelect={mockOnSelect}
      />
    )

    const badge = screen.getByText('↵')
    expect(badge).toHaveClass(
      'bg-surface-container-highest/50',
      'px-2',
      'py-1',
      'rounded',
      'text-[10px]',
      'font-bold',
      'text-on-surface/60',
      'font-mono'
    )
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
