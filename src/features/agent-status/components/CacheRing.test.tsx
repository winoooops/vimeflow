import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect } from 'vitest'
import { CacheRing } from './CacheRing'

test('renders the rounded rate in the center, without a percent sign', () => {
  render(<CacheRing pct={73.4} color="var(--color-success-muted)" />)

  const meter = screen.getByRole('meter', { name: 'CACHE' })

  expect(within(meter).getByText('73')).toBeInTheDocument()
  expect(within(meter).queryByText('%')).not.toBeInTheDocument()
})

test('exposes the rounded rate as the meter value', () => {
  render(<CacheRing pct={73.6} color="var(--color-success-muted)" />)

  const meter = screen.getByRole('meter', { name: 'CACHE' })

  expect(meter).toHaveAttribute('aria-valuenow', '74')
  expect(meter).toHaveAttribute('aria-valuemin', '0')
  expect(meter).toHaveAttribute('aria-valuemax', '100')
})

test('clamps percent into [0, 100] without throwing', () => {
  const { rerender } = render(
    <CacheRing pct={-5} color="var(--color-tertiary)" />
  )

  expect(screen.getByRole('meter', { name: 'CACHE' })).toHaveAttribute(
    'aria-valuenow',
    '0'
  )

  rerender(<CacheRing pct={142} color="var(--color-success-muted)" />)

  expect(screen.getByRole('meter', { name: 'CACHE' })).toHaveAttribute(
    'aria-valuenow',
    '100'
  )
})

test('tints the progress arc with the provided tone color', () => {
  render(<CacheRing pct={80} color="var(--color-success-muted)" />)

  expect(screen.getByTestId('cache-ring-arc')).toHaveAttribute(
    'stroke',
    'var(--color-success-muted)'
  )
})

test('draws a complete arc at 100% (zero dash offset)', () => {
  render(<CacheRing pct={100} color="var(--color-success-muted)" />)

  expect(screen.getByTestId('cache-ring-arc')).toHaveAttribute(
    'stroke-dashoffset',
    '0'
  )
})

test('draws an empty arc at 0% (offset equals the full circumference)', () => {
  render(<CacheRing pct={0} color="var(--color-tertiary)" />)

  const arc = screen.getByTestId('cache-ring-arc')

  expect(arc.getAttribute('stroke-dashoffset')).toBe(
    arc.getAttribute('stroke-dasharray')
  )
})

test('reveals the current cache rate in a tooltip on hover', async () => {
  const user = userEvent.setup()

  render(<CacheRing pct={73} color="var(--color-success-muted)" />)

  await user.hover(screen.getByRole('meter', { name: 'CACHE' }))

  expect(await screen.findByText('Current cache rate: 73%')).toBeInTheDocument()
})
