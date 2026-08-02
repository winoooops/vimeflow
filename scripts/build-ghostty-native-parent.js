// cspell:ignore codesign ghostty Ghostty glslang libghostty mmacosx otool swiftpm xcframework xcrun
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
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

const listFiles = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true })

  return entries.flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      return listFiles(path)
    }

    return [path]
  })
}

const findGhosttyScratchArchive = () => {
  if (!existsSync(ghosttyScratchPlist)) {
    throw new Error(
      `GhosttyKit.xcframework was not resolved: ${ghosttyScratchPlist}`
    )
  }

  const archives = listFiles(ghosttyScratchXcframework)
    .filter((file) => basename(file) === 'libghostty.a')
    .filter((file) => {
      const relative = file.slice(ghosttyScratchXcframework.length + 1)

      return relative.split('/')[0]?.startsWith('macos-')
    })
    .filter((file) => statSync(file).isFile())

  const exactArm64Archive = archives.find((file) =>
    file.includes('/macos-arm64/libghostty.a')
  )

  const universalArm64Archive = archives.find((file) =>
    file.includes('/macos-arm64_')
  )

  const selectedArchive =
    exactArm64Archive ?? universalArm64Archive ?? archives[0]

  if (!selectedArchive) {
    throw new Error(
      `libghostty.a not found in macOS GhosttyKit.xcframework slices: ${ghosttyScratchXcframework}`
    )
  }

  return selectedArchive
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

const ghosttyScratchArchive = findGhosttyScratchArchive()

const ghosttySymbols = execFileSync('nm', ['-gU', ghosttyScratchArchive], {
  encoding: 'utf8',
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
