import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { isTauri, isBrowser, getEnvironment, isTest } from './environment'

describe('environment detection', () => {
  let originalTauriInternals: typeof window.__TAURI_INTERNALS__

  beforeEach(() => {
    // Save the original value
    originalTauriInternals = (window as Window).__TAURI_INTERNALS__
  })

  afterEach(() => {
    // Restore the original value
    if (originalTauriInternals === undefined) {
      delete (window as Window).__TAURI_INTERNALS__
    } else {
      ;(window as Window).__TAURI_INTERNALS__ = originalTauriInternals
    }
  })

  describe('isTauri', () => {
    test('returns true when __TAURI_INTERNALS__ is defined', () => {
      ;(window as Window).__TAURI_INTERNALS__ = {}

      expect(isTauri()).toBe(true)
    })

    test('returns false when __TAURI_INTERNALS__ is not defined', () => {
      delete (window as Window).__TAURI_INTERNALS__

      expect(isTauri()).toBe(false)
    })

    test('returns true when __TAURI_INTERNALS__ has metadata', () => {
      ;(window as Window).__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: {
            label: 'main',
          },
        },
      }

      expect(isTauri()).toBe(true)
    })
  })

  describe('isBrowser', () => {
    test('returns false when __TAURI_INTERNALS__ is defined', () => {
      ;(window as Window).__TAURI_INTERNALS__ = {}

      expect(isBrowser()).toBe(false)
    })

    test('returns true when __TAURI_INTERNALS__ is not defined', () => {
      delete (window as Window).__TAURI_INTERNALS__

      expect(isBrowser()).toBe(true)
    })
  })

  describe('getEnvironment', () => {
    test('returns "tauri" when running in Tauri', () => {
      ;(window as Window).__TAURI_INTERNALS__ = {}

      expect(getEnvironment()).toBe('tauri')
    })

    test('returns "browser" when running in browser', () => {
      delete (window as Window).__TAURI_INTERNALS__

      expect(getEnvironment()).toBe('browser')
    })
  })

  describe('isTest', () => {
    test('returns true when running in test mode', () => {
      // In vitest, import.meta.env.MODE is 'test' by default
      expect(isTest()).toBe(true)
    })
  })
})
