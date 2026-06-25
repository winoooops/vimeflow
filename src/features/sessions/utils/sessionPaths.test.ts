import { describe, expect, test } from 'vitest'
import { pathParts, deriveSessionName } from './sessionPaths'

describe('pathParts', () => {
  test('splits posix paths, dropping blanks', () => {
    expect(pathParts('/Users/x/proj/')).toEqual(['Users', 'x', 'proj'])
  })
  test('splits windows + UNC paths', () => {
    expect(pathParts('C:\\Users\\x')).toEqual(['C:', 'Users', 'x'])
    expect(pathParts('\\\\server\\share')).toEqual(['server', 'share'])
  })
  test('tilde is an ordinary first segment', () => {
    expect(pathParts('~/code/vf')).toEqual(['~', 'code', 'vf'])
  })
})

describe('deriveSessionName', () => {
  test('uses the folder basename', () => {
    expect(deriveSessionName('/Users/x/vimeflow-core')).toBe('vimeflow-core')
  })
  test('falls back to "session" for bare root/home', () => {
    expect(deriveSessionName('/')).toBe('session')
    expect(deriveSessionName('~')).toBe('session')
    expect(deriveSessionName('C:\\')).toBe('session')
  })
})
