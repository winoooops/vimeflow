import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  test('renders the label and reflects initial value via aria-pressed', () => {
    render(<Toggle label="sticky header" onChange={vi.fn()} />)

    const button = screen.getByRole('button', { name: /sticky header/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  test('aria-pressed reflects initial true value', () => {
    render(<Toggle label="line numbers" value onChange={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /line numbers/i })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('clicking toggles aria-pressed and fires onChange with the flipped value', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    const { rerender } = render(
      <Toggle label="background tint" onChange={handleChange} />
    )

    await user.click(screen.getByRole('button', { name: /background tint/i }))
    expect(handleChange).toHaveBeenCalledTimes(1)
    expect(handleChange).toHaveBeenCalledWith(true)

    rerender(<Toggle label="background tint" value onChange={handleChange} />)

    await user.click(screen.getByRole('button', { name: /background tint/i }))
    expect(handleChange).toHaveBeenLastCalledWith(false)
  })

  test('applies the active primary style when value is true', () => {
    render(<Toggle label="file header" value onChange={vi.fn()} />)

    const button = screen.getByRole('button', { name: /file header/i })
    expect(button.className).toContain('text-primary')
  })

  test('uses check_box icon when active, check_box_outline_blank when inactive', () => {
    const { rerender } = render(
      <Toggle label="indicators" value onChange={vi.fn()} />
    )

    expect(
      screen.getByRole('button', { name: /indicators/i })
    ).toHaveTextContent('check_box')

    rerender(<Toggle label="indicators" onChange={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /indicators/i })
    ).toHaveTextContent('check_box_outline_blank')
  })
})
