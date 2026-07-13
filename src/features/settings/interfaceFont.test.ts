import { expect, test } from 'vitest'
import {
  applyInterfaceFont,
  INTERFACE_FONT_OPTIONS,
  resolveInterfaceFont,
} from './interfaceFont'

test('exposes only bundled interface fonts', () => {
  expect(INTERFACE_FONT_OPTIONS.map((option) => option.id)).toEqual([
    'instrument',
    'inter',
    'manrope',
  ])
})

test('falls back to Instrument Sans for an unknown setting', () => {
  expect(resolveInterfaceFont('missing').id).toBe('instrument')
})

test('applies the selected family to interface CSS variables', () => {
  applyInterfaceFont(document.documentElement, 'inter')

  expect(
    document.documentElement.style.getPropertyValue('--font-display')
  ).toContain('Inter')

  expect(
    document.documentElement.style.getPropertyValue('--font-body')
  ).toContain('Inter')
})
