import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { CommandFooter } from './CommandFooter'

describe('CommandFooter', () => {
  test('renders Navigate hint text', () => {
    render(<CommandFooter />)

    const navigateText = screen.getByText('Navigate')

    expect(navigateText).toBeInTheDocument()
    expect(navigateText).toHaveClass('text-sm', 'text-on-surface/60')
  })

  test('renders arrow_upward icon for navigation', () => {
    render(<CommandFooter />)

    const upArrow = screen.getByText('arrow_upward')

    expect(upArrow).toBeInTheDocument()
    expect(upArrow).toHaveClass('material-symbols-outlined')
  })

  test('renders arrow_downward icon for navigation', () => {
    render(<CommandFooter />)

    const downArrow = screen.getByText('arrow_downward')

    expect(downArrow).toBeInTheDocument()
    expect(downArrow).toHaveClass('material-symbols-outlined')
  })

  test('renders Run hint text', () => {
    render(<CommandFooter />)

    const runText = screen.getByText('Run')

    expect(runText).toBeInTheDocument()
    expect(runText).toHaveClass('text-sm', 'text-on-surface/60')
  })

  test('renders keyboard_return icon for run action', () => {
    render(<CommandFooter />)

    const returnIcon = screen.getByText('keyboard_return')

    expect(returnIcon).toBeInTheDocument()
    expect(returnIcon).toHaveClass('material-symbols-outlined')
  })

  test('does not render the removed help text', () => {
    render(<CommandFooter />)

    expect(screen.queryByText("Type '?' for help")).toBeNull()
  })

  test('Navigate text has correct styling', () => {
    render(<CommandFooter />)

    const navigateText = screen.getByText('Navigate')

    expect(navigateText).toHaveClass('text-sm')
    expect(navigateText).toHaveClass('text-on-surface/60')
  })

  test('Run text has correct styling', () => {
    render(<CommandFooter />)

    const runText = screen.getByText('Run')

    expect(runText).toHaveClass('text-sm')
    expect(runText).toHaveClass('text-on-surface/60')
  })

  test('all navigation icons have correct styling', () => {
    render(<CommandFooter />)

    const upArrow = screen.getByText('arrow_upward')
    const downArrow = screen.getByText('arrow_downward')
    const returnIcon = screen.getByText('keyboard_return')

    expect(upArrow).toHaveClass('text-sm', 'text-on-surface/60')
    expect(downArrow).toHaveClass('text-sm', 'text-on-surface/60')
    expect(returnIcon).toHaveClass('text-sm', 'text-on-surface/60')
  })
})
