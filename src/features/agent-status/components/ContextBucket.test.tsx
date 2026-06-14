import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ContextBucket, compactTokens } from './ContextBucket'
import type { ContextBucketProps } from './ContextBucket'
import { ctxTone } from '../utils/contextTone'

// 56% of a 1M window → 560k current occupancy · 440k headroom, reconstructed
// from the authoritative fill % so every figure agrees with the waterline.
const defaultProps: ContextBucketProps = {
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

describe('ContextBucket header', () => {
  test('shows the CONTEXT label', () => {
    render(<ContextBucket {...defaultProps} />)

    expect(screen.getByText('Context')).toBeInTheDocument()
  })

  test('shows the rounded percentage', () => {
    render(<ContextBucket {...defaultProps} usedPercentage={74} />)

    expect(screen.getByTestId('context-percentage')).toHaveTextContent('74%')
  })

  test('uses a water-drop identity glyph, not an emoji face', () => {
    const { container } = render(<ContextBucket {...defaultProps} />)

    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- icon font span is aria-hidden
    const glyph = container.querySelector('.material-symbols-outlined')
    expect(glyph).toHaveTextContent('water_drop')
    // The degrading faces live in the bottom status bar, never on this card.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('ContextBucket continuous color', () => {
  test('percentage tone tracks the fill (no tiered jumps)', () => {
    const { rerender } = render(
      <ContextBucket {...defaultProps} usedPercentage={30} />
    )
    const lowFill = screen.getByTestId('context-percentage').style.color

    rerender(<ContextBucket {...defaultProps} usedPercentage={85} />)
    const highFill = screen.getByTestId('context-percentage').style.color

    expect(lowFill).not.toBe('')
    expect(lowFill).not.toBe(highFill)
  })

  test('percentage tone matches the shared ctxTone sweep in dark mode', () => {
    render(<ContextBucket {...defaultProps} usedPercentage={30} />)

    expect(screen.getByTestId('context-percentage')).toHaveStyle({
      color: ctxTone(30).base,
    })
  })
})

describe('ContextBucket tank + waterline', () => {
  test('renders the water tank with water when context is known', () => {
    render(<ContextBucket {...defaultProps} />)

    expect(screen.getByTestId('water-tank')).toBeInTheDocument()
    expect(screen.getByTestId('tank-water')).toBeInTheDocument()
  })

  test('rides a value pill on the waterline showing the used tokens', () => {
    render(<ContextBucket {...defaultProps} />)

    expect(screen.getByTestId('context-pill')).toHaveTextContent('560k')
  })

  test('top scale tick shows the window size, bottom shows zero', () => {
    render(<ContextBucket {...defaultProps} contextWindowSize={200_000} />)

    expect(screen.getByText('200k')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})

describe('ContextBucket footer', () => {
  test('shows the used token count', () => {
    render(<ContextBucket {...defaultProps} />)

    expect(screen.getByTestId('token-count-detail')).toHaveTextContent(
      '560,000 tokens'
    )
  })

  test('shows remaining headroom', () => {
    render(<ContextBucket {...defaultProps} />)

    expect(screen.getByTestId('context-headroom')).toHaveTextContent(
      '440k left'
    )
  })
})

describe('ContextBucket null state', () => {
  test('renders dashes and an empty tank when context is unknown', () => {
    render(<ContextBucket {...defaultProps} usedPercentage={null} />)

    expect(screen.getByTestId('context-percentage')).toHaveTextContent('—')
    expect(screen.getByTestId('token-count-detail')).toHaveTextContent(
      '— tokens'
    )
    expect(screen.getByTestId('context-headroom')).toHaveTextContent('—')
  })

  test('omits the water and the value pill when context is unknown', () => {
    render(<ContextBucket {...defaultProps} usedPercentage={null} />)

    expect(screen.getByTestId('water-tank')).toBeInTheDocument()
    expect(screen.queryByTestId('tank-water')).not.toBeInTheDocument()
    expect(screen.queryByTestId('context-pill')).not.toBeInTheDocument()
  })
})
