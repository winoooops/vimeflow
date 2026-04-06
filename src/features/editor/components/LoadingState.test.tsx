import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingState } from './LoadingState'

describe('LoadingState', () => {
  test('renders with centered loading text', () => {
    render(<LoadingState />)

    // Verify loading text is present
    const loadingText = screen.getByText('Loading...')
    expect(loadingText).toBeInTheDocument()
  })

  test('has correct styling for dark atmospheric design', () => {
    render(<LoadingState />)

    // Verify container has flex centering classes
    const wrapper = screen.getByTestId('loading-state')
    expect(wrapper).toHaveClass('flex', 'items-center', 'justify-center')
  })

  test('text has correct muted style', () => {
    render(<LoadingState />)

    const loadingText = screen.getByText('Loading...')
    expect(loadingText.className).toMatch(/text-on-surface-variant/)
    expect(loadingText.className).toMatch(/text-sm/)
  })

  test('has accessible structure', () => {
    render(<LoadingState />)

    // Container should have role and aria-live for screen readers
    const wrapper = screen.getByRole('status')
    expect(wrapper).toHaveAttribute('aria-live', 'polite')
  })

  test('has animation class', () => {
    render(<LoadingState />)

    const loadingText = screen.getByText('Loading...')
    // Check for pulse or fade animation
    expect(loadingText.className).toMatch(/animate-pulse/)
  })
})
