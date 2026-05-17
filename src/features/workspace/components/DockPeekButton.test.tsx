import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, test, expect, vi } from 'vitest'
import { DockPeekButton } from './DockPeekButton'

describe('DockPeekButton', () => {
  test('top: renders label and expand_more icon', () => {
    render(<DockPeekButton position="top" onOpen={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: /show panel docked top/i,
    })
    expect(button).toHaveTextContent(/show panel/i)
    expect(within(button).getByText('expand_more')).toBeInTheDocument()
  })

  test('bottom: renders label and expand_less icon', () => {
    render(<DockPeekButton position="bottom" onOpen={vi.fn()} />)

    const button = screen.getByRole('button', { name: /show panel/i })
    expect(button).toHaveTextContent(/show panel/i)
    expect(within(button).getByText('expand_less')).toBeInTheDocument()
  })

  test('left: renders chevron_left, no visible label', () => {
    render(<DockPeekButton position="left" onOpen={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: /show panel docked left/i,
    })
    expect(button).not.toHaveTextContent(/show panel/i)
    expect(within(button).getByText('chevron_left')).toBeInTheDocument()
  })

  test('right: renders chevron_right', () => {
    render(<DockPeekButton position="right" onOpen={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: /show panel docked right/i,
    })
    expect(within(button).getByText('chevron_right')).toBeInTheDocument()
  })

  test('clicking calls onOpen', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<DockPeekButton position="bottom" onOpen={onOpen} />)

    await user.click(screen.getByRole('button', { name: /show panel/i }))

    expect(onOpen).toHaveBeenCalled()
  })

  test('bottom: width spans full available, height is 26px', () => {
    render(<DockPeekButton position="bottom" onOpen={vi.fn()} />)

    expect(screen.getByRole('button', { name: /show panel/i })).toHaveClass(
      'h-[26px]',
      'w-full'
    )
  })

  test('top: width spans full available, height is 26px', () => {
    render(<DockPeekButton position="top" onOpen={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /show panel docked top/i })
    ).toHaveClass('h-[26px]', 'w-full')
  })

  test('left: height spans full available, width is 26px', () => {
    render(<DockPeekButton position="left" onOpen={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: /show panel docked left/i })
    ).toHaveClass('w-[26px]', 'h-full')
  })
})
