import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ContextReservoirCard, compactTokens } from './ContextReservoirCard'
import type { ContextReservoirCardProps } from './ContextReservoirCard'
import { ctxTone } from '../utils/contextTone'

// 56% of a 1M window → 560k current occupancy · 440k headroom, reconstructed
// from the authoritative fill % so every figure agrees with the waterline.
const defaultProps: ContextReservoirCardProps = {
  usedPercentage: 56,
  contextWindowSize: 1_000_000,
}

describe('compactTokens', () => {
  test('formats millions', () => {
    expect(compactTokens(1_000_000)).toBe('1M')
    expect(compactTokens(1_500_000)).toBe('1.5M')
  })

  test('rounds thousands to k', () => {
    expect(compactTokens(561_509)).toBe('562k')
    expect(compactTokens(438_491)).toBe('438k')
  })

  test('rolls over to 1M when rounding crosses the boundary', () => {
    expect(compactTokens(999_800)).toBe('1M')
    expect(compactTokens(999_400)).toBe('999k')
  })

  test('passes small numbers through', () => {
    expect(compactTokens(999)).toBe('999')
    expect(compactTokens(0)).toBe('0')
  })
})

describe('ContextReservoirCard header', () => {
  test('shows the CONTEXT label', () => {
    render(<ContextReservoirCard {...defaultProps} />)

    expect(screen.getByText('Context')).toBeInTheDocument()
  })

  test('exposes context usage as an accessible meter', () => {
    render(<ContextReservoirCard {...defaultProps} usedPercentage={74} />)

    const meter = screen.getByRole('meter', { name: /context window usage/i })

    expect(meter).toHaveAttribute('aria-valuenow', '74')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '100')
    expect(meter).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining('74% used')
    )
  })

  test('uses a water-drop identity glyph, not an emoji face', () => {
    const { container } = render(<ContextReservoirCard {...defaultProps} />)

    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- icon font span is aria-hidden
    const glyph = container.querySelector('.material-symbols-outlined')
    expect(glyph).toHaveTextContent('water_drop')
    // The degrading faces live in the bottom status bar, never on this card.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('ContextReservoirCard chrome', () => {
  test('uses a default cursor so the read-only numbers do not look editable', () => {
    render(<ContextReservoirCard {...defaultProps} />)

    expect(screen.getByRole('meter')).toHaveClass('cursor-default')
  })
})

describe('ContextReservoirCard continuous color', () => {
  test('percentage tone tracks the fill (no tiered jumps)', () => {
    const { rerender } = render(
      <ContextReservoirCard {...defaultProps} usedPercentage={30} />
    )

    const lowFill = within(screen.getByRole('meter')).getByText('30').style
      .color

    rerender(<ContextReservoirCard {...defaultProps} usedPercentage={85} />)

    const highFill = within(screen.getByRole('meter')).getByText('85').style
      .color

    expect(lowFill).not.toBe('')
    expect(lowFill).not.toBe(highFill)
  })

  test('percentage tone matches the shared ctxTone sweep in dark mode', () => {
    render(<ContextReservoirCard {...defaultProps} usedPercentage={30} />)

    expect(within(screen.getByRole('meter')).getByText('30')).toHaveStyle({
      color: ctxTone(30).base,
    })
  })
})

describe('ContextReservoirCard tank + waterline', () => {
  test('renders the water tank with water when context is known', () => {
    render(<ContextReservoirCard {...defaultProps} />)

    expect(screen.getByTestId('water-tank')).toBeInTheDocument()
    expect(screen.getByTestId('tank-water')).toBeInTheDocument()
  })

  test('rides a value pill on the waterline showing the used tokens', () => {
    render(<ContextReservoirCard {...defaultProps} />)

    expect(screen.getByTestId('context-pill')).toHaveTextContent('560k')
  })

  test('top scale tick shows the window size, bottom shows zero', () => {
    render(
      <ContextReservoirCard {...defaultProps} contextWindowSize={200_000} />
    )

    expect(screen.getByText('200k')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})

describe('ContextReservoirCard footer', () => {
  test('shows the used token count', () => {
    render(<ContextReservoirCard {...defaultProps} />)

    expect(screen.getByTestId('token-count-detail')).toHaveTextContent(
      '560,000 tokens'
    )
  })

  test('shows remaining headroom', () => {
    render(<ContextReservoirCard {...defaultProps} />)

    expect(screen.getByTestId('context-headroom')).toHaveTextContent(
      '440k left'
    )
  })
})

describe('ContextReservoirCard null state', () => {
  test('marks the meter unknown and renders dashes when context is unknown', () => {
    render(<ContextReservoirCard {...defaultProps} usedPercentage={null} />)

    expect(
      screen.getByRole('meter', { name: /context window usage/i })
    ).toHaveAttribute('aria-valuetext', 'Context usage unknown')

    expect(screen.getByTestId('token-count-detail')).toHaveTextContent(
      '— tokens'
    )
    expect(screen.getByTestId('context-headroom')).toHaveTextContent('—')
  })

  test('omits aria-valuenow while the context percentage is unknown', () => {
    render(<ContextReservoirCard {...defaultProps} usedPercentage={null} />)

    expect(
      screen.getByRole('meter', { name: /context window usage/i })
    ).not.toHaveAttribute('aria-valuenow')
  })

  test('omits the water and the value pill when context is unknown', () => {
    render(<ContextReservoirCard {...defaultProps} usedPercentage={null} />)

    expect(screen.getByTestId('water-tank')).toBeInTheDocument()
    expect(screen.queryByTestId('tank-water')).not.toBeInTheDocument()
    expect(screen.queryByTestId('context-pill')).not.toBeInTheDocument()
  })
})
