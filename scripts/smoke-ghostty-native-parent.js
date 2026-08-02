// cspell:ignore codesign dylib dyld ghostty glsl otool
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const nativeDir = resolve(
  process.argv[2] ?? join(repoRoot, 'dist-native', 'ghostty-parent')
)
const addonPath = join(nativeDir, 'ghostty_native_parent.node')
const bridgePath = join(nativeDir, 'libGhosttyElectronBridge.dylib')

const shaderFiles = [
  'cursor_sweep.glsl',
  'cursor_tail.glsl',
  'cursor_warp.glsl',
  'ripple_cursor.glsl',
  'sonic_boom_cursor.glsl',
  'LICENSE',
]

const movementShaderChecks = {
  'cursor_sweep.glsl': 'minDist = currentCursor.w * 0.35',
  'cursor_tail.glsl': 'THRESHOLD_MIN_DISTANCE = 0.35',
  'cursor_warp.glsl': 'THRESHOLD_MIN_DISTANCE = 0.35',
  'ripple_cursor.glsl': 'max(isModeChange, isCursorMove)',
  'sonic_boom_cursor.glsl': 'max(isModeChange, isCursorMove)',
}

const expectedExports = [
  'create',
  'setFrame',
  'setKeybindings',
  'setCursorShader',
  'write',
  'focus',
  'addSecondary',
  'setSecondaryVisible',
  'writeSecondary',
  'focusSecondary',
  'removeSecondary',
  'destroy',
]

const requireFile = (file) => {
  if (!existsSync(file)) {
    throw new Error(`missing native Ghostty artifact: ${file}`)
  }
}

const isMacosSystemDependency = (dependencyPath) =>
  dependencyPath.startsWith('/usr/lib/') ||
  dependencyPath.startsWith('/System/Library/')

const smokeRequireAddon = () => {
  const addon = require(addonPath)
  for (const name of expectedExports) {
    if (typeof addon[name] !== 'function') {
      throw new Error(`native Ghostty addon missing function export: ${name}`)
    }
  }

  for (const file of shaderFiles) {
    requireFile(join(nativeDir, 'shaders', file))
  }

  for (const [file, marker] of Object.entries(movementShaderChecks)) {
    if (
      !readFileSync(join(nativeDir, 'shaders', file), 'utf8').includes(marker)
    ) {
      throw new Error(`cursor shader does not react to short moves: ${file}`)
    }
  }
}

const smokeOtool = (file) => {
  const output = execFileSync('otool', ['-L', file], {
    encoding: 'utf8',
  })

  const dependencies = output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
  const repoPrefix = `${repoRoot}${sep}`

  for (const dependency of dependencies) {
    const dependencyPath = dependency.replace(/\s+\(.*\)$/, '')

    if (dependencyPath === file) {
      continue
    }

    if (dependencyPath.includes(repoPrefix)) {
      throw new Error(`${file} has repo-local dependency: ${dependency}`)
    }

    if (
      dependencyPath.startsWith('/') &&
      !isMacosSystemDependency(dependencyPath) &&
      !existsSync(dependencyPath)
    ) {
      throw new Error(`${file} has missing dependency: ${dependency}`)
    }
  }
}

const smokeCodesign = (file) => {
  execFileSync('codesign', ['--verify', '--strict', file], {
    stdio: 'inherit',
  })
}

requireFile(addonPath)
requireFile(bridgePath)
smokeRequireAddon()
smokeCodesign(addonPath)
smokeCodesign(bridgePath)
smokeOtool(addonPath)
smokeOtool(bridgePath)

process.stdout.write('Ghostty native parent smoke passed\n')
