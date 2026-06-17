// cspell:ignore hostless worktree
import { describe, expect, test } from 'vitest'
import { parseOsc7Cwd } from './osc7'

describe('parseOsc7Cwd', () => {
  test('parses a POSIX file URL emitted by OSC 7', () => {
    expect(parseOsc7Cwd('file://localhost/home/user/project')).toBe(
      '/home/user/project'
    )
  })

  test('parses a hostless POSIX file URL', () => {
    expect(parseOsc7Cwd('file:///home/user/project')).toBe('/home/user/project')
  })

  test('decodes URL-encoded path characters', () => {
    expect(parseOsc7Cwd('file://localhost/home/user/my%20project')).toBe(
      '/home/user/my project'
    )
  })

  test('keeps malformed percent escapes instead of dropping the cwd update', () => {
    expect(parseOsc7Cwd('file://localhost/home/user/100%')).toBe(
      '/home/user/100%'
    )
  })

  test('normalizes Windows drive paths from file URLs', () => {
    expect(parseOsc7Cwd('file://host/C:/Users/will/project')).toBe(
      'C:/Users/will/project'
    )
  })

  test('keeps POSIX paths with a colon in the first segment absolute', () => {
    expect(parseOsc7Cwd('file://localhost/a:repo')).toBe('/a:repo')
  })

  test('accepts plain absolute fallback paths', () => {
    expect(parseOsc7Cwd('/tmp/worktree')).toBe('/tmp/worktree')
    expect(parseOsc7Cwd('C:\\Users\\will\\project')).toBe(
      'C:\\Users\\will\\project'
    )
  })

  test('normalizes dot segments in absolute fallback paths', () => {
    expect(parseOsc7Cwd('/tmp/foo/../worktree')).toBe('/tmp/worktree')
    expect(parseOsc7Cwd('C:\\Users\\will\\..\\project')).toBe(
      'C:\\Users\\project'
    )
  })

  test('preserves POSIX UNC double-slash prefixes', () => {
    expect(parseOsc7Cwd('file://host//server/share')).toBe('//server/share')
    expect(parseOsc7Cwd('//server/share')).toBe('//server/share')
    expect(parseOsc7Cwd('///tmp/worktree')).toBe('/tmp/worktree')
  })

  test('preserves non-local file URL hostnames as UNC paths', () => {
    expect(parseOsc7Cwd('file://server/share/project')).toBe(
      '//server/share/project'
    )
  })

  test('can ignore non-local file URL hostnames for POSIX OSC 7 emitters', () => {
    expect(
      parseOsc7Cwd('file://workstation/home/user/my%20project', {
        preserveFileUrlHost: false,
      })
    ).toBe('/home/user/my project')
  })

  test('rejects non-file URLs and relative paths', () => {
    expect(parseOsc7Cwd('https://example.com/home/user')).toBeNull()
    expect(parseOsc7Cwd('relative/path')).toBeNull()
  })

  test.each([
    'https://example.com/home/user',
    'javascript:alert(1)',
    'mailto:user@example.com',
    'ssh://server/home/user',
    'vscode://file/home/user/project',
  ])('rejects non-file URL scheme %s', (value) => {
    expect(parseOsc7Cwd(value)).toBeNull()
  })
})
