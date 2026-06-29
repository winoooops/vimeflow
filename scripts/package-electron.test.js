// cspell:ignore ghostty
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  USAGE,
  UsageError,
  TargetError,
  buildCommands,
  formatCommand,
  main,
  parseArgs,
  resolveTarget,
  runCommand,
} from './package-electron.mjs'

describe('package-electron script', () => {
  const originalExitCode = process.exitCode

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = originalExitCode
  })

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

  test('parses help flags only when used alone', () => {
    expect(parseArgs(['-h'])).toEqual({
      target: 'auto',
      dryRun: false,
      help: true,
    })

    expect(parseArgs(['--help'])).toEqual({
      target: 'auto',
      dryRun: false,
      help: true,
    })

    expect(() => parseArgs(['-h', 'linux-x64'])).toThrow(UsageError)
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

  test('target helpers reject unrecognized targets with diagnostic errors', () => {
    expect(() =>
      resolveTarget('linux-arm64', { platform: 'linux', arch: 'arm64' })
    ).toThrow(TargetError)

    expect(() =>
      resolveTarget('linux-arm64', { platform: 'linux', arch: 'arm64' })
    ).toThrow(/unrecognized target/)

    expect(() => buildCommands('linux-arm64')).toThrow(
      /unrecognized package target/
    )
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

    expect(buildCommands('mac-arm64')).toContainEqual([
      'npm',
      ['run', 'ghostty:native-parent:build'],
    ])

    expect(buildCommands('mac-arm64')).toContainEqual([
      'npm',
      ['run', 'ghostty:native-parent:smoke'],
    ])
  })

  test('dry-run formatting quotes arguments that need shell escaping', () => {
    expect(formatCommand(['echo', ['hello world', "it's"]])).toBe(
      "echo 'hello world' 'it'\\''s'"
    )
  })

  test('main prints usage for help without running build commands', () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const runner = vi.fn()

    main(['--help'], { platform: 'linux', arch: 'x64' }, runner)

    expect(write).toHaveBeenCalledWith(USAGE)
    expect(runner).not.toHaveBeenCalled()
  })

  test('main dry-run prints commands in order without executing them', () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const runner = vi.fn()

    main(['linux-x64', '--dry-run'], { platform: 'linux', arch: 'x64' }, runner)

    expect(runner).not.toHaveBeenCalled()
    expect(write.mock.calls.map(([line]) => line)).toEqual([
      'Packaging Vimeflow for linux-x64 on linux/x64\n',
      '+ npm run type-check\n',
      '+ vite build --mode electron\n',
      '+ npm run backend:build:release\n',
      '+ electron-builder --linux AppImage --x64\n',
    ])
  })

  test('main runs build commands in order for the resolved target', () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const runner = vi.fn()

    main(['mac-arm64'], { platform: 'darwin', arch: 'arm64' }, runner)

    expect(write).toHaveBeenCalledWith(
      'Packaging Vimeflow for mac-arm64 on darwin/arm64\n'
    )

    expect(runner.mock.calls.map(([command]) => command)).toEqual(
      buildCommands('mac-arm64')
    )
  })

  test('main rejects targets that do not match the host before running commands', () => {
    const runner = vi.fn()

    expect(() =>
      main(['linux-x64'], { platform: 'darwin', arch: 'arm64' }, runner)
    ).toThrow(TargetError)

    expect(() =>
      main(['mac-arm64'], { platform: 'linux', arch: 'x64' }, runner)
    ).toThrow(TargetError)

    expect(() =>
      main(['auto'], { platform: 'win32', arch: 'x64' }, runner)
    ).toThrow(TargetError)

    expect(runner).not.toHaveBeenCalled()
  })

  test('main stops running build commands when the runner requests it', () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const runner = vi.fn(() => false)

    main(['linux-x64'], { platform: 'linux', arch: 'x64' }, runner)

    expect(write).toHaveBeenCalledWith(
      'Packaging Vimeflow for linux-x64 on linux/x64\n'
    )
    expect(runner).toHaveBeenCalledTimes(1)
  })

  test('runCommand reports and re-raises signaled subprocesses', () => {
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)

    const spawner = vi.fn(() => ({
      error: null,
      signal: 'SIGTERM',
      status: null,
    }))

    process.exitCode = undefined

    const result = runCommand(
      ['electron-builder', ['--mac', 'dmg', '--arm64']],
      spawner
    )

    expect(result).toBe(false)
    expect(spawner).toHaveBeenCalledWith(
      'electron-builder',
      ['--mac', 'dmg', '--arm64'],
      { stdio: 'inherit' }
    )

    expect(write).toHaveBeenCalledWith(
      'package-electron: electron-builder --mac dmg --arm64 killed by signal SIGTERM\n'
    )
    expect(process.exitCode).toBe(1)
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
  })
})
