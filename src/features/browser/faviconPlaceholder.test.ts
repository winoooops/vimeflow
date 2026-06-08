import { test, expect } from 'vitest'
import { faviconPlaceholder } from './faviconPlaceholder'

test('PR-like URLs map to merge/mauve', () => {
  expect(faviconPlaceholder('https://github.com/o/r/pull/12')).toEqual({
    glyph: 'merge',
    tone: 'mauve',
  })

  expect(faviconPlaceholder('https://github.com/o/r/pulls')).toEqual({
    glyph: 'merge',
    tone: 'mauve',
  })
})

test('issue-like URLs map to adjust/coral', () => {
  expect(faviconPlaceholder('https://github.com/o/r/issues')).toEqual({
    glyph: 'adjust',
    tone: 'coral',
  })
})

test('other URLs fall back to public/cyan', () => {
  expect(faviconPlaceholder('https://example.com/')).toEqual({
    glyph: 'public',
    tone: 'cyan',
  })
})

test('a malformed URL falls back to the default without throwing', () => {
  expect(faviconPlaceholder('not a url')).toEqual({
    glyph: 'public',
    tone: 'cyan',
  })
})
