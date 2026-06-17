import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ProgressBar } from './ProgressBar'

test('renders progressbar semantics with a clamped rounded value', () => {
  render(<ProgressBar label="Usage" value={42.6} />)

  const bar = screen.getByRole('progressbar', { name: 'Usage' })
  expect(bar).toHaveAttribute('aria-valuenow', '43')
  expect(bar).toHaveAttribute('aria-valuemin', '0')
  expect(bar).toHaveAttribute('aria-valuemax', '100')
})

test('clamps the fill width to the maximum', () => {
  render(<ProgressBar label="Over" value={150} fillTestId="fill" />)

  expect(screen.getByTestId('fill')).toHaveStyle({ width: '100%' })
})

test('clamps negative fill width to zero', () => {
  render(<ProgressBar label="Under" value={-10} fillTestId="fill" />)

  expect(screen.getByTestId('fill')).toHaveStyle({ width: '0%' })
})

test('renders segmented bars as decorative proportional widths', () => {
  render(
    <ProgressBar
      label="Buckets"
      trackTestId="bucket-track"
      segments={[
        { value: 3, testId: 'cached', className: 'bg-success' },
        { value: 1, testId: 'fresh', className: 'bg-warning' },
      ]}
    />
  )

  const track = screen.getByTestId('bucket-track')
  expect(track).toHaveAttribute('aria-hidden', 'true')
  expect(track).toHaveClass('flex')
  expect(screen.getByTestId('cached')).toHaveStyle({ width: '75%' })
  expect(screen.getByTestId('fresh')).toHaveStyle({ width: '25%' })
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})

test('can render decorative loading bars without progressbar role', () => {
  render(<ProgressBar label="Loading usage" value={100} decorative />)

  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})

test('renders gradient fills for production-used tones', () => {
  render(
    <ProgressBar
      label="Memory"
      value={60}
      tone="secondary"
      gradient
      fillTestId="fill"
    />
  )

  expect(screen.getByTestId('fill')).toHaveClass('bg-gradient-to-r')
})
