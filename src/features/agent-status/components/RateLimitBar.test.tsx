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
})
