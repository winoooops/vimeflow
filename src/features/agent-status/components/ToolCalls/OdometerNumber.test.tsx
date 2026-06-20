import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OdometerNumber } from './OdometerNumber'

describe('OdometerNumber', () => {
  test('renders a full 0–9 column for each digit place', () => {
    render(
      <OdometerNumber value={7} fontSize={20} color="var(--color-on-surface)" />
    )

    expect(screen.getByTestId('odometer-roll')).toHaveTextContent('0123456789')
  })

  test('rolls each digit column to its value', () => {
    render(
      <OdometerNumber
        value={42}
        fontSize={13}
        color="var(--color-on-surface)"
      />
    )
    const cols = screen.getAllByTestId('odometer-roll')

    // cell = round(13 * 1.02) = 13 → translateY(-digit * 13)
    expect(cols).toHaveLength(2)
    expect(cols[0].style.transform).toBe('translateY(-52px)') // tens place = 4
    expect(cols[1].style.transform).toBe('translateY(-26px)') // units place = 2
  })

  test('uses the display font with tabular numerals', () => {
    render(
      <OdometerNumber value={1} fontSize={13} color="var(--color-on-surface)" />
    )
    const root = screen.getByTestId('odometer')

    expect(root.className).toContain('font-display')
    expect(root.className).toContain('tabular-nums')
  })

  test('applies the resolved color', () => {
    render(
      <OdometerNumber value={5} fontSize={13} color="var(--color-primary)" />
    )

    expect(screen.getByTestId('odometer').style.color).toBe(
      'var(--color-primary)'
    )
  })
})
