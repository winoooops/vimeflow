import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  test('renders the label and reflects initial value with aria-pressed', () => {
    render(<Toggle label="Line numbers" onChange={vi.fn()} />)

    const button = screen.getByRole('button', { name: /line numbers/i })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveTextContent('check_box_outline_blank')
  })

  test('active state uses the checked glyph and primary tone', () => {
    render(<Toggle label="Sticky header" value onChange={vi.fn()} />)

    const button = screen.getByRole('button', { name: /sticky header/i })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveTextContent('check_box')
    expect(button).toHaveClass('text-primary')
  })

  test('clicking flips the value passed to onChange', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Toggle label="Background tint" onChange={handleChange} />)

    await user.click(screen.getByRole('button', { name: /background tint/i }))

    expect(handleChange).toHaveBeenCalledWith(true)
  })

  test('forwards refs to the button', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Toggle ref={ref} label="Indicators" onChange={vi.fn()} />)

    expect(ref.current).toBe(
      screen.getByRole('button', { name: /indicators/i })
    )
  })
})
