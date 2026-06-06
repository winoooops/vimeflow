import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { RateLimitBar } from './RateLimitBar'

describe('RateLimitBar', () => {
  test('renders the label and the rounded percentage', () => {
    render(<RateLimitBar label="5-hour Session" percentage={42.6} />)

    expect(screen.getByText('5-hour Session')).toBeInTheDocument()
    expect(screen.getByText('43%')).toBeInTheDocument()
  })

  test('sets the fill width to the percentage', () => {
    render(<RateLimitBar label="Weekly Usage" percentage={30} />)

    expect(screen.getByTestId('rate-limit-bar-fill')).toHaveStyle({
      width: '30%',
    })
  })

  test('clamps the fill width at 100%', () => {
    render(<RateLimitBar label="Over" percentage={150} />)

    expect(screen.getByTestId('rate-limit-bar-fill')).toHaveStyle({
      width: '100%',
    })
  })

  test('exposes progressbar semantics with aria-value* attributes', () => {
    render(<RateLimitBar label="5-hour Session" percentage={42.6} />)

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '43')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })
})
