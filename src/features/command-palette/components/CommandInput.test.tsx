import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { CommandInput } from './CommandInput'

describe('CommandInput', () => {
  test('renders search icon', () => {
    const mockOnChange = vi.fn()

    render(<CommandInput value=":" onChange={mockOnChange} />)

    const icon = screen.getByText('search')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')
    expect(icon).toHaveClass('text-primary-container')
  })

  test('renders input with correct attributes', () => {
    const mockOnChange = vi.fn()

    render(<CommandInput value=":" onChange={mockOnChange} />)

    const input = screen.getByRole('combobox', {
      name: /command palette search/i,
    })
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('placeholder', ':')
    expect(input).toHaveAttribute('aria-label', 'Command palette search')
  })

  test('renders input with correct value', () => {
    const mockOnChange = vi.fn()

    render(<CommandInput value=":open" onChange={mockOnChange} />)

    const input = screen.getByRole('combobox', {
      name: /command palette search/i,
    })
    expect(input).toHaveValue(':open')
  })

  test('renders input with correct Tailwind classes', () => {
    const mockOnChange = vi.fn()

    render(<CommandInput value=":" onChange={mockOnChange} />)

    const input = screen.getByRole('combobox', {
      name: /command palette search/i,
    })
    expect(input).toHaveClass(
      'flex-1',
      'bg-transparent',
      'border-none',
      'outline-none',
      'text-on-surface',
      'font-medium',
      'text-lg'
    )
  })

  test('renders ESC badge', () => {
    const mockOnChange = vi.fn()

    render(<CommandInput value=":" onChange={mockOnChange} />)

    const badge = screen.getByText('ESC')
    expect(badge).toBeInTheDocument()
  })

  test('ESC badge has correct Tailwind classes', () => {
    const mockOnChange = vi.fn()

    render(<CommandInput value=":" onChange={mockOnChange} />)

    const badge = screen.getByText('ESC')
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

  test('input auto-focuses on mount', () => {
    const mockOnChange = vi.fn()

    render(<CommandInput value=":" onChange={mockOnChange} />)

    const input = screen.getByRole('combobox', {
      name: /command palette search/i,
    })
    expect(input).toHaveFocus()
  })

  test('calls onChange when user types', async () => {
    const user = userEvent.setup()

    const mockOnChange = vi.fn()

    render(<CommandInput value=":" onChange={mockOnChange} />)

    const input = screen.getByRole('combobox', {
      name: /command palette search/i,
    })

    await user.clear(input)
    await user.type(input, ':help')

    expect(mockOnChange).toHaveBeenCalled()
  })

  test('onChange receives correct value when typing', async () => {
    const user = userEvent.setup()

    const mockOnChange = vi.fn()

    render(<CommandInput value="" onChange={mockOnChange} />)

    const input = screen.getByRole('combobox', {
      name: /command palette search/i,
    })

    await user.type(input, 'h')

    // The onChange should have been called with the new value
    expect(mockOnChange).toHaveBeenCalledWith('h')
  })
})
