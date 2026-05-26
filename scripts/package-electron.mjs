#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const USAGE = `Usage: scripts/package-electron.mjs [auto|linux-x64|mac-arm64] [--dry-run]

Targets:
  auto       Build linux-x64 on Linux x64, mac-arm64 on macOS Apple Silicon.
  linux-x64  Build the Linux x64 AppImage. Must run on a Linux x64 host.
  mac-arm64  Build the macOS arm64 DMG. Must run on an Apple Silicon Mac.
`

const VALID_TARGETS = new Set(['auto', 'linux-x64', 'mac-arm64'])

export class UsageError extends Error {}

export class TargetError extends Error {}

export function parseArgs(args) {
  if (args.length > 2) {
    throw new UsageError(USAGE)
  }

  if (args.includes('-h') || args.includes('--help')) {
    if (args.length > 1) {
      throw new UsageError(USAGE)
    }

    return { target: 'auto', dryRun: false, help: true }
  }

  let dryRun = false
  let selectedTarget

  for (const arg of args) {
    if (arg === '--dry-run') {
      if (dryRun) {
        throw new UsageError(USAGE)
      }

      dryRun = true
      continue
    }

    if (!VALID_TARGETS.has(arg) || selectedTarget !== undefined) {
      throw new UsageError(USAGE)
    }

    selectedTarget = arg
  }

  return { target: selectedTarget ?? 'auto', dryRun, help: false }
}

export function resolveTarget(target, host) {
  if (target === 'auto') {
    if (host.platform === 'linux' && host.arch === 'x64') {
      return 'linux-x64'
    }

    if (host.platform === 'darwin' && host.arch === 'arm64') {
      return 'mac-arm64'
    }

    throw new TargetError(
      `unsupported host ${host.platform}/${host.arch}; supported package hosts are Linux x64 and macOS arm64`
    )
  }

  if (target === 'linux-x64') {
    if (host.platform === 'linux' && host.arch === 'x64') {
      return target
    }

    throw new TargetError(
      'linux-x64 packaging must run on a Linux x64 host so the bundled Rust sidecar is an ELF x64 binary'
    )
  }

  if (target === 'mac-arm64') {
    if (host.platform === 'darwin' && host.arch === 'arm64') {
      return target
    }

    throw new TargetError(
      'mac-arm64 packaging must run on an Apple Silicon macOS host so the bundled Rust sidecar is a Mach-O arm64 binary'
    )
  }

  throw new UsageError(USAGE)
}

export function buildCommands(target) {
  const commands = [
    ['npm', ['run', 'type-check']],
    ['vite', ['build', '--mode', 'electron']],
    ['npm', ['run', 'backend:build:release']],
  ]

  if (target === 'linux-x64') {
    return [...commands, ['electron-builder', ['--linux', 'AppImage', '--x64']]]
  }

  if (target === 'mac-arm64') {
    return [...commands, ['electron-builder', ['--mac', 'dmg', '--arm64']]]
  }

  throw new UsageError(USAGE)
}

const quoteArg = (arg) => {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) {
    return arg
  }

  return `'${arg.replaceAll("'", "'\\''")}'`
}

export function formatCommand([command, args]) {
  return [command, ...args].map(quoteArg).join(' ')
}

const runCommand = ([command, args]) => {
  const result = spawnSync(command, args, { stdio: 'inherit' })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

export function main(argv, host = process) {
  const parsed = parseArgs(argv)

  if (parsed.help) {
    process.stdout.write(USAGE)

    return
  }

  const target = resolveTarget(parsed.target, host)
  process.stdout.write(
    `Packaging Vimeflow for ${target} on ${host.platform}/${host.arch}\n`
  )

  for (const command of buildCommands(target)) {
    if (parsed.dryRun) {
      process.stdout.write(`+ ${formatCommand(command)}\n`)
      continue
    }

    runCommand(command)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(error.message)
      process.exit(1)
    }

    if (error instanceof Error) {
      process.stderr.write(`package-electron: ${error.message}\n`)
      process.exit(1)
    }

    throw error
  }
}
