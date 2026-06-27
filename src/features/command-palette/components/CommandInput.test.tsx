import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { CommandInput } from './CommandInput'

describe('CommandInput', () => {
  test('renders terminal icon', () => {
    const mockOnChange = vi.fn()

    render(<CommandInput value=":" onChange={mockOnChange} />)

    const icon = screen.getByText('terminal')
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
    expect(input).toHaveAttribute(
      'placeholder',
      'type a command, : prefix, or search files…'
    )
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

  test('renders argument placeholder without changing the input value', () => {
    const mockOnChange = vi.fn()

    render(
      <CommandInput
        value=":rename-pane "
        onChange={mockOnChange}
        argumentPlaceholder="<name>"
      />
    )

    expect(screen.getByText('<name>')).toBeInTheDocument()
    expect(
      screen.getByText((_, element) => element?.textContent === ':rename-pane ')
    ).toBeInTheDocument()

    const input = screen.getByRole('combobox', {
      name: /command palette search/i,
    })

    expect(input).toHaveValue(':rename-pane ')
    expect(input).toHaveClass('text-transparent', 'caret-on-surface')
  })

  test('hides argument placeholder once args are present', () => {
    const mockOnChange = vi.fn()

    render(
      <CommandInput
        value=":rename-pane left"
        onChange={mockOnChange}
        argumentPlaceholder="<name>"
      />
    )

    expect(screen.queryByText('<name>')).toBeNull()
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
      'p-0',
      'outline-none',
      'text-on-surface',
      'font-mono',
      'text-[13.5px]',
      'leading-[18px]'
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
      'inline-flex',
      'items-center',
      'justify-center',
      'rounded-[4px]',
      'border',
      'font-mono',
      'font-semibold',
      'h-[18px]',
      'text-[10px]',
      'bg-surface-container-highest/60',
      'text-on-surface-variant',
      'border-outline-variant/60'
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
