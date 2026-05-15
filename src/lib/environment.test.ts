import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { isDesktop, isBrowser, getEnvironment, isTest } from './environment'
import type { BackendApi } from './backend'

const noop = (): void => undefined

describe('environment', () => {
  let originalTauriInternals: typeof window.__TAURI_INTERNALS__
  let originalVimeflow: typeof window.vimeflow

  beforeEach(() => {
    originalTauriInternals = window.__TAURI_INTERNALS__
    originalVimeflow = window.vimeflow
  })

  afterEach(() => {
    if (originalTauriInternals === undefined) {
      delete window.__TAURI_INTERNALS__
    } else {
      window.__TAURI_INTERNALS__ = originalTauriInternals
    }

    if (originalVimeflow === undefined) {
      delete window.vimeflow
    } else {
      window.vimeflow = originalVimeflow
    }
  })

  describe('isDesktop', () => {
    test('returns true when __TAURI_INTERNALS__ is set (Tauri host)', () => {
      window.__TAURI_INTERNALS__ = {}
      delete window.vimeflow

      expect(isDesktop()).toBe(true)
    })

    test('returns true when window.vimeflow is set (Electron host)', () => {
      delete window.__TAURI_INTERNALS__
      window.vimeflow = {
        invoke: () => Promise.resolve(),
        listen: () => Promise.resolve(noop),
      } as unknown as BackendApi

      expect(isDesktop()).toBe(true)
    })

    test('returns false when window.vimeflow is explicitly undefined', () => {
      delete window.__TAURI_INTERNALS__
      window.vimeflow = undefined

      expect(isDesktop()).toBe(false)
    })

    test('returns false when neither signal is present (browser)', () => {
      delete window.__TAURI_INTERNALS__
      delete window.vimeflow

      expect(isDesktop()).toBe(false)
    })

    test('returns true when __TAURI_INTERNALS__ has metadata', () => {
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' } },
      }

      expect(isDesktop()).toBe(true)
    })
  })

  describe('isBrowser', () => {
    test('returns false when desktop signal is set', () => {
      window.__TAURI_INTERNALS__ = {}

      expect(isBrowser()).toBe(false)
    })

    test('returns true when no desktop signal is set', () => {
      delete window.__TAURI_INTERNALS__
      delete window.vimeflow

      expect(isBrowser()).toBe(true)
    })
  })

  describe('getEnvironment', () => {
    test('returns desktop when Tauri signal is present', () => {
      window.__TAURI_INTERNALS__ = {}

      expect(getEnvironment()).toBe('desktop')
    })

    test('returns desktop when vimeflow signal is present', () => {
      delete window.__TAURI_INTERNALS__
      window.vimeflow = {
        invoke: () => Promise.resolve(),
        listen: () => Promise.resolve(noop),
      } as unknown as BackendApi

      expect(getEnvironment()).toBe('desktop')
    })

    test('returns browser when no signal is present', () => {
      delete window.__TAURI_INTERNALS__
      delete window.vimeflow

      expect(getEnvironment()).toBe('browser')
    })
  })

  describe('isTest', () => {
    test('returns true when MODE is test', () => {
      expect(isTest()).toBe(true)
    })
  })
})
