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

  test('renders Select hint text', () => {
    render(<CommandFooter />)

    const selectText = screen.getByText('Select')

    expect(selectText).toBeInTheDocument()
    expect(selectText).toHaveClass('text-sm', 'text-on-surface/60')
  })

  test('renders keyboard_return icon for select action', () => {
    render(<CommandFooter />)

    const returnIcon = screen.getByText('keyboard_return')

    expect(returnIcon).toBeInTheDocument()
    expect(returnIcon).toHaveClass('material-symbols-outlined')
  })

  test('renders help text', () => {
    render(<CommandFooter />)

    const helpText = screen.getByText("Type '?' for help")

    expect(helpText).toBeInTheDocument()
    expect(helpText).toHaveClass('text-sm', 'text-primary-container/60')
  })

  test('Navigate text has correct styling', () => {
    render(<CommandFooter />)

    const navigateText = screen.getByText('Navigate')

    expect(navigateText).toHaveClass('text-sm')
    expect(navigateText).toHaveClass('text-on-surface/60')
  })

  test('Select text has correct styling', () => {
    render(<CommandFooter />)

    const selectText = screen.getByText('Select')

    expect(selectText).toHaveClass('text-sm')
    expect(selectText).toHaveClass('text-on-surface/60')
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

  test('help text has correct primary-container color styling', () => {
    render(<CommandFooter />)

    const helpText = screen.getByText("Type '?' for help")

    expect(helpText).toHaveClass('text-primary-container/60')
  })
})
