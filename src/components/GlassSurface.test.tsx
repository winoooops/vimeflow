import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { GlassSurface } from './GlassSurface'

describe('GlassSurface', () => {
  test('applies the glass-panel blur utility and a default translucent tint', () => {
    render(<GlassSurface data-testid="glass">content</GlassSurface>)

    const el = screen.getByTestId('glass')
    expect(el.className).toContain('glass-panel')
    expect(el).toHaveStyle({ backgroundColor: 'rgba(13, 13, 28, 0.65)' })
    expect(el).toHaveTextContent('content')
  })

  test('honours a custom tintAlpha and merges className + style', () => {
    render(
      <GlassSurface
        data-testid="glass"
        tintAlpha={0.4}
        className="rounded-lg"
        style={{ height: 44 }}
      />
    )

    const el = screen.getByTestId('glass')
    expect(el.className).toContain('rounded-lg')
    expect(el).toHaveStyle({
      backgroundColor: 'rgba(13, 13, 28, 0.4)',
      height: '44px',
    })
  })
})
