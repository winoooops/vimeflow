// cspell:ignore ghostty Ghostty swiftpm xcrun dynamiclib
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const smokeDir = join(
  repoRoot,
  'docs/exploration/2026-06-27-ghostty-native-macos-runtime/ghostty-native-macos-smoke'
)
const outputDir = join(repoRoot, 'dist-native/ghostty-parent')
const scratchDir = join(tmpdir(), 'vimeflow-ghostty-electron-parent-swiftpm')

const addonSource = join(
  repoRoot,
  'native/ghostty-parent/ghostty_native_parent.cc'
)

const nodeIncludeDir = [
  join(dirname(dirname(process.execPath)), 'include/node'),
  '/usr/local/include/node',
  '/opt/homebrew/include/node',
].find((candidate) => existsSync(join(candidate, 'node_api.h')))

if (!nodeIncludeDir) {
  throw new Error('node_api.h not found')
}

mkdirSync(outputDir, { recursive: true })

execFileSync(
  'swift',
  ['build', '--product', 'GhosttyElectronBridge', '--scratch-path', scratchDir],
  {
    cwd: smokeDir,
    stdio: 'inherit',
  }
)

copyFileSync(
  join(scratchDir, 'debug/libGhosttyElectronBridge.dylib'),
  join(outputDir, 'libGhosttyElectronBridge.dylib')
)

execFileSync(
  'xcrun',
  [
    'clang++',
    '-std=c++20',
    '-dynamiclib',
    '-undefined',
    'dynamic_lookup',
    '-I',
    nodeIncludeDir,
    addonSource,
    '-o',
    join(outputDir, 'ghostty_native_parent.node'),
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  }
)

process.stdout.write(`Ghostty parent addon built in ${outputDir}\n`)
