import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
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

export const worktreeDiskUsage = (path) => {
  if (!existsSync(path)) {
    return null
  }

  return statSync(path).size
}
