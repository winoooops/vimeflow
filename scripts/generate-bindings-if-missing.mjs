import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = dirname(__dirname)
const bindingsDir = join(repoRoot, 'src', 'bindings')
const indexPath = join(bindingsDir, 'index.ts')

if (process.env.CI) {
  process.stdout.write(
    'CI environment detected; skipping on-demand binding generation.\n'
  )
  process.exit(0)
}

const indexSource = readFileSync(indexPath, 'utf8')
const importPattern = /from\s+['"](\.\/[^'"]+)['"]/gu
const matches = [...indexSource.matchAll(importPattern)]
const modules = [...new Set(matches.map((match) => match[1]))]

const missing = modules.filter((moduleName) => {
  const fileName = moduleName.replace(/^\.\//u, '')

  return !existsSync(join(bindingsDir, `${fileName}.ts`))
})

if (missing.length === 0) {
  process.stdout.write('Generated bindings are present; skipping generation.\n')
  process.exit(0)
}

process.stderr.write(
  `Missing generated binding files: ${missing.join(', ')}. Regenerating...\n`
)

const isWindows = process.platform === 'win32'

const result = spawnSync('npm', ['run', 'generate:bindings'], {
  stdio: 'inherit',
  shell: isWindows,
  cwd: repoRoot,
})

if (result.error) {
  process.stderr.write(`Failed to spawn npm: ${result.error.message}\n`)
  process.exit(1)
}

process.exit(result.status ?? 1)
