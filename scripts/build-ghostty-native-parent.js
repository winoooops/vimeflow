// cspell:ignore codesign ghostty Ghostty libghostty mmacosx otool swiftpm xcframework xcrun
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const smokeDir = join(repoRoot, 'native/ghostty-helper')
const outputDir = join(repoRoot, 'dist-native/ghostty-parent')
const scratchDir = join(tmpdir(), 'vimeflow-ghostty-electron-parent-swiftpm')

const addonSource = join(
  repoRoot,
  'native/ghostty-parent/ghostty_native_parent.cc'
)
const addonOutput = join(outputDir, 'ghostty_native_parent.node')
const bridgeOutput = join(outputDir, 'libGhosttyElectronBridge.dylib')

const ghosttyScratchXcframework = join(
  scratchDir,
  'artifacts/libghostty-spm/libghostty/GhosttyKit.xcframework'
)
const ghosttyScratchPlist = join(ghosttyScratchXcframework, 'Info.plist')

const nodeIncludeDir = [
  join(dirname(dirname(process.execPath)), 'include/node'),
  '/usr/local/include/node',
  '/opt/homebrew/include/node',
].find((candidate) => existsSync(join(candidate, 'node_api.h')))

if (!nodeIncludeDir) {
  throw new Error('node_api.h not found')
}

mkdirSync(outputDir, { recursive: true })

if (existsSync(ghosttyScratchXcframework) && !existsSync(ghosttyScratchPlist)) {
  rmSync(scratchDir, { recursive: true, force: true })
}

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
  bridgeOutput
)

// Node native addons are Mach-O bundles; N-API symbols are resolved from Node at load time.
execFileSync(
  'xcrun',
  [
    'clang++',
    '-std=c++20',
    '-bundle',
    '-mmacosx-version-min=13.0',
    '-undefined',
    'dynamic_lookup',
    '-I',
    nodeIncludeDir,
    addonSource,
    '-o',
    addonOutput,
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  }
)

// Keep the packaged addon from advertising a repo-local install name in otool output.
execFileSync('install_name_tool', [
  '-id',
  '@rpath/ghostty_native_parent.node',
  addonOutput,
])

for (const file of [addonOutput, bridgeOutput]) {
  execFileSync('codesign', ['--force', '--sign', '-', file])
}

process.stdout.write(`Ghostty parent addon built in ${outputDir}\n`)
