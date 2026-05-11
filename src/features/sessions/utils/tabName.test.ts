import { describe, expect, test } from 'vitest'
import { tabName } from './tabName'

describe('tabName', () => {
  test('returns last cwd segment for absolute path', () => {
    expect(tabName('/home/will/projects/vimeflow', 0)).toBe('vimeflow')
  })

  test('returns "session N+1" for ~ alias', () => {
    expect(tabName('~', 2)).toBe('session 3')
  })

  test('returns "session N+1" for empty cwd', () => {
    expect(tabName('', 0)).toBe('session 1')
  })

  test('handles trailing slashes', () => {
    expect(tabName('/home/will/repo/', 0)).toBe('repo')
  })
})
