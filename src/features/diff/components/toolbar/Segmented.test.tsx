import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Segmented } from './Segmented'

describe('Segmented', () => {
  test('renders each option as a button', () => {
    render(
      <Segmented
        value="split"
        options={['split', 'unified'] as const}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'split' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'unified' })).toBeInTheDocument()
  })

  test('clicking a non-active option fires onChange with that value', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <Segmented
        value="split"
        options={['split', 'unified'] as const}
        onChange={handleChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'unified' }))
    expect(handleChange).toHaveBeenCalledTimes(1)
    expect(handleChange).toHaveBeenCalledWith('unified')
  })

  test('clicking the active option still calls onChange with the same value', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <Segmented
        value="unified"
        options={['split', 'unified'] as const}
        onChange={handleChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'unified' }))
    expect(handleChange).toHaveBeenCalledWith('unified')
  })

  test('active option uses primary palette classes', () => {
    render(
      <Segmented
        value="split"
        options={['split', 'unified'] as const}
        onChange={vi.fn()}
      />
    )

    const active = screen.getByRole('button', { name: 'split' })
    expect(active.className).toContain('bg-primary')
    expect(active.className).toContain('text-on-primary')

    const inactive = screen.getByRole('button', { name: 'unified' })
    expect(inactive.className).not.toContain('bg-primary')
    expect(inactive.className).toContain('text-on-surface-variant')
  })

  test('aria-pressed mirrors the active option', () => {
    render(
      <Segmented
        value="split"
        options={['split', 'unified'] as const}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'split' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    expect(screen.getByRole('button', { name: 'unified' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('supports numeric option values via the widened generic', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn<(value: number) => void>()

    render(
      <Segmented
        value={1}
        options={[1, 2, 4] as const}
        onChange={handleChange}
      />
    )

    await user.click(screen.getByRole('button', { name: '4' }))
    expect(handleChange).toHaveBeenCalledWith(4)
  })
})
