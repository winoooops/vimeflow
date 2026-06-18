import { test, expect } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { BaseButton } from './BaseButton'

test('defaults type=button and forwards ref + className after variants', () => {
  const ref = createRef<HTMLButtonElement>()
  render(<BaseButton ref={ref} className="mx-2" variant="ghost" shape="icon" />)
  const btn = screen.getByRole('button')
  expect(btn).toHaveAttribute('type', 'button')
  expect(ref.current).toBe(btn)
  expect(btn.className).toContain('bg-transparent') // variant
  expect(btn.className).toContain('mx-2') // merged class passthrough
})

test('pressed sets aria-pressed; omitted leaves it unset', () => {
  const { rerender } = render(<BaseButton pressed />)
  expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  rerender(<BaseButton />)
  expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed')
})

test('disabled sets the attribute; an injected aria-expanded flows through ...rest', () => {
  render(<BaseButton disabled aria-expanded />)
  const btn = screen.getByRole('button')
  expect(btn).toBeDisabled()
  expect(btn).toHaveAttribute('aria-expanded', 'true')
})
