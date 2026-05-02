import { afterEach, describe, test, expect } from 'vitest'
import { catppuccinMocha, getDocumentCspNonce } from './catppuccin'

const removeNonceElements = (): void => {
  document
    .querySelectorAll('[data-testid="csp-nonce-fixture"]')
    .forEach((element) => element.remove())
}

const getThemeExtensions = (): readonly unknown[] => {
  expect(Array.isArray(catppuccinMocha)).toBe(true)

  if (!Array.isArray(catppuccinMocha)) {
    throw new Error('Expected catppuccinMocha to export an extension array')
  }

  return catppuccinMocha
}

describe('catppuccin theme', () => {
  afterEach(() => {
    removeNonceElements()
  })

  test('exports a valid extension', () => {
    expect(catppuccinMocha).toBeDefined()
    expect(Array.isArray(catppuccinMocha)).toBe(true)
  })

  test('extension array has expected length', () => {
    expect(getThemeExtensions().length).toBeGreaterThanOrEqual(2)
  })

  test('extension is an array of theme components', () => {
    // Extension is at least [theme, syntaxHighlighting]. Production Tauri
    // builds add a CodeMirror CSP nonce extension when a nonce is present.
    const extensionArray = getThemeExtensions()

    expect(extensionArray.length).toBeGreaterThanOrEqual(2)
    expect(extensionArray[0]).toBeDefined()
    expect(extensionArray[1]).toBeDefined()
  })

  test('reads a document CSP nonce from a script element', () => {
    const script = document.createElement('script')
    script.dataset.testid = 'csp-nonce-fixture'
    script.nonce = 'nonce-from-tauri'
    document.head.append(script)

    expect(getDocumentCspNonce()).toBe('nonce-from-tauri')
  })

  test('returns null when no CSP nonce is present', () => {
    removeNonceElements()

    expect(getDocumentCspNonce()).toBeNull()
  })
})
