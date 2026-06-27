import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { CommandFooter } from './CommandFooter'

describe('CommandFooter', () => {
  test('renders Navigate hint text', () => {
    const { container } = render(<CommandFooter />)

    expect(container.textContent).toContain('navigate')
  })

  test('renders ↑ keycap for navigation', () => {
    render(<CommandFooter />)

    const upCap = screen.getByText('↑')

    expect(upCap).toBeInTheDocument()
    expect(upCap).toHaveClass('inline-flex')
  })

  test('renders ↓ keycap for navigation', () => {
    render(<CommandFooter />)

    const downCap = screen.getByText('↓')

    expect(downCap).toBeInTheDocument()
    expect(downCap).toHaveClass('inline-flex')
  })

  test('renders Run hint text', () => {
    const { container } = render(<CommandFooter />)

    expect(container.textContent).toContain('run')
  })

  test('renders ↵ keycap for run action', () => {
    render(<CommandFooter />)

    const returnCap = screen.getByText('↵')

    expect(returnCap).toBeInTheDocument()
    expect(returnCap).toHaveClass('inline-flex')
  })

  test('does not render the removed help text', () => {
    render(<CommandFooter />)

    expect(screen.queryByText("Type '?' for help")).toBeNull()
  })

  test('Navigate text has correct styling', () => {
    render(<CommandFooter />)

    // navigate hint uses md-size keycaps with muted idle tone
    const upCap = screen.getByText('↑')
    expect(upCap).toHaveClass('h-[18px]')
    expect(upCap).toHaveClass('text-on-surface-variant')
  })

  test('Run text has correct styling', () => {
    render(<CommandFooter />)

    // run hint uses md-size keycap with muted idle tone
    const returnCap = screen.getByText('↵')
    expect(returnCap).toHaveClass('h-[18px]')
    expect(returnCap).toHaveClass('text-on-surface-variant')
  })

  test('all navigation keycaps have correct styling', () => {
    render(<CommandFooter />)

    const upCap = screen.getByText('↑')
    const downCap = screen.getByText('↓')
    const returnCap = screen.getByText('↵')

    expect(upCap).toHaveClass('bg-surface-container-highest/60')
    expect(downCap).toHaveClass('bg-surface-container-highest/60')
    expect(returnCap).toHaveClass('bg-surface-container-highest/60')
  })
})
