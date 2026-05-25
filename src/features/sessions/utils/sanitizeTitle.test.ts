import { test, expect } from 'vitest'
import { validateTitle } from './sanitizeTitle'

test('valid title returns kind=valid with sanitized value', () => {
  expect(validateTitle('Fix CI')).toEqual({
    kind: 'valid',
    sanitized: 'Fix CI',
  })
})

test('title with newline returns kind=valid with sanitized value', () => {
  expect(validateTitle('line1\nline2')).toEqual({
    kind: 'valid',
    sanitized: 'line1 line2',
  })
})

test('spaces-only returns kind=empty', () => {
  expect(validateTitle('   ')).toEqual({ kind: 'empty' })
})

test('tab-only returns kind=empty', () => {
  expect(validateTitle('\t')).toEqual({ kind: 'empty' })
})

test('DEL control character is replaced with a space', () => {
  expect(validateTitle('bad\u007fname')).toEqual({
    kind: 'valid',
    sanitized: 'bad name',
  })
})

test('valid title collapses non-control whitespace runs', () => {
  expect(validateTitle('  Fix    CI  ')).toEqual({
    kind: 'valid',
    sanitized: 'Fix CI',
  })
})

test('over 200 bytes returns kind=invalid too-long', () => {
  const long = 'a'.repeat(201)
  const result = validateTitle(long)

  expect(result.kind).toBe('invalid')
  if (result.kind === 'invalid') {
    expect(result.reason).toBe('too-long')
  }
})

test('4-byte UTF-8 char pushing over cap returns kind=invalid too-long', () => {
  const result = validateTitle('𝕏'.repeat(51))

  expect(result.kind).toBe('invalid')
  if (result.kind === 'invalid') {
    expect(result.reason).toBe('too-long')
  }
})
