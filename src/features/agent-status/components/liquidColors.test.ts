import { describe, expect, test } from 'vitest'
import { obsidianLens } from '../../../theme'
import {
  LIQUID_COLOR_ERROR,
  LIQUID_COLOR_PRIMARY_CONTAINER,
  LIQUID_COLOR_TERTIARY,
} from './liquidColors'

describe('liquid colors stay in sync with the Obsidian Lens theme', () => {
  test('LIQUID_COLOR_PRIMARY_CONTAINER matches obsidianLens primary-container', () => {
    expect(LIQUID_COLOR_PRIMARY_CONTAINER).toBe(
      obsidianLens.ui['primary-container']
    )
  })

  test('LIQUID_COLOR_TERTIARY matches obsidianLens tertiary', () => {
    expect(LIQUID_COLOR_TERTIARY).toBe(obsidianLens.ui.tertiary)
  })

  test('LIQUID_COLOR_ERROR matches obsidianLens error', () => {
    expect(LIQUID_COLOR_ERROR).toBe(obsidianLens.ui.error)
  })
})
