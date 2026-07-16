import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ChangeStepper, type ChangeStepperProps } from './ChangeStepper'

const renderStepper = (
  overrides: Partial<ChangeStepperProps> = {}
): ReturnType<typeof render> => {
  const baseProps: ChangeStepperProps = {
    counterText: '1/3',
    navEnabled: true,
    onPrev: vi.fn<() => void>(),
    onNext: vi.fn<() => void>(),
    previousShortcut: '[',
    previousAriaKeyshortcuts: '[',
    nextShortcut: ']',
    nextAriaKeyshortcuts: ']',
  }

  return render(<ChangeStepper {...baseProps} {...overrides} />)
}

describe('ChangeStepper', () => {
  test('renders the data_object glyph and the counter inside the labelled group', () => {
    renderStepper({ counterText: '1/3' })

    const group = screen.getByRole('group', { name: /hunk 1\/3/i })
    expect(group).toHaveTextContent('data_object')
    expect(group).toHaveTextContent('1/3')
  })

  test('renders 0/0 when there are no hunks', () => {
    renderStepper({ counterText: '0/0' })

    expect(
      screen.getByRole('group', { name: /hunk 0\/0/i })
    ).toBeInTheDocument()
  })

  test('clicking the vertical arrows fires onPrev / onNext when navEnabled', async () => {
    const user = userEvent.setup()
    const onPrev = vi.fn<() => void>()
    const onNext = vi.fn<() => void>()

    renderStepper({ navEnabled: true, onPrev, onNext })

    await user.click(screen.getByRole('button', { name: /next hunk/i }))
    expect(onNext).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /prev hunk/i }))
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  test('arrows are disabled and inert when navEnabled is false', async () => {
    const user = userEvent.setup()
    const onPrev = vi.fn<() => void>()
    const onNext = vi.fn<() => void>()

    renderStepper({ navEnabled: false, onPrev, onNext })

    const prev = screen.getByRole('button', { name: /prev hunk/i })
    const next = screen.getByRole('button', { name: /next hunk/i })
    expect(prev).toBeDisabled()
    expect(next).toBeDisabled()

    await user.click(prev)
    await user.click(next)
    expect(onPrev).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })
})
