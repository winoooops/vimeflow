import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { LayoutGlyph } from './LayoutGlyph'

describe('LayoutGlyph', () => {
  test('renders an svg for each layout id', () => {
    const { container, rerender } = render(<LayoutGlyph id="single" />)
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- inline SVG exposes no ARIA roles; structural assertion is intentional
    expect(container.querySelector('svg')).not.toBeNull()
    rerender(<LayoutGlyph id="quad" active />)
    // quad draws a vertical + horizontal divider line
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- inline SVG exposes no ARIA roles; structural assertion is intentional
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(2)
  })
})
