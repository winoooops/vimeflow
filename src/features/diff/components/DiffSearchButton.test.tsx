import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiffSearchButton } from './DiffSearchButton'

const fileHeaderHidden = false

describe('DiffSearchButton', () => {
  test('renders an accessible search button and fires onOpen', async () => {
    const onOpen = vi.fn()
    render(<DiffSearchButton fileHeaderVisible onOpen={onOpen} />)

    const button = screen.getByRole('button', { name: /search in diff/i })
    await userEvent.click(button)

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('moves down while the pierre file header is visible', () => {
    const { rerender } = render(
      <DiffSearchButton fileHeaderVisible onOpen={vi.fn()} />
    )

    const button = screen.getByRole('button', { name: /search in diff/i })
    expect(button).toHaveClass('right-[22px]')
    expect(button).toHaveClass('top-10')
    expect(button).not.toHaveClass('right-[72px]')
    expect(button).not.toHaveClass('top-1')

    rerender(
      <DiffSearchButton fileHeaderVisible={fileHeaderHidden} onOpen={vi.fn()} />
    )

    expect(button).toHaveClass('right-[22px]')
    expect(button).toHaveClass('top-1')
    expect(button).not.toHaveClass('right-[72px]')
    expect(button).not.toHaveClass('top-10')
  })
})
