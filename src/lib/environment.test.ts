import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { isDesktop, isBrowser, getEnvironment, isTest } from './environment'
import type { BackendApi } from './backend'

const noop = (): void => undefined

describe('environment', () => {
  let originalVimeflow: typeof window.vimeflow

  beforeEach(() => {
    originalVimeflow = window.vimeflow
  })

  afterEach(() => {
    if (originalVimeflow === undefined) {
      delete window.vimeflow
    } else {
      window.vimeflow = originalVimeflow
    }
  })

  describe('isDesktop', () => {
    test('returns true when window.vimeflow is set', () => {
      window.vimeflow = {
        invoke: () => Promise.resolve(),
        listen: () => Promise.resolve(noop),
      } as unknown as BackendApi

      expect(isDesktop()).toBe(true)
    })

    test('returns false when window.vimeflow is explicitly undefined', () => {
      window.vimeflow = undefined

      expect(isDesktop()).toBe(false)
    })

    test('returns false when window.vimeflow is unset', () => {
      delete window.vimeflow

      expect(isDesktop()).toBe(false)
    })
  })

  describe('isBrowser', () => {
    test('returns false when the desktop signal is set', () => {
      window.vimeflow = {
        invoke: () => Promise.resolve(),
        listen: () => Promise.resolve(noop),
      } as unknown as BackendApi

      expect(isBrowser()).toBe(false)
    })

    test('returns true when the desktop signal is unset', () => {
      delete window.vimeflow

      expect(isBrowser()).toBe(true)
    })
  })

  describe('getEnvironment', () => {
    test('returns desktop when window.vimeflow is present', () => {
      window.vimeflow = {
        invoke: () => Promise.resolve(),
        listen: () => Promise.resolve(noop),
      } as unknown as BackendApi

      expect(getEnvironment()).toBe('desktop')
    })

    test('returns browser when window.vimeflow is unset', () => {
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
