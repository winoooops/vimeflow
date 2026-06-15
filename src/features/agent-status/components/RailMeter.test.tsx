import { render, screen, within } from '@testing-library/react'
import { test, expect } from 'vitest'
import { RailMeter } from './RailMeter'

test('exposes rounded percent as a meter, with label and tick marks', () => {
  render(
    <RailMeter pct={73.6} color="var(--color-primary-container)" label="CTX" />
  )

  const meter = screen.getByRole('meter', { name: 'CTX' })

  expect(meter).toHaveAttribute('aria-valuenow', '74')
  expect(meter).toHaveAttribute('aria-valuemin', '0')
  expect(meter).toHaveAttribute('aria-valuemax', '100')
  expect(within(meter).getByText('CTX')).toBeInTheDocument()
  expect(screen.getByTestId('liquid-tick-25')).toBeInTheDocument()
  expect(screen.getByTestId('liquid-tick-50')).toBeInTheDocument()
  expect(screen.getByTestId('liquid-tick-75')).toBeInTheDocument()
})

test('clamps percent into [0, 100] without throwing', () => {
  const { rerender } = render(
    <RailMeter pct={-5} color="var(--color-success-muted)" label="CACHE" />
  )

  expect(screen.getByRole('meter', { name: 'CACHE' })).toHaveAttribute(
    'aria-valuenow',
    '0'
  )

  rerender(
    <RailMeter pct={142} color="var(--color-success-muted)" label="CACHE" />
  )

  expect(screen.getByRole('meter', { name: 'CACHE' })).toHaveAttribute(
    'aria-valuenow',
    '100'
  )
})

test('omits liquid when percent is 0', () => {
  render(
    <RailMeter pct={0} color="var(--color-primary-container)" label="CTX" />
  )
  expect(screen.queryByTestId('liquid-base')).not.toBeInTheDocument()
})

test('renders liquid layer when percent is positive', () => {
  render(
    <RailMeter pct={42} color="var(--color-primary-container)" label="CTX" />
  )
  expect(screen.getByTestId('liquid-base')).toBeInTheDocument()
})

test('label is rendered with mono tracking class for horizontal readability', () => {
  render(
    <RailMeter pct={50} color="var(--color-primary-container)" label="CTX" />
  )

  const label = within(screen.getByRole('meter', { name: 'CTX' })).getByText(
    'CTX'
  )

  expect(label).toHaveClass('font-mono')
  expect(label).toHaveClass('tracking-[0.18em]')
})

test('renders independent meters for CTX and CACHE', () => {
  render(
    <div>
      <RailMeter pct={50} color="var(--color-primary-container)" label="CTX" />
      <RailMeter pct={80} color="var(--color-success-muted)" label="CACHE" />
    </div>
  )

  expect(screen.getByRole('meter', { name: 'CTX' })).toHaveAttribute(
    'aria-valuenow',
    '50'
  )

  expect(screen.getByRole('meter', { name: 'CACHE' })).toHaveAttribute(
    'aria-valuenow',
    '80'
  )
})

test('pct glyph is tinted with the meter color', () => {
  render(
    <RailMeter pct={50} color="var(--color-primary-container)" label="CTX" />
  )

  expect(
    within(screen.getByRole('meter', { name: 'CTX' })).getByText('%')
  ).toHaveStyle({
    color: 'var(--color-primary-container)',
  })
})
