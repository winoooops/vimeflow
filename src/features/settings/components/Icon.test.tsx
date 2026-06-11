import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Icon } from './Icon'

describe('Icon', () => {
  test('renders a Material Symbols span with the given name', () => {
    render(<Icon name="settings" />)
    const span = screen.getByText('settings')

    expect(span.tagName).toBe('SPAN')
    expect(span).toHaveClass('material-symbols-outlined')
    expect(span).toHaveAttribute('aria-hidden', 'true')
  })

  test('applies the custom size via inline style', () => {
    render(<Icon name="close" size={24} />)

    expect(screen.getByText('close')).toHaveStyle({ fontSize: '24px' })
  })

  test('toggles fill via font-variation-settings', () => {
    render(<Icon name="check" fill />)

    expect(screen.getByText('check')).toHaveStyle({
      fontVariationSettings: "'FILL' 1",
    })
  })

  test('appends the optional className', () => {
    render(<Icon name="palette" className="text-primary" />)

    expect(screen.getByText('palette')).toHaveClass('text-primary')
  })
})
