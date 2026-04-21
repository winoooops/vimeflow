import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import StatusDot from './StatusDot'
import type { SessionStatus } from '../../types'

describe('StatusDot', () => {
  const allStates: SessionStatus[] = [
    'running',
    'awaiting',
    'completed',
    'errored',
    'idle',
  ]

  test('renders for all five session states', () => {
    allStates.forEach((state) => {
      const { unmount } = render(<StatusDot state={state} />)
      const dot = screen.getByTestId('status-dot')

      expect(dot).toBeInTheDocument()
      expect(dot).toHaveAttribute('data-state', state)
      unmount()
    })
  })

  test('uses default size of 8px when not specified', () => {
    render(<StatusDot state="running" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.style.width).toBe('8px')
    expect(dot.style.height).toBe('8px')
  })

  test('accepts custom size prop', () => {
    render(<StatusDot state="running" size={12} />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.style.width).toBe('12px')
    expect(dot.style.height).toBe('12px')
  })

  test('accepts custom size of 16px', () => {
    render(<StatusDot state="completed" size={16} />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.style.width).toBe('16px')
    expect(dot.style.height).toBe('16px')
  })

  test('running state renders solid fill', () => {
    render(<StatusDot state="running" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.style.backgroundColor).toBeTruthy()
    expect(dot.style.backgroundColor).not.toBe('transparent')
    // Solid states have no border (border: 'none' in style)
    expect(dot.style.border).toBeFalsy()
  })

  test('awaiting state renders solid fill', () => {
    render(<StatusDot state="awaiting" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.style.backgroundColor).toBeTruthy()
    expect(dot.style.backgroundColor).not.toBe('transparent')
    expect(dot.style.border).toBeFalsy()
  })

  test('errored state renders solid fill', () => {
    render(<StatusDot state="errored" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.style.backgroundColor).toBeTruthy()
    expect(dot.style.backgroundColor).not.toBe('transparent')
    expect(dot.style.border).toBeFalsy()
  })

  test('completed state renders hollow ring', () => {
    render(<StatusDot state="completed" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.style.backgroundColor).toBe('transparent')
    expect(dot.style.border).toContain('solid')
  })

  test('idle state renders hollow ring', () => {
    render(<StatusDot state="idle" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.style.backgroundColor).toBe('transparent')
    expect(dot.style.border).toContain('solid')
  })

  test('glow is enabled by default', () => {
    render(<StatusDot state="running" />)
    const dot = screen.getByTestId('status-dot')

    // Glow is implemented via boxShadow
    expect(dot.style.boxShadow).toBeTruthy()
    expect(dot.style.boxShadow).not.toBe('none')
  })

  test('glow can be disabled via prop', () => {
    // eslint-disable-next-line react/jsx-boolean-value -- glow default is true per UNIFIED.md §5.3, so explicit false is meaningful
    render(<StatusDot state="running" glow={false} />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.style.boxShadow).toBe('none')
  })

  test('idle state does not glow per stateToken config', () => {
    render(<StatusDot state="idle" />)
    const dot = screen.getByTestId('status-dot')

    // idle has glow: false in stateToken
    expect(dot.style.boxShadow).toBe('none')
  })

  test('completed state does not glow per stateToken config', () => {
    render(<StatusDot state="completed" />)
    const dot = screen.getByTestId('status-dot')

    // completed has glow: false in stateToken
    expect(dot.style.boxShadow).toBe('none')
  })

  test('running state has pulse animation', () => {
    render(<StatusDot state="running" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.classList.contains('animate-pulse')).toBe(true)
    expect(dot.style.animationDuration).toBe('2000ms')
  })

  test('awaiting state has pulse animation', () => {
    render(<StatusDot state="awaiting" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.classList.contains('animate-pulse')).toBe(true)
    expect(dot.style.animationDuration).toBe('1400ms')
  })

  test('completed state has no pulse animation', () => {
    render(<StatusDot state="completed" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.classList.contains('animate-pulse')).toBe(false)
  })

  test('errored state has no pulse animation', () => {
    render(<StatusDot state="errored" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.classList.contains('animate-pulse')).toBe(false)
  })

  test('idle state has no pulse animation', () => {
    render(<StatusDot state="idle" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.classList.contains('animate-pulse')).toBe(false)
  })

  test('applies rounded-full class for circular shape', () => {
    render(<StatusDot state="running" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.classList.contains('rounded-full')).toBe(true)
  })

  test('applies transition classes for smooth state changes', () => {
    render(<StatusDot state="running" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot.classList.contains('transition-all')).toBe(true)
    expect(dot.classList.contains('duration-300')).toBe(true)
  })

  test('includes accessible aria-label', () => {
    render(<StatusDot state="running" />)
    const dot = screen.getByTestId('status-dot')

    expect(dot).toHaveAttribute('aria-label', 'Session running')
  })

  test('aria-label updates with state', () => {
    const { rerender } = render(<StatusDot state="running" />)
    let dot = screen.getByTestId('status-dot')

    expect(dot).toHaveAttribute('aria-label', 'Session running')

    rerender(<StatusDot state="awaiting" />)
    dot = screen.getByTestId('status-dot')

    expect(dot).toHaveAttribute('aria-label', 'Session awaiting')
  })

  test('data-state attribute matches state prop', () => {
    allStates.forEach((state) => {
      const { unmount } = render(<StatusDot state={state} />)
      const dot = screen.getByTestId('status-dot')

      expect(dot).toHaveAttribute('data-state', state)
      unmount()
    })
  })
})
