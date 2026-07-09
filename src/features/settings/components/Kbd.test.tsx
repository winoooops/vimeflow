import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Kbd } from './Kbd'

describe('Kbd', () => {
  test('renders a kbd element containing the children', () => {
    render(<Kbd>⌘</Kbd>)

    expect(screen.getByText('⌘').tagName).toBe('KBD')
  })

  test('uses the mono pill styling', () => {
    render(<Kbd>esc</Kbd>)
    const kbd = screen.getByText('esc')

    expect(kbd).toHaveClass('font-mono', 'border', 'text-on-surface-variant')
  })
})
