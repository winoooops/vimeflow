import { rmSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const npmExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx'

export const cargoIntermediates = [
  path.join(repoRoot, 'target', 'debug', 'build'),
  path.join(repoRoot, 'target', 'debug', 'deps'),
  path.join(repoRoot, 'target', 'debug', 'incremental'),
]

export const cleanupCargoIntermediates = () => {
  if (process.env.CI !== 'true') {
    return
  }

  for (const targetPath of cargoIntermediates) {
    rmSync(targetPath, { recursive: true, force: true })
  }
}

export const runAgentSuite = (spawner = spawnSync) => {
  const result = spawner(
    npmExecutable,
    ['wdio', 'tests/e2e/agent/wdio.conf.ts'],
    {
      cwd: repoRoot,
      env: { ...process.env, VITE_E2E: '1' },
      stdio: 'inherit',
    }
  )

  cleanupCargoIntermediates()

  if (result.error) {
    throw result.error
  }

  if (result.signal) {
    process.kill(process.pid, result.signal)

    return 1
  }

  return result.status ?? 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runAgentSuite())
}
