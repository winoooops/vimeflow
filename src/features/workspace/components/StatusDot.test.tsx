import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusDot } from './StatusDot'

describe('StatusDot', () => {
  test('running status uses success class with pulse animation', () => {
    render(<StatusDot status="running" />)

    const dot = screen.getByTestId('status-dot')
    expect(dot).toHaveAttribute('data-status', 'running')
    expect(dot.className).toContain('bg-success')
    expect(dot.className).toContain('animate-pulse')
  })

  test('paused status uses warning amber', () => {
    render(<StatusDot status="paused" />)
    expect(screen.getByTestId('status-dot').className).toContain('bg-warning')
  })

  test('completed status uses success-muted', () => {
    render(<StatusDot status="completed" />)
    expect(screen.getByTestId('status-dot').className).toContain(
      'bg-success-muted'
    )
  })

  test('errored status uses error', () => {
    render(<StatusDot status="errored" />)
    expect(screen.getByTestId('status-dot').className).toContain('bg-error')
  })

  test('renders at 7px by default per handoff §4.2', () => {
    render(<StatusDot status="running" />)
    const dot = screen.getByTestId('status-dot')
    expect(dot.style.width).toBe('7px')
    expect(dot.style.height).toBe('7px')
  })

  test('size prop overrides the default (e.g. 5px for tab pip)', () => {
    render(<StatusDot status="running" size={5} />)
    const dot = screen.getByTestId('status-dot')
    expect(dot.style.width).toBe('5px')
  })

  test('aria-label promotes the dot to an img role for screen readers', () => {
    render(<StatusDot status="running" aria-label="Session running" />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Session running')
  })

  test('without aria-label the dot is aria-hidden', () => {
    render(<StatusDot status="running" />)
    expect(screen.getByTestId('status-dot')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
  })
})
