import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContextBucket, formatTokens, formatContextSize } from './ContextBucket'
import type { ContextBucketProps } from './ContextBucket'

const defaultProps: ContextBucketProps = {
  usedPercentage: 50,
  contextWindowSize: 128_000,
  totalInputTokens: 50_000,
  totalOutputTokens: 14_720,
}

describe('ContextBucket', () => {
  describe('formatting helpers', () => {
    test('formatTokens formats thousands as k', () => {
      expect(formatTokens(94_720)).toBe('94.7k')
    })

    test('formatTokens formats millions as M', () => {
      expect(formatTokens(1_000_000)).toBe('1.0M')
    })

    test('formatTokens formats small numbers as-is', () => {
      expect(formatTokens(500)).toBe('500')
    })

    test('formatContextSize formats 200000 as 200k', () => {
      expect(formatContextSize(200_000)).toBe('200k')
    })

    test('formatContextSize formats 1000000 as 1M', () => {
      expect(formatContextSize(1_000_000)).toBe('1M')
    })
  })

  describe('null state', () => {
    test('renders 0% fill when usedPercentage is null', () => {
      render(<ContextBucket {...defaultProps} usedPercentage={null} />)

      expect(screen.queryByTestId('liquid-base')).not.toBeInTheDocument()
    })

    test('renders dash for percentage when usedPercentage is null', () => {
      render(<ContextBucket {...defaultProps} usedPercentage={null} />)

      const pct = screen.getByTestId('context-percentage')
      expect(pct.textContent).toBe('\u2014')
    })

    test('renders dash tokens when usedPercentage is null', () => {
      render(<ContextBucket {...defaultProps} usedPercentage={null} />)

      const detail = screen.getByTestId('token-count-detail')
      expect(detail.textContent).toBe('\u2014 tokens')
    })
  })

  describe('fill height at various percentages', () => {
    const getWrapperTy = (container: HTMLElement): number => {
      // eslint-disable-next-line testing-library/no-node-access -- SVG transform style is not reachable via a11y queries
      const wrapperEl = container.querySelector(
        '[data-testid="liquid-water-y-base"]'
      )
      expect(wrapperEl).not.toBeNull()
      const wrapper = wrapperEl as HTMLElement
      const match = /translateY\((.+?)px\)/.exec(wrapper.style.transform)

      return parseFloat(match?.[1] ?? '0')
    }

    test('renders 50% fill height', () => {
      const { container } = render(
        <ContextBucket {...defaultProps} usedPercentage={50} />
      )

      // baseFloor = top + ambientAmp + 0.5  (BAR_DIMS w=22, h=110)
      const expectedY = 110 - (110 - 4) * (50 / 100) + 1.8 + 0.5
      expect(getWrapperTy(container)).toBeCloseTo(expectedY, 1)
    })

    test('renders 74% fill height', () => {
      const { container } = render(
        <ContextBucket {...defaultProps} usedPercentage={74} />
      )

      const expectedY = 110 - (110 - 4) * (74 / 100) + 1.8 + 0.5
      expect(getWrapperTy(container)).toBeCloseTo(expectedY, 1)
    })

    test('renders 90% fill height', () => {
      const { container } = render(
        <ContextBucket {...defaultProps} usedPercentage={90} />
      )

      const expectedY = 110 - (110 - 4) * (90 / 100) + 1.8 + 0.5
      expect(getWrapperTy(container)).toBeCloseTo(expectedY, 1)
    })
  })

  describe('emoji thresholds', () => {
    test('shows happy emoji below 60%', () => {
      render(<ContextBucket {...defaultProps} usedPercentage={30} />)

      const emoji = screen.getByRole('img', { name: 'context status' })
      expect(emoji.textContent).toBe('\u{1F60A}')
    })

    test('shows neutral emoji at 60%', () => {
      render(<ContextBucket {...defaultProps} usedPercentage={60} />)

      const emoji = screen.getByRole('img', { name: 'context status' })
      expect(emoji.textContent).toBe('\u{1F610}')
    })

    test('shows worried emoji at 80%', () => {
      render(<ContextBucket {...defaultProps} usedPercentage={80} />)

      const emoji = screen.getByRole('img', { name: 'context status' })
      expect(emoji.textContent).toBe('\u{1F61F}')
    })

    test('shows hot emoji at 90%', () => {
      render(<ContextBucket {...defaultProps} usedPercentage={90} />)

      const emoji = screen.getByRole('img', { name: 'context status' })
      expect(emoji.textContent).toBe('\u{1F975}')
    })
  })

  describe('color shifts', () => {
    test('uses primary colors below 80%', () => {
      const { container } = render(
        <ContextBucket {...defaultProps} usedPercentage={50} />
      )

      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
      const stops = container.querySelectorAll(
        'linearGradient[id^="liquid-fill-"] stop'
      )
      expect(stops[0]?.getAttribute('stop-color')).toBe('#cba6f7')

      const bar = screen.getByTestId('progress-bar-fill')
      expect(bar.className).toContain('bg-primary-container')

      const pct = screen.getByTestId('context-percentage')
      expect(pct.className).toContain('text-primary-container')
    })

    test('shifts to warning (tertiary) at 80%', () => {
      const { container } = render(
        <ContextBucket {...defaultProps} usedPercentage={80} />
      )

      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
      const stops = container.querySelectorAll(
        'linearGradient[id^="liquid-fill-"] stop'
      )
      expect(stops[0]?.getAttribute('stop-color')).toBe('#ff94a5')

      const bar = screen.getByTestId('progress-bar-fill')
      expect(bar.className).toContain('bg-tertiary')

      const pct = screen.getByTestId('context-percentage')
      expect(pct.className).toContain('text-tertiary')
    })

    test('shifts to error at 90%', () => {
      const { container } = render(
        <ContextBucket {...defaultProps} usedPercentage={90} />
      )

      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- SVG attributes are not reachable via a11y queries
      const stops = container.querySelectorAll(
        'linearGradient[id^="liquid-fill-"] stop'
      )
      expect(stops[0]?.getAttribute('stop-color')).toBe('#ffb4ab')

      const bar = screen.getByTestId('progress-bar-fill')
      expect(bar.className).toContain('bg-error')

      const pct = screen.getByTestId('context-percentage')
      expect(pct.className).toContain('text-error')
    })
  })

  describe('CSS transition', () => {
    test('has transform transition on liquid wave', () => {
      render(<ContextBucket {...defaultProps} usedPercentage={50} />)

      const waveY = screen.getByTestId('liquid-water-y-b')
      expect(waveY.style.transition).toBe('transform 500ms ease')
    })
  })

  describe('token display', () => {
    test('shows detailed token count', () => {
      render(
        <ContextBucket
          {...defaultProps}
          totalInputTokens={80_000}
          totalOutputTokens={14_720}
        />
      )

      const detail = screen.getByTestId('token-count-detail')
      expect(detail.textContent).toBe(`${(94_720).toLocaleString()} tokens`)
    })

    test('shows max context size', () => {
      render(<ContextBucket {...defaultProps} contextWindowSize={200_000} />)

      expect(screen.getByText('200k max')).toBeInTheDocument()
    })
  })

  describe('header', () => {
    test('shows CURRENT CONTEXT label', () => {
      render(<ContextBucket {...defaultProps} />)

      expect(screen.getByText(/CURRENT CONTEXT/)).toBeInTheDocument()
    })

    test('shows percentage value', () => {
      render(<ContextBucket {...defaultProps} usedPercentage={74} />)

      const pct = screen.getByTestId('context-percentage')
      expect(pct.textContent).toBe('74%')
    })
  })

  describe('scale labels', () => {
    test('shows 0k at bottom of scale', () => {
      render(<ContextBucket {...defaultProps} />)

      expect(screen.getByText('0k')).toBeInTheDocument()
    })

    test('shows context size at top of scale', () => {
      render(<ContextBucket {...defaultProps} contextWindowSize={128_000} />)

      // The scale top label and the "max" label both show "128k"
      const matches = screen.getAllByText('128k', { exact: false })
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })
})
