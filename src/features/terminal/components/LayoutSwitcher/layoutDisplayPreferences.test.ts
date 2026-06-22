import { afterEach, describe, expect, test } from 'vitest'
import {
  HIDDEN_CUSTOM_LAYOUTS_STORAGE_KEY,
  SHOWN_LAYOUTS_STORAGE_KEY,
  readLayoutDisplayPreference,
  writeLayoutDisplayPreference,
} from './layoutDisplayPreferences'

afterEach(() => {
  localStorage.clear()
})

describe('layoutDisplayPreferences', () => {
  test('returns fallback when no stored preference exists', () => {
    expect(
      readLayoutDisplayPreference(SHOWN_LAYOUTS_STORAGE_KEY, ['single'])
    ).toEqual(['single'])
  })

  test('round-trips layout ids through localStorage', () => {
    writeLayoutDisplayPreference(SHOWN_LAYOUTS_STORAGE_KEY, [
      'single',
      'grid3x2',
      'custom:wide',
    ])

    expect(readLayoutDisplayPreference(SHOWN_LAYOUTS_STORAGE_KEY, [])).toEqual([
      'single',
      'grid3x2',
      'custom:wide',
    ])
  })

  test('drops malformed or unknown stored ids', () => {
    localStorage.setItem(
      HIDDEN_CUSTOM_LAYOUTS_STORAGE_KEY,
      JSON.stringify(['custom:hidden', 'bogus', 42])
    )

    expect(
      readLayoutDisplayPreference(HIDDEN_CUSTOM_LAYOUTS_STORAGE_KEY, [])
    ).toEqual(['custom:hidden'])
  })
})
