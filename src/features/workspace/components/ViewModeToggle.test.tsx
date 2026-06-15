import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { ViewModeToggle } from './ViewModeToggle'

describe('ViewModeToggle', () => {
  test('renders Reading and Source buttons', () => {
    render(<ViewModeToggle value="reading" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /reading/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /source/i })).toBeInTheDocument()
  })

  test('aria-pressed reflects the active value', () => {
    render(<ViewModeToggle value="reading" onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /reading/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    expect(screen.getByRole('button', { name: /source/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('clicking Source calls onChange with "source"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ViewModeToggle value="reading" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /source/i }))

    expect(onChange).toHaveBeenCalledWith('source')
  })

  test('clicking Reading calls onChange with "reading"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ViewModeToggle value="source" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /reading/i }))

    expect(onChange).toHaveBeenCalledWith('reading')
  })

  test('active button carries the primary-tinted tab-button classes', () => {
    render(<ViewModeToggle value="source" onChange={vi.fn()} />)

    const sourceButton = screen.getByRole('button', { name: /source/i })
    expect(sourceButton).toHaveClass('rounded-md')
    expect(sourceButton).toHaveClass('bg-primary/[0.08]')
    expect(sourceButton).toHaveClass('border-primary-container/30')
    expect(sourceButton).toHaveClass('text-primary')
  })
})
