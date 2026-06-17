import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { WaterTank, computeTankLevel } from './WaterTank'

describe('computeTankLevel', () => {
  test('a fuller tank has a higher waterline (smaller y)', () => {
    expect(computeTankLevel(80, 104)).toBeLessThan(computeTankLevel(40, 104))
  })

  test('treats zero as a dry tank', () => {
    expect(computeTankLevel(0, 104)).toBe(104)
  })

  test('clamps non-zero fills to a 2% floor so tiny amounts stay visible', () => {
    expect(computeTankLevel(1, 104)).toBe(computeTankLevel(2, 104))
  })

  test('clamps overfill to the top', () => {
    expect(computeTankLevel(150, 104)).toBe(0)
  })
})

describe('WaterTank', () => {
  test('renders the water body and meniscus when filled', () => {
    render(<WaterTank pct={56} theme="dark" />)

    expect(screen.getByTestId('tank-water')).toBeInTheDocument()
    expect(screen.getByTestId('tank-meniscus')).toBeInTheDocument()
  })

  test('renders an empty tank with no water when empty', () => {
    render(<WaterTank pct={0} theme="dark" empty />)

    expect(screen.getByTestId('water-tank')).toBeInTheDocument()
    expect(screen.queryByTestId('tank-water')).not.toBeInTheDocument()
  })

  test('renders no water at 0% even when context is known', () => {
    render(<WaterTank pct={0} theme="dark" />)

    expect(screen.getByTestId('water-tank')).toBeInTheDocument()
    expect(screen.queryByTestId('tank-water')).not.toBeInTheDocument()
  })

  test('renders a full tank without a doubled meniscus line at 100%', () => {
    render(<WaterTank pct={100} theme="dark" height={104} />)

    expect(screen.getByTestId('tank-water').getAttribute('d')).toContain(
      'M 0.0 0.00'
    )
    expect(screen.queryByTestId('tank-meniscus')).not.toBeInTheDocument()
  })

  test('paints a resting surface that closes flat to the floor', () => {
    render(<WaterTank pct={56} theme="dark" height={104} />)

    expect(screen.getByTestId('tank-water').getAttribute('d')).toContain(
      'L 248 104 L 0 104 Z'
    )
  })

  test('honors a custom height in the viewBox', () => {
    render(<WaterTank pct={56} theme="dark" height={72} />)

    expect(screen.getByTestId('water-tank').getAttribute('viewBox')).toBe(
      '0 0 248 72'
    )
  })
})
