import { describe, expect, test } from 'vitest'
import {
  LIQUID_COLOR_ERROR,
  LIQUID_COLOR_PRIMARY_CONTAINER,
  LIQUID_COLOR_TERTIARY,
} from './liquidColors'

describe('liquid colors are CSS variable references (SVG fill resolves var() in DOM)', () => {
  test('LIQUID_COLOR_PRIMARY_CONTAINER is the primary-container var reference', () => {
    expect(LIQUID_COLOR_PRIMARY_CONTAINER).toBe(
      'var(--color-primary-container)'
    )
  })

  test('LIQUID_COLOR_TERTIARY is the tertiary var reference', () => {
    expect(LIQUID_COLOR_TERTIARY).toBe('var(--color-tertiary)')
  })

  test('LIQUID_COLOR_ERROR is the error var reference', () => {
    expect(LIQUID_COLOR_ERROR).toBe('var(--color-error)')
  })
})
