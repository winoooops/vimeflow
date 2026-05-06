import { describe, expect, test } from 'vitest'
import { parseQuery } from './parseQuery'

describe('parseQuery', () => {
  test('empty input yields empty verb and args', () => {
    expect(parseQuery('')).toEqual({ commandVerb: '', args: '' })
  })

  test('whitespace-only input yields empty verb and args', () => {
    expect(parseQuery('   ')).toEqual({ commandVerb: '', args: '' })
  })

  test('single-token input puts everything in commandVerb', () => {
    expect(parseQuery(':open')).toEqual({ commandVerb: ':open', args: '' })
  })

  test('verb plus single-token args splits on first space', () => {
    expect(parseQuery(':rename foo')).toEqual({
      commandVerb: ':rename',
      args: 'foo',
    })
  })

  test('verb plus multi-token args preserves the rest as a single string', () => {
    expect(parseQuery(':rename foo bar baz')).toEqual({
      commandVerb: ':rename',
      args: 'foo bar baz',
    })
  })

  test('outer whitespace is trimmed before parsing', () => {
    expect(parseQuery('  :open  ')).toEqual({ commandVerb: ':open', args: '' })
  })

  test('inner whitespace between verb and args is collapsed via trim', () => {
    expect(parseQuery(':rename   foo')).toEqual({
      commandVerb: ':rename',
      args: 'foo',
    })
  })
})
