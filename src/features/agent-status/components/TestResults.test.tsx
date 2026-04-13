import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TestResults } from './TestResults'

describe('TestResults', () => {
  test('renders correct number of pass segments', async () => {
    const user = userEvent.setup()
    render(<TestResults passed={7} failed={3} total={10} />)

    await user.click(screen.getByRole('button', { name: /tests/i }))

    const passSegments = screen.getAllByTestId('segment-pass')
    expect(passSegments).toHaveLength(7)
  })

  test('renders correct number of fail segments', async () => {
    const user = userEvent.setup()
    render(<TestResults passed={7} failed={3} total={10} />)

    await user.click(screen.getByRole('button', { name: /tests/i }))

    const failSegments = screen.getAllByTestId('segment-fail')
    expect(failSegments).toHaveLength(3)
  })

  test('shows pass/total count in header', () => {
    render(<TestResults passed={7} failed={3} total={10} />)

    expect(screen.getByText('7/10')).toBeInTheDocument()
  })

  test('shows passed and failed counts in body', async () => {
    const user = userEvent.setup()
    render(<TestResults passed={7} failed={3} total={10} />)

    await user.click(screen.getByRole('button', { name: /tests/i }))

    expect(screen.getByText('7 passed, 3 failed')).toBeInTheDocument()
  })

  test('applies success color when all tests pass', async () => {
    const user = userEvent.setup()
    render(<TestResults passed={10} failed={0} total={10} />)

    await user.click(screen.getByRole('button', { name: /tests/i }))

    const countText = screen.getByText('10 passed, 0 failed')
    expect(countText).toHaveClass('text-success')
  })

  test('applies warning color when some tests fail', async () => {
    const user = userEvent.setup()
    render(<TestResults passed={7} failed={3} total={10} />)

    await user.click(screen.getByRole('button', { name: /tests/i }))

    const countText = screen.getByText('7 passed, 3 failed')
    expect(countText).toHaveClass('text-warning')
  })
})
