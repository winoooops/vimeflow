import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sparkline } from './Sparkline'

describe('Sparkline', () => {
  test('renders "no data yet" when empty', () => {
    render(<Sparkline data={[]} color="#7defa1" />)
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  test('renders an svg with a line path when given data', () => {
    render(<Sparkline data={[42, 51, 49, 75]} color="#7defa1" />)
    const svg = screen.getByTestId('token-cache-sparkline')
    // eslint-disable-next-line testing-library/no-node-access
    expect(svg.querySelectorAll('path')).toHaveLength(2)
  })

  test('strokes with the provided tone color', () => {
    render(<Sparkline data={[10, 90]} color="#ff94a5" />)
    const svg = screen.getByTestId('token-cache-sparkline')
    // eslint-disable-next-line testing-library/no-node-access
    const line = svg.querySelectorAll('path')[1]
    expect(line.getAttribute('stroke')).toBe('#ff94a5')
  })
})
