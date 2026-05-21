import { render, screen } from '@testing-library/react'
import { test, expect } from 'vitest'
import { Bucket } from './Bucket'

test('renders rounded percent, label, and tick marks at 25/50/75', () => {
  render(<Bucket pct={73.6} color="#cba6f7" label="CTX" />)

  expect(screen.getByTestId('bucket-ctx-pct')).toHaveTextContent('74%')
  expect(screen.getByTestId('bucket-ctx-label')).toHaveTextContent('CTX')
  expect(screen.getByTestId('bucket-tick-25')).toBeInTheDocument()
  expect(screen.getByTestId('bucket-tick-50')).toBeInTheDocument()
  expect(screen.getByTestId('bucket-tick-75')).toBeInTheDocument()
})

test('clamps percent into [0, 100] without throwing', () => {
  const { rerender } = render(<Bucket pct={-5} color="#7defa1" label="CACHE" />)

  expect(screen.getByTestId('bucket-cache-pct')).toHaveTextContent('0%')

  rerender(<Bucket pct={142} color="#7defa1" label="CACHE" />)
  expect(screen.getByTestId('bucket-cache-pct')).toHaveTextContent('100%')
})

test('omits liquid when percent is 0', () => {
  render(<Bucket pct={0} color="#cba6f7" label="CTX" />)
  expect(screen.queryByTestId('bucket-liquid')).not.toBeInTheDocument()
})

test('renders liquid layer when percent is positive', () => {
  render(<Bucket pct={42} color="#cba6f7" label="CTX" />)
  expect(screen.getByTestId('bucket-liquid')).toBeInTheDocument()
})

test('label is rendered with mono tracking class for horizontal readability', () => {
  render(<Bucket pct={50} color="#cba6f7" label="CTX" />)
  const label = screen.getByTestId('bucket-ctx-label')

  expect(label).toHaveClass('font-mono')
  expect(label).toHaveClass('tracking-[0.18em]')
})

test('two buckets get distinct internally-scoped SVG ids', () => {
  render(
    <div>
      <Bucket pct={50} color="#cba6f7" label="CTX" />
      <Bucket pct={80} color="#7defa1" label="CACHE" />
    </div>
  )

  expect(screen.getByTestId('bucket-ctx')).toBeInTheDocument()
  expect(screen.getByTestId('bucket-cache')).toBeInTheDocument()
  expect(screen.getByTestId('bucket-ctx-pct')).toHaveTextContent('50%')
  expect(screen.getByTestId('bucket-cache-pct')).toHaveTextContent('80%')
})

test('pct glyph is tinted with bucket color', () => {
  render(<Bucket pct={50} color="#cba6f7" label="CTX" />)
  expect(screen.getByTestId('bucket-ctx-pct-glyph')).toHaveStyle({
    color: '#cba6f7',
  })
})
