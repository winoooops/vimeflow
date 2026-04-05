import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import DiffLegend from './DiffLegend'

describe('DiffLegend', () => {
  test('renders ADDED label', () => {
    render(<DiffLegend />)

    expect(screen.getByText('ADDED')).toBeInTheDocument()
  })

  test('renders REMOVED label', () => {
    render(<DiffLegend />)

    expect(screen.getByText('REMOVED')).toBeInTheDocument()
  })

  test('renders keyboard hint text', () => {
    render(<DiffLegend />)

    expect(screen.getByText('Space to stage hunk')).toBeInTheDocument()
  })

  test('has fixed positioning at bottom center', () => {
    /* eslint-disable testing-library/no-container, testing-library/no-node-access */
    const { container } = render(<DiffLegend />)

    const legend = container.querySelector('[data-testid="diff-legend"]')

    expect(legend).toHaveClass('fixed', 'bottom-10', 'left-1/2')
    /* eslint-enable testing-library/no-container, testing-library/no-node-access */
  })

  test('has glassmorphism styling', () => {
    /* eslint-disable testing-library/no-container, testing-library/no-node-access */
    const { container } = render(<DiffLegend />)

    const legend = container.querySelector('[data-testid="diff-legend"]')

    expect(legend).toHaveClass(
      'bg-surface-container-high/60',
      'backdrop-blur-xl'
    )
    /* eslint-enable testing-library/no-container, testing-library/no-node-access */
  })

  test('has border and shadow styling', () => {
    /* eslint-disable testing-library/no-container, testing-library/no-node-access */
    const { container } = render(<DiffLegend />)

    const legend = container.querySelector('[data-testid="diff-legend"]')

    expect(legend).toHaveClass(
      'border',
      'border-outline-variant/20',
      'shadow-2xl',
      'rounded-full'
    )
    /* eslint-enable testing-library/no-container, testing-library/no-node-access */
  })

  test('renders green indicator dot for ADDED', () => {
    /* eslint-disable testing-library/no-container, testing-library/no-node-access */
    const { container } = render(<DiffLegend />)

    const greenDot = container.querySelector('[data-testid="added-dot"]')

    expect(greenDot).toHaveClass('bg-[#a6e3a1]')
    /* eslint-enable testing-library/no-container, testing-library/no-node-access */
  })

  test('renders red indicator dot for REMOVED', () => {
    /* eslint-disable testing-library/no-container, testing-library/no-node-access */
    const { container } = render(<DiffLegend />)

    const redDot = container.querySelector('[data-testid="removed-dot"]')

    expect(redDot).toHaveClass('bg-[#f38ba8]')
    /* eslint-enable testing-library/no-container, testing-library/no-node-access */
  })

  test('has proper text styling', () => {
    render(<DiffLegend />)

    const addedText = screen.getByText('ADDED')

    expect(addedText).toHaveClass(
      'text-[0.7rem]',
      'font-bold',
      'uppercase',
      'tracking-wider'
    )
  })

  test('renders divider between sections', () => {
    /* eslint-disable testing-library/no-container, testing-library/no-node-access */
    const { container } = render(<DiffLegend />)

    const divider = container.querySelector('[data-testid="legend-divider"]')

    expect(divider).toBeInTheDocument()
    expect(divider).toHaveClass('h-4', 'w-px', 'bg-outline-variant/30')
    /* eslint-enable testing-library/no-container, testing-library/no-node-access */
  })
})
