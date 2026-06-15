import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, join } from 'node:path'

const QA_WORKTREE_RE = /^qa-pr-(\d+)$/

export const qaPrFromWorktreeName = (name) => {
  const match = basename(name).match(QA_WORKTREE_RE)

  return match ? Number(match[1]) : null
}

const pidFromLock = (lockPath, readFile = readFileSync) => {
  try {
    return Number((readFile(lockPath, 'utf8').match(/pid (\d+)/) || [])[1])
  } catch {
    return 0
  }
}

export const lockOwnerIsActiveRunner = (
  pid,
  { kill = process.kill, readFile = readFileSync } = {}
) => {
  if (!(pid > 0)) {
    return false
  }

  try {
    kill(pid, 0)
  } catch (e) {
    return e.code === 'EPERM'
  }

  try {
    return readFile(`/proc/${pid}/cmdline`, 'utf8').includes('run.js')
  } catch {
    return true
  }
}

const activeLock = (lockPath, deps = {}) =>
  existsSync(lockPath) &&
  lockOwnerIsActiveRunner(pidFromLock(lockPath, deps.readFile), deps)

const gitCommonDir = (repoRoot, exec = execFileSync) => {
  try {
    return exec(
      'git',
      [
        '-C',
        repoRoot,
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
  } catch {
    return join(repoRoot, '.git')
  }
}

const dirEntries = (dir) => {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory()
  )
}

const removeDir = (path, rm = rmSync) => {
  rm(path, { recursive: true, force: true })
}

export const cleanupQaWorktrees = ({
  repoRoot,
  log = null,
  deps = {},
} = {}) => {
  if (!repoRoot) {
    throw new Error('repoRoot is required')
  }

  const rm = deps.rm || rmSync
  const worktreesDir = join(repoRoot, '.claude', 'worktrees')
  const locksDir = join(repoRoot, 'scripts', 'qa-runner', '.locks')
  const metadataDir = join(gitCommonDir(repoRoot, deps.exec), 'worktrees')
  const touched = new Set()

  const summary = {
    worktreesRemoved: 0,
    metadataRemoved: 0,
    locksRemoved: 0,
    skippedActive: 0,
  }

  const cleanupPr = (pr, { worktreePath, metadataPath }) => {
    const lockPath = join(locksDir, `pr-${pr}.lock`)
    if (activeLock(lockPath, deps)) {
      summary.skippedActive += 1

      return
    }

    if (worktreePath && existsSync(worktreePath)) {
      removeDir(worktreePath, rm)
      summary.worktreesRemoved += 1
    }
    if (metadataPath && existsSync(metadataPath)) {
      removeDir(metadataPath, rm)
      summary.metadataRemoved += 1
    }
    if (existsSync(lockPath)) {
      rm(lockPath, { force: true })
      summary.locksRemoved += 1
    }
  }

  for (const entry of dirEntries(worktreesDir)) {
    const pr = qaPrFromWorktreeName(entry.name)
    if (!pr) {
      continue
    }
    touched.add(pr)
    cleanupPr(pr, {
      worktreePath: join(worktreesDir, entry.name),
      metadataPath: join(metadataDir, entry.name),
    })
  }

  for (const entry of dirEntries(metadataDir)) {
    const pr = qaPrFromWorktreeName(entry.name)
    if (!pr || touched.has(pr)) {
      continue
    }
    cleanupPr(pr, {
      metadataPath: join(metadataDir, entry.name),
    })
  }

  const removed =
    summary.worktreesRemoved + summary.metadataRemoved + summary.locksRemoved
  if (removed || summary.skippedActive) {
    log?.(
      `worker cleanup: removed ${summary.worktreesRemoved} worktree(s), ` +
        `${summary.metadataRemoved} git metadata dir(s), ` +
        `${summary.locksRemoved} stale lock(s); ` +
        `skipped ${summary.skippedActive} active PR(s)`
    )
  }

  return summary
}

export const parseDfPkOutput = (output, path) => {
  const line = String(output || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1)
  if (!line) {
    return null
  }

  const columns = line.trim().split(/\s+/)
  if (columns.length < 6) {
    return null
  }

  const [filesystem, totalKbRaw, usedKbRaw, availableKbRaw, capacityRaw] =
    columns
  const totalKb = Number(totalKbRaw)
  const usedKb = Number(usedKbRaw)
  const availableKb = Number(availableKbRaw)
  const capacityPercent = Number(String(capacityRaw).replace(/%$/, ''))

  if (
    !Number.isFinite(totalKb) ||
    !Number.isFinite(usedKb) ||
    !Number.isFinite(availableKb) ||
    !Number.isFinite(capacityPercent) ||
    totalKb <= 0
  ) {
    return null
  }

  return {
    path,
    filesystem,
    totalKb,
    usedKb,
    availableKb,
    capacityPercent,
    freePercent: Math.round((availableKb / totalKb) * 1000) / 10,
    mount: columns.slice(5).join(' '),
  }
}

export const worktreeDiskUsage = (
  path,
  { exec = execFileSync, exists = existsSync } = {}
) => {
  if (!path || !exists(path)) {
    return null
  }

  try {
    return parseDfPkOutput(
      exec('df', ['-Pk', path], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
      path
    )
  } catch {
    return null
  }
}
