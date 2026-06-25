import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { LayoutGlyph } from './LayoutGlyph'

describe('LayoutGlyph', () => {
  test('renders an svg for each layout id', () => {
    const { container, rerender } = render(<LayoutGlyph id="single" active={false} />)
    expect(container.querySelector('svg')).not.toBeNull()
    rerender(<LayoutGlyph id="quad" active />)
    // quad draws a vertical + horizontal divider line
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(2)
  })
})
