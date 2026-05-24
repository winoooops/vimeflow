import { test, expect } from 'vitest'
import { validateTitle } from './sanitizeTitle'

test('valid title returns kind=valid with sanitized value', () => {
  expect(validateTitle('Fix CI')).toEqual({
    kind: 'valid',
    sanitized: 'Fix CI',
  })
})

test('title with newline returns kind=invalid control-char', () => {
  const result = validateTitle('line1\nline2')

  expect(result.kind).toBe('invalid')
  if (result.kind === 'invalid') {
    expect(result.reason).toBe('control-char')
  }
})

test('spaces-only returns kind=empty', () => {
  expect(validateTitle('   ')).toEqual({ kind: 'empty' })
})

test('tab returns kind=invalid control-char', () => {
  const result = validateTitle('\t')

  expect(result.kind).toBe('invalid')
  if (result.kind === 'invalid') {
    expect(result.reason).toBe('control-char')
  }
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
