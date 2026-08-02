// cspell:ignore codesign ghostty Ghostty glslang libghostty mmacosx otool swiftpm xcframework xcrun
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  readdirSync,
  rmSync,
} from 'node:fs'
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
const shaderSourceDir = join(repoRoot, 'native/ghostty-parent/shaders')

// SwiftPM keys the artifacts directory by package identity, which is derived
// from the dependency's repo name — so renaming the dependency moves this path.
// Resolve it rather than hardcode a name a rename silently invalidates.
const scratchArtifactsDir = join(scratchDir, 'artifacts')

const resolveScratchXcframework = () => {
  if (!existsSync(scratchArtifactsDir)) {
    return null
  }
  for (const packageIdentity of readdirSync(scratchArtifactsDir)) {
    const candidate = join(
      scratchArtifactsDir,
      packageIdentity,
      'libghostty/GhosttyKit.xcframework'
    )
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

const nodeIncludeDir = [
  join(dirname(dirname(process.execPath)), 'include/node'),
  '/usr/local/include/node',
  '/opt/homebrew/include/node',
].find((candidate) => existsSync(join(candidate, 'node_api.h')))

if (!nodeIncludeDir) {
  throw new Error('node_api.h not found')
}

mkdirSync(outputDir, { recursive: true })

const staleXcframework = resolveScratchXcframework()
if (staleXcframework && !existsSync(join(staleXcframework, 'Info.plist'))) {
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

const ghosttyScratchXcframework = resolveScratchXcframework()
if (!ghosttyScratchXcframework) {
  throw new Error(
    `no GhosttyKit.xcframework under ${scratchArtifactsDir} — check the libghostty-spm-shaders pin`
  )
}

// The macOS slice is named for the architectures it carries — `macos-arm64`
// when built arm64-only, `macos-arm64_x86_64` when universal — so resolve it
// rather than assuming either.
const macosSlice = readdirSync(ghosttyScratchXcframework).find((entry) =>
  entry.startsWith('macos-arm64')
)
if (!macosSlice) {
  throw new Error(
    `no macOS arm64 slice in ${ghosttyScratchXcframework} — check the libghostty-spm-shaders pin`
  )
}

const ghosttyScratchArchive = join(
  ghosttyScratchXcframework,
  macosSlice,
  'libghostty.a'
)

// A universal slice carries a symbol table well past node's 1 MB default,
// which surfaces as a bare ENOBUFS rather than anything about symbols.
const ghosttySymbols = execFileSync('nm', ['-gU', ghosttyScratchArchive], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
if (!ghosttySymbols.includes('_glslang_initialize_process')) {
  throw new Error('libghostty was built without custom shader support')
}

copyFileSync(
  join(scratchDir, 'debug/libGhosttyElectronBridge.dylib'),
  bridgeOutput
)
rmSync(join(outputDir, 'shaders'), { recursive: true, force: true })
cpSync(shaderSourceDir, join(outputDir, 'shaders'), { recursive: true })

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
