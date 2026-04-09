import { describe, test, expect } from 'vitest'
import { getLanguageExtension } from './languageService'

describe('languageService', () => {
  test('maps .ts files to typescript', () => {
    const ext = getLanguageExtension('App.ts')

    expect(ext).not.toBeNull()
  })

  test('maps .tsx files to typescript with jsx', () => {
    const ext = getLanguageExtension('Component.tsx')

    expect(ext).not.toBeNull()
  })

  test('maps .js files to javascript', () => {
    const ext = getLanguageExtension('script.js')

    expect(ext).not.toBeNull()
  })

  test('maps .jsx files to javascript with jsx', () => {
    const ext = getLanguageExtension('Component.jsx')

    expect(ext).not.toBeNull()
  })

  test('maps .rs files to rust', () => {
    const ext = getLanguageExtension('main.rs')

    expect(ext).not.toBeNull()
  })

  test('maps .json files to json', () => {
    const ext = getLanguageExtension('package.json')

    expect(ext).not.toBeNull()
  })

  test('maps .css files to css', () => {
    const ext = getLanguageExtension('styles.css')

    expect(ext).not.toBeNull()
  })

  test('maps .html files to html', () => {
    const ext = getLanguageExtension('index.html')

    expect(ext).not.toBeNull()
  })

  test('maps .htm files to html', () => {
    const ext = getLanguageExtension('page.htm')

    expect(ext).not.toBeNull()
  })

  test('returns null for unknown extensions', () => {
    const ext = getLanguageExtension('file.unknown')

    expect(ext).toBeNull()
  })

  test('handles filenames without extension', () => {
    const ext = getLanguageExtension('Makefile')

    expect(ext).toBeNull()
  })

  test('handles paths with multiple dots', () => {
    const ext = getLanguageExtension('src/path/to/file.test.ts')

    expect(ext).not.toBeNull()
  })

  test('is case-insensitive', () => {
    const extUpper = getLanguageExtension('File.TS')
    const extLower = getLanguageExtension('file.ts')

    expect(extUpper).not.toBeNull()
    expect(extLower).not.toBeNull()
  })
})
