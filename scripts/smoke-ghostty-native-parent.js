// cspell:ignore dylib ghostty otool
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nativeDir = join(repoRoot, 'dist-native', 'ghostty-parent')
const addonPath = join(nativeDir, 'ghostty_native_parent.node')
const bridgePath = join(nativeDir, 'libGhosttyElectronBridge.dylib')
const expectedExports = ['create', 'setFrame', 'write', 'focus', 'destroy']

const requireFile = (file) => {
  if (!existsSync(file)) {
    throw new Error(`missing native Ghostty artifact: ${file}`)
  }
}

const smokeRequireAddon = () => {
  const addon = require(addonPath)
  for (const name of expectedExports) {
    if (typeof addon[name] !== 'function') {
      throw new Error(`native Ghostty addon missing function export: ${name}`)
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
    if (dependency.startsWith(`${file} `)) {
      continue
    }

    if (dependency.includes('not found')) {
      throw new Error(`${file} has unresolved dependency: ${dependency}`)
    }

    if (dependency.includes(repoPrefix)) {
      throw new Error(`${file} has repo-local dependency: ${dependency}`)
    }
  }
}

requireFile(addonPath)
requireFile(bridgePath)
smokeRequireAddon()
smokeOtool(addonPath)
smokeOtool(bridgePath)

process.stdout.write('Ghostty native parent smoke passed\n')
