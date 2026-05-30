import { describe, expect, test } from 'vitest'
// @ts-expect-error -- tailwind.config.js has no .d.ts
import tailwindConfig from '../../../../tailwind.config.js'
import {
  LIQUID_COLOR_ERROR,
  LIQUID_COLOR_PRIMARY_CONTAINER,
  LIQUID_COLOR_TERTIARY,
} from './liquidColors'

interface TailwindThemeColors {
  'primary-container'?: string
  tertiary?: string
  error?: string
}

const cfg = tailwindConfig as unknown as {
  theme?: { extend?: { colors?: TailwindThemeColors } }
}
const colors = cfg.theme?.extend?.colors ?? {}

describe('liquid colors stay in sync with tailwind.config.js', () => {
  test('LIQUID_COLOR_PRIMARY_CONTAINER matches tailwind primary-container', () => {
    expect(LIQUID_COLOR_PRIMARY_CONTAINER).toBe(colors['primary-container'])
  })

  test('LIQUID_COLOR_TERTIARY matches tailwind tertiary', () => {
    expect(LIQUID_COLOR_TERTIARY).toBe(colors.tertiary)
  })

  test('LIQUID_COLOR_ERROR matches tailwind error', () => {
    expect(LIQUID_COLOR_ERROR).toBe(colors.error)
  })
})
