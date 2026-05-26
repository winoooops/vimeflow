import { describe, expect, test } from 'vitest'
import {
  USAGE,
  UsageError,
  TargetError,
  buildCommands,
  formatCommand,
  parseArgs,
  resolveTarget,
} from './package-electron.mjs'

describe('package-electron script', () => {
  test('parses auto dry-run syntax before or after the target', () => {
    expect(parseArgs(['--dry-run'])).toEqual({
      target: 'auto',
      dryRun: true,
      help: false,
    })

    expect(parseArgs(['linux-x64', '--dry-run'])).toEqual({
      target: 'linux-x64',
      dryRun: true,
      help: false,
    })

    expect(parseArgs(['--dry-run', 'linux-x64'])).toEqual({
      target: 'linux-x64',
      dryRun: true,
      help: false,
    })
  })

  test('rejects unknown targets with usage text', () => {
    expect(() => parseArgs(['win-x64'])).toThrow(UsageError)
    expect(() => parseArgs(['win-x64'])).toThrow(USAGE)
    expect(() => parseArgs(['linux-x64', 'mac-arm64'])).toThrow(UsageError)
    expect(() => parseArgs(['--dry-run', '--dry-run'])).toThrow(UsageError)
  })

  test('auto target resolves only supported package hosts', () => {
    expect(resolveTarget('auto', { platform: 'linux', arch: 'x64' })).toBe(
      'linux-x64'
    )

    expect(resolveTarget('auto', { platform: 'darwin', arch: 'arm64' })).toBe(
      'mac-arm64'
    )

    expect(() =>
      resolveTarget('auto', { platform: 'darwin', arch: 'x64' })
    ).toThrow(TargetError)
  })

  test('explicit targets reject hosts that would bundle the wrong sidecar binary', () => {
    expect(() =>
      resolveTarget('linux-x64', { platform: 'darwin', arch: 'arm64' })
    ).toThrow(/ELF x64/)

    expect(() =>
      resolveTarget('mac-arm64', { platform: 'linux', arch: 'x64' })
    ).toThrow(/Mach-O arm64/)
  })

  test('build commands pin the requested Electron Builder platform and arch', () => {
    expect(buildCommands('linux-x64').at(-1)).toEqual([
      'electron-builder',
      ['--linux', 'AppImage', '--x64'],
    ])

    expect(buildCommands('mac-arm64').at(-1)).toEqual([
      'electron-builder',
      ['--mac', 'dmg', '--arm64'],
    ])
  })

  test('dry-run formatting quotes arguments that need shell escaping', () => {
    expect(formatCommand(['echo', ['hello world', "it's"]])).toBe(
      "echo 'hello world' 'it'\\''s'"
    )
  })
})
