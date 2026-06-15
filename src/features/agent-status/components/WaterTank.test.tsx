import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { WaterTank, computeTankLevel } from './WaterTank'

describe('computeTankLevel', () => {
  test('a fuller tank has a higher waterline (smaller y)', () => {
    expect(computeTankLevel(80, 104)).toBeLessThan(computeTankLevel(40, 104))
  })

  test('clamps to a 2% floor so the waterline stays visible', () => {
    expect(computeTankLevel(0, 104)).toBe(computeTankLevel(2, 104))
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

  test('applies the slow base-drift classes', () => {
    render(<WaterTank pct={56} theme="dark" />)

    expect(screen.getByTestId('tank-wave-front')).toHaveClass('vf-tank-drift-a')
    expect(screen.getByTestId('tank-wave-back')).toHaveClass('vf-tank-drift-b')
  })

  test('honors a custom height in the viewBox', () => {
    render(<WaterTank pct={56} theme="dark" height={72} />)

    expect(screen.getByTestId('water-tank').getAttribute('viewBox')).toBe(
      '0 0 248 72'
    )
  })
})
