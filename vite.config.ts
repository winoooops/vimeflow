import path from 'path'
import type { IncomingMessage } from 'http'
import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import simpleGit from 'simple-git'
import { parse as parseDiffText } from 'diff2html'
import { fileApiPlugin } from './vite-plugin-files'
import packageJson from './package.json' with { type: 'json' }
import {
  addDevReactRefreshNonce,
  ensureDevReactRefreshNonce,
} from './electron/csp'
import { electronStartupArgs } from './electron/sandbox'
import type {
  ChangedFile,
  FileDiff,
  DiffHunk,
  DiffLine,
} from './src/features/diff/types'
import {
  buildGitDiffArgs,
  extractHunkPatch,
  normalizeBaseBranch,
} from './src/features/diff/services/gitPatch'
import {
  isExpectedMissingGitShow,
  MAX_DIFF_FILE_TEXT_BYTES,
  readFileTextNoFollow,
} from './config/devFileText'

const git = simpleGit()
const repoRoot = process.cwd()
const devReactRefreshNonce = ensureDevReactRefreshNonce()
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'
const MAX_REQUEST_BODY_BYTES = 1_000_000

/**
 * Validate that a hunk patch is safe to pass to `git apply`.
 *
 * Mirrors the Rust `validate_hunk_patch` logic for dev/prod parity:
 * 1. Reject patches containing more than one `diff --git` header
 *    (multi-file patches).
 * 2. Parse `diff --git a/OLD b/NEW` if present and verify that:
 *    - All `--- a/` body paths equal OLD (or /dev/null).
 *    - All `+++ b/` body paths equal NEW (or /dev/null).
 *    - The request `file` equals OLD or NEW (rename-aware).
 * 3. Fallback when no parseable `diff --git` line is present: every body
 *    header path (excluding /dev/null) must equal `file`.
 *
 * Returns null on success, or an error string on failure.
 */
function validateHunkPatch(
  file: string,
  hunkPatch: string | undefined
): string | null {
  if (hunkPatch === undefined) {
    return null
  }

  const lines = hunkPatch.split('\n')

  // Rule 1: reject multi-file patches.
  const diffGitLines = lines.filter((l) => l.startsWith('diff --git '))
  if (diffGitLines.length > 1) {
    return 'multi-file patches not allowed'
  }

  // Collect body `--- a/` / `+++ b/` header paths (stop at first @@).
  const minusPaths: string[] = []
  const plusPaths: string[] = []
  for (const line of lines) {
    if (line.startsWith('@@')) {
      break
    }

    const minusMatch = line.startsWith('--- a/')
      ? line.slice('--- a/'.length)
      : null

    const plusMatch = line.startsWith('+++ b/')
      ? line.slice('+++ b/'.length)
      : null

    if (minusMatch !== null) {
      minusPaths.push(minusMatch)
    } else if (line === '--- /dev/null') {
      minusPaths.push('/dev/null')
    } else if (plusMatch !== null) {
      plusPaths.push(plusMatch)
    } else if (line === '+++ /dev/null') {
      plusPaths.push('/dev/null')
    }
  }

  // Rule 2/3: check header consistency.
  const firstDiffGit = diffGitLines[0] ?? null
  let oldPath: string | null = null
  let newPath: string | null = null

  if (firstDiffGit !== null) {
    // Try to parse "diff --git a/OLD b/NEW" (unquoted paths only).
    const rest = firstDiffGit.slice('diff --git '.length)
    if (!rest.startsWith('"') && rest.startsWith('a/')) {
      const aRest = rest.slice('a/'.length)
      // Use lastIndexOf of " b/" to split OLD from NEW.
      const bMarker = ' b/'
      const splitPos = aRest.lastIndexOf(bMarker)
      if (splitPos !== -1) {
        const candidate_old = aRest.slice(0, splitPos)
        const candidate_new = aRest.slice(splitPos + bMarker.length)
        if (candidate_old.length > 0 && candidate_new.length > 0) {
          oldPath = candidate_old
          newPath = candidate_new
        }
      }
    }
  }

  if (oldPath !== null && newPath !== null) {
    // Strict consistency against parsed (OLD, NEW).
    for (const mp of minusPaths) {
      if (mp !== '/dev/null' && mp !== oldPath) {
        return `patch header inconsistency: '--- a/${mp}' does not match diff --git OLD path '${oldPath}'`
      }
    }

    for (const pp of plusPaths) {
      if (pp !== '/dev/null' && pp !== newPath) {
        return `patch header inconsistency: '+++ b/${pp}' does not match diff --git NEW path '${newPath}'`
      }
    }

    // Rename-aware: request file must be OLD or NEW.
    if (file !== oldPath && file !== newPath) {
      return `patch targets a different file (diff --git OLD='${oldPath}' NEW='${newPath}', req: ${file})`
    }
  } else {
    // Fallback: every body header path (excluding /dev/null) must equal file.
    const allHeaderPaths = [...minusPaths, ...plusPaths].filter(
      (p) => p !== '/dev/null'
    )

    for (const hp of allHeaderPaths) {
      if (hp !== file) {
        return `patch targets a different file (header paths: [${allHeaderPaths.join(', ')}], req: ${file})`
      }
    }
  }

  return null
}

/**
 * Validate that a file path is repo-relative and doesn't escape the repo.
 * Rejects absolute paths, path traversal, and symlinks outside the repo.
 */
function validateRepoPath(filePath: string): string | null {
  if (path.isAbsolute(filePath)) {
    return null
  }

  const resolved = path.resolve(repoRoot, filePath)
  const relative = path.relative(repoRoot, resolved)

  // Reject paths that escape the repo (start with '..')
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }

  return relative
}

const buildGitDiffArgsForPaths = ({
  safePath,
  staged,
  baseBranch,
  paths,
  detectRenames,
}: {
  safePath: string
  staged: boolean
  baseBranch?: string | null
  paths: readonly string[]
  detectRenames: boolean
}): string[] => {
  const args = buildGitDiffArgs({ safePath, staged, baseBranch })
  const separatorIndex = args.indexOf('--')
  const prefix = separatorIndex === -1 ? args : args.slice(0, separatorIndex)

  return [...prefix, ...(detectRenames ? ['-M'] : []), '--', ...paths]
}

const parseRenameSource = (output: string, safePath: string): string | null => {
  const tokens = output.split('\0')
  let index = 0

  while (index < tokens.length) {
    const status = tokens[index]
    if (status === '') {
      index += 1
      continue
    }

    if (status.startsWith('R') || status.startsWith('C')) {
      const src = tokens[index + 1]
      const dst = tokens[index + 2]
      const safeSrc = src === undefined ? null : validateRepoPath(src)
      const safeDst = dst === undefined ? null : validateRepoPath(dst)

      if (safeSrc !== null && safeDst === safePath) {
        return safeSrc
      }

      index += 3
      continue
    }

    index += 2
  }

  return null
}

const detectRenameSource = async (
  safePath: string,
  staged: boolean
): Promise<string | null> => {
  const args = [
    'diff',
    '--name-status',
    '--diff-filter=RC',
    '-M',
    '-z',
    ...(staged ? ['--cached'] : []),
  ]

  try {
    const output = await git.raw(args)

    return parseRenameSource(output, safePath)
  } catch {
    return null
  }
}

const rawDiffFileHeaderHas = (diff: string, marker: string): boolean => {
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      return false
    }
    if (line.startsWith(marker)) {
      return true
    }
  }

  return false
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

const gitBlobSize = async (ref: string): Promise<number | null> => {
  try {
    const output = await git.raw(['cat-file', '-s', ref])
    const size = Number.parseInt(output.trim(), 10)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`git cat-file -s ${ref} returned invalid size`)
    }

    return size
  } catch (err) {
    if (isExpectedMissingGitShow(errorMessage(err))) {
      return null
    }

    throw err
  }
}

const gitShowTextForRef = async (ref: string): Promise<string | null> => {
  const size = await gitBlobSize(ref)
  if (size === null) {
    return null
  }

  if (size > MAX_DIFF_FILE_TEXT_BYTES) {
    return ''
  }

  try {
    return await git.show([ref])
  } catch (err) {
    if (isExpectedMissingGitShow(errorMessage(err))) {
      return null
    }

    throw err
  }
}

const gitShowText = async (
  ref: string,
  stageFallbackRef: string | null = null
): Promise<string> => {
  const text = await gitShowTextForRef(ref)
  if (text !== null) {
    return text
  }

  if (stageFallbackRef !== null) {
    const fallbackText = await gitShowTextForRef(stageFallbackRef)
    if (fallbackText !== null) {
      return fallbackText
    }
  }

  return ''
}

/**
 * Vite plugin providing git operations via HTTP API during development
 */
function gitApiPlugin(): Plugin {
  return {
    name: 'git-api',
    configureServer(server): void {
      server.middlewares.use(async (req, res, next) => {
        // Only handle /api/git/* routes
        if (!req.url?.startsWith('/api/git/')) {
          return next()
        }

        try {
          // Parse URL
          const url = new URL(req.url, `http://${req.headers.host}`)
          const pathname = url.pathname

          // GET /api/git/status
          if (pathname === '/api/git/status' && req.method === 'GET') {
            // Determine base branch to diff against
            const baseBranch = url.searchParams.get('base') ?? 'main'
            const changedFiles: ChangedFile[] = []

            // Get all files changed on this branch vs base (committed changes)
            const branchDiffSummary = await git.diffSummary([baseBranch])

            for (const file of branchDiffSummary.files) {
              // Determine status from diff
              let gitStatus: 'M' | 'A' | 'D' | 'U'

              if (
                file.insertions > 0 &&
                file.deletions === 0 &&
                file.changes === file.insertions
              ) {
                gitStatus = 'A'
              } else if (
                file.deletions > 0 &&
                file.insertions === 0 &&
                file.changes === file.deletions
              ) {
                gitStatus = 'D'
              } else {
                gitStatus = 'M'
              }

              changedFiles.push({
                path: file.file,
                status: gitStatus,
                insertions: file.insertions,
                deletions: file.deletions,
                staged: true,
              })
            }

            // Also include uncommitted working tree changes
            const status = await git.status()

            for (const file of status.files) {
              // Skip if already in branch diff (avoid duplicates)
              const existing = changedFiles.find((f) => f.path === file.path)

              if (existing) {
                // Mark as unstaged if it has working tree changes
                if (file.working_dir !== ' ' && file.working_dir !== '?') {
                  existing.staged = false
                }

                continue
              }

              let gitStatus: 'M' | 'A' | 'D' | 'U'

              if (file.index === 'D' || file.working_dir === 'D') {
                gitStatus = 'D'
              } else if (
                file.index === '?' ||
                file.index === 'A' ||
                file.working_dir === 'A'
              ) {
                gitStatus = 'A'
              } else if (file.index === 'M' || file.working_dir === 'M') {
                gitStatus = 'M'
              } else {
                gitStatus = 'U'
              }

              const wdSummary = await git.diffSummary(['--', file.path])
              const wdFile = wdSummary.files.find((f) => f.file === file.path)

              changedFiles.push({
                path: file.path,
                status: gitStatus,
                insertions: wdFile?.insertions ?? 0,
                deletions: wdFile?.deletions ?? 0,
                staged: file.index !== ' ' && file.index !== '?',
              })
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(changedFiles))

            return
          }

          // GET /api/git/diff?file=<path>&staged=<bool>&base=<branch>
          if (pathname === '/api/git/diff' && req.method === 'GET') {
            const file = url.searchParams.get('file')
            const staged = url.searchParams.get('staged') === 'true'
            const baseBranch = url.searchParams.get('base')

            const safeBaseBranch = staged
              ? null
              : normalizeBaseBranch(baseBranch)
            const untrackedParam = url.searchParams.get('untracked')

            const untracked =
              untrackedParam === null ? undefined : untrackedParam === 'true'

            if (!file) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing file parameter' }))

              return
            }

            // Validate path is repo-relative (prevent reading arbitrary files)
            const safePath = validateRepoPath(file)

            if (!safePath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid file path' }))

              return
            }

            // Default to the working-tree diff so displayed hunk indexes match
            // the hunk patches used by stage/discard. Branch comparison is an
            // explicit read-only mode via `base=<branch>`.
            const renameSource =
              safeBaseBranch === null
                ? await detectRenameSource(safePath, staged)
                : null

            const diffPaths =
              renameSource === null ? [safePath] : [renameSource, safePath]
            let diff = await git.diff(
              buildGitDiffArgsForPaths({
                safePath,
                staged,
                baseBranch: safeBaseBranch,
                paths: diffPaths,
                detectRenames: renameSource !== null,
              })
            )
            let usedUntrackedFallback = false

            // Handle untracked files — git diff won't show them
            if (!diff && untracked !== false) {
              let shouldUseUntrackedFallback = untracked === true
              if (!shouldUseUntrackedFallback) {
                const status = await git.status()
                const fileStatus = status.files.find((f) => f.path === safePath)

                shouldUseUntrackedFallback =
                  fileStatus !== undefined &&
                  (fileStatus.index === '?' || fileStatus.working_dir === '?')
              }

              if (shouldUseUntrackedFallback) {
                // Generate diff for untracked file using --no-index
                const { spawnSync } = await import('child_process')

                const result = spawnSync(
                  'git',
                  ['diff', '--no-index', '--', NULL_DEVICE, safePath],
                  { cwd: repoRoot, encoding: 'utf-8' }
                )

                // git diff --no-index exits with 1 when files differ (expected)
                if (result.stdout) {
                  diff = result.stdout
                  usedUntrackedFallback = true
                }
              }
            }

            if (!diff) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `No diff found for ${file}` }))

              return
            }

            // Parse diff into structured format
            const fileDiff = parseDiff(diff, file)

            // Pierre needs raw old/new file contents alongside the parsed
            // FileDiff. Mirror the Rust producer's 4-case detection rules
            // (Spec Section 4.2) so dev mode and Electron production agree
            // on the response shape.
            const isNewAtBase = rawDiffFileHeaderHas(diff, '--- /dev/null')
            const isDeletion = rawDiffFileHeaderHas(diff, '+++ /dev/null')

            const oldPath =
              usedUntrackedFallback || (staged && isNewAtBase)
                ? safePath
                : validateRepoPath(fileDiff.oldPath ?? safePath)

            const newPath = isDeletion
              ? safePath
              : validateRepoPath(fileDiff.newPath ?? safePath)

            if (oldPath === null || newPath === null) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(
                JSON.stringify({
                  error: 'Diff metadata contained an invalid file path',
                })
              )

              return
            }

            let oldText = ''
            if (!usedUntrackedFallback && !(staged && isNewAtBase)) {
              try {
                if (safeBaseBranch !== null) {
                  oldText = await gitShowText(`${safeBaseBranch}:${oldPath}`)
                } else {
                  const ref = staged ? `HEAD:${oldPath}` : `:${oldPath}`
                  oldText = await gitShowText(
                    ref,
                    staged ? null : `:2:${oldPath}`
                  )
                }
              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error: `Failed to read ${oldPath} at base: ${errorMessage(err)}`,
                  })
                )

                return
              }
            }

            let newText = ''
            if (!isDeletion) {
              try {
                if (staged) {
                  newText = await gitShowText(`:${newPath}`, `:2:${newPath}`)
                } else {
                  const absPath = path.join(repoRoot, newPath)
                  newText = await readFileTextNoFollow(absPath)
                }
              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error: `Failed to read ${newPath} at tip: ${errorMessage(err)}`,
                  })
                )

                return
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                fileDiff,
                oldText,
                newText,
                rawDiff: diff,
                // Dev parity with the Rust producer's `repo_root` (PR4): the
                // dev server runs at the repo root, so process.cwd() is the
                // toplevel the frontend joins with repo-relative paths.
                repoRoot,
              })
            )

            return
          }

          // POST /api/git/stage
          if (pathname === '/api/git/stage' && req.method === 'POST') {
            const body = await readBody(req)
            const { file, hunkPatch, hunkIndex, base } = JSON.parse(body)

            if (!file) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing file parameter' }))

              return
            }

            const safePath = validateRepoPath(file)

            if (!safePath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid file path' }))

              return
            }

            // Refuse hunk-level stage against a branch-comparison diff.
            // The display-side `base=<branch>` mode produces a different
            // hunk list than the working-tree diff used here for patch
            // extraction; mixing the two would apply the wrong hunk. The
            // UI is expected to surface base-comparison views as
            // read-only; this is the server-side belt-and-braces.
            //
            // The guard mirrors `buildGitDiffArgs`'s own trim-then-falsy
            // sentinel for "no base in effect" — empty string and
            // whitespace-only strings produce a working-tree diff there,
            // so they must not trigger this rejection here either.
            if (
              (typeof hunkPatch === 'string' ||
                typeof hunkIndex === 'number') &&
              typeof base === 'string' &&
              base.trim() !== ''
            ) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(
                JSON.stringify({
                  error:
                    'Hunk-level stage is not supported when a base= comparison is in effect; the displayed and working-tree hunk indexes can diverge. Stage the whole file instead.',
                })
              )

              return
            }

            if (typeof hunkPatch === 'string') {
              // PR2+: client pre-extracted the patch and sends it directly.
              // Validate patch-vs-file consistency before spawning git.
              const patchErr = validateHunkPatch(safePath, hunkPatch)
              if (patchErr !== null) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: patchErr }))

                return
              }

              const { spawnSync } = await import('child_process')

              // encoding: 'utf-8' so result.stderr is a string we can
              // forward verbatim. `git apply` failures often carry
              // actionable detail ("error: patch does not apply",
              // "corrupt patch at line N", context mismatch); swallowing
              // them turns every dev-time apply error into a generic 409
              // with no path forward for the developer.
              const result = spawnSync(
                'git',
                ['apply', '--cached', '--whitespace=nowarn', '-'],
                {
                  input: hunkPatch,
                  cwd: repoRoot,
                  encoding: 'utf-8',
                }
              )

              if (result.status !== 0) {
                res.writeHead(409, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error: 'Failed to stage hunk patch',
                    detail: result.stderr ?? '',
                  })
                )

                return
              }
            } else if (typeof hunkIndex === 'number') {
              // Legacy: stage a specific hunk by extracting the patch and applying it
              const fullDiff = await git.diff(
                buildGitDiffArgs({ safePath, staged: false })
              )
              const patch = extractHunkPatch(fullDiff, hunkIndex)

              if (patch === null) {
                res.writeHead(409, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({ error: 'Requested hunk no longer exists' })
                )

                return
              }

              const { spawnSync } = await import('child_process')

              const result = spawnSync('git', ['apply', '--cached', '-'], {
                input: patch,
                cwd: repoRoot,
                encoding: 'utf-8',
              })

              if (result.status !== 0) {
                res.writeHead(409, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error: 'Failed to stage hunk patch',
                    detail: result.stderr ?? '',
                  })
                )

                return
              }
            } else if (hunkIndex !== undefined && hunkIndex !== null) {
              // Reject malformed hunkIndex (string, boolean, etc.) with
              // 400 instead of falling through to whole-file stage. The
              // user clearly meant to stage a hunk but sent a non-number;
              // silently doing something else would be surprising.
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(
                JSON.stringify({
                  error: 'Invalid hunkIndex: expected a number',
                })
              )

              return
            } else {
              await git.add(safePath)
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))

            return
          }

          // POST /api/git/unstage
          if (pathname === '/api/git/unstage' && req.method === 'POST') {
            const body = await readBody(req)
            const { file, hunkPatch } = JSON.parse(body)

            if (!file) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing file parameter' }))

              return
            }

            const safePath = validateRepoPath(file)

            if (!safePath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid file path' }))

              return
            }

            if (typeof hunkPatch === 'string') {
              // PR2+: unstage a specific hunk by applying the patch in reverse
              // to the index. Validate patch-vs-file consistency first.
              const patchErr = validateHunkPatch(safePath, hunkPatch)
              if (patchErr !== null) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: patchErr }))

                return
              }

              const { spawnSync } = await import('child_process')

              const result = spawnSync(
                'git',
                ['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'],
                {
                  input: hunkPatch,
                  cwd: repoRoot,
                  encoding: 'utf-8',
                }
              )

              if (result.status !== 0) {
                res.writeHead(409, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error: 'Failed to unstage hunk patch',
                    detail: result.stderr ?? '',
                  })
                )

                return
              }
            } else {
              await git.reset(['HEAD', '--', safePath])
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))

            return
          }

          // POST /api/git/discard
          if (pathname === '/api/git/discard' && req.method === 'POST') {
            const body = await readBody(req)
            const { file, hunkPatch, hunkIndex, base, scope } = JSON.parse(body)

            if (!file) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing file parameter' }))

              return
            }

            const safePath = validateRepoPath(file)

            if (!safePath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid file path' }))

              return
            }

            // Check if file is untracked or newly added
            const status = await git.status()
            const fileStatus = status.files.find((f) => f.path === safePath)

            if (
              fileStatus &&
              (fileStatus.index === '?' || fileStatus.working_dir === '?')
            ) {
              // Untracked file — remove from disk. `hunkPatch`/`hunkIndex` is
              // irrelevant for this branch (git.clean takes the whole
              // file), so the base= guard does not apply here.
              await git.clean('f', ['--', safePath])
            } else if (fileStatus && fileStatus.index === 'A') {
              // Staged new file — unstage then remove. Same: `hunkPatch`/`hunkIndex`
              // is irrelevant for this branch.
              await git.reset(['HEAD', '--', safePath])
              await git.clean('f', ['--', safePath])
            } else if (typeof hunkPatch === 'string') {
              // PR2+: discard a specific hunk by applying the patch in reverse
              // to the working tree. Validate patch-vs-file consistency first.
              const patchErr = validateHunkPatch(safePath, hunkPatch)
              if (patchErr !== null) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: patchErr }))

                return
              }

              const { spawnSync } = await import('child_process')

              // Same encoding+stderr-forward as /api/git/stage so a
              // failed reverse-apply surfaces git's actual error text.
              const result = spawnSync(
                'git',
                ['apply', '--reverse', '--whitespace=nowarn', '-'],
                {
                  input: hunkPatch,
                  cwd: repoRoot,
                  encoding: 'utf-8',
                }
              )

              if (result.status !== 0) {
                res.writeHead(409, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error: 'Failed to discard hunk patch',
                    detail: result.stderr ?? '',
                  })
                )

                return
              }
            } else if (typeof hunkIndex === 'number') {
              // Belt-and-braces guard inside the hunk branch only.
              // Refuse hunk-level discard when a base= comparison is
              // in effect — the display hunk indexes don't align with
              // the working-tree patch source. Round-1 had this guard
              // at the top of the handler, but that fired the 400
              // before the untracked / staged-new branches above had a
              // chance to run, blocking valid operations on files
              // where `hunkIndex` is irrelevant. Empty/whitespace base
              // strings fall through to the working-tree path in
              // `buildGitDiffArgs`, so we mirror that sentinel.
              if (typeof base === 'string' && base.trim() !== '') {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error:
                      'Hunk-level discard is not supported when a base= comparison is in effect; the displayed and working-tree hunk indexes can diverge. Discard the whole file instead.',
                  })
                )

                return
              }

              // Discard a specific hunk via reverse patch
              const fullDiff = await git.diff(
                buildGitDiffArgs({ safePath, staged: false })
              )
              const patch = extractHunkPatch(fullDiff, hunkIndex)

              if (patch === null) {
                res.writeHead(409, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({ error: 'Requested hunk no longer exists' })
                )

                return
              }

              const { spawnSync } = await import('child_process')

              const result = spawnSync('git', ['apply', '-R', '-'], {
                input: patch,
                cwd: repoRoot,
                encoding: 'utf-8',
              })

              if (result.status !== 0) {
                res.writeHead(409, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error: 'Failed to discard hunk patch',
                    detail: result.stderr ?? '',
                  })
                )

                return
              }
            } else if (hunkIndex !== undefined && hunkIndex !== null) {
              // Same malformed-payload guard as /api/git/stage: reject
              // non-number hunkIndex with 400 instead of falling through
              // to whole-file discard.
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(
                JSON.stringify({
                  error: 'Invalid hunkIndex: expected a number',
                })
              )

              return
            } else {
              // Full file discard.
              // scope='both': unstage any staged modifications first so the
              // subsequent checkout restores the file fully to HEAD.
              // scope='unstaged' (default): only discard working-tree edits.
              if (scope === 'both') {
                await git.reset(['HEAD', '--', safePath])
              }

              await git.checkout(['--', safePath])
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))

            return
          }

          // Unknown route
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not found' }))
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error'
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
  }
}

function reactRefreshNoncePlugin(): Plugin {
  return {
    name: 'vimeflow-react-refresh-nonce',
    apply: 'serve',
    enforce: 'post',
    transformIndexHtml(html): string {
      return addDevReactRefreshNonce(html, devReactRefreshNonce)
    },
  }
}

/**
 * Parse unified diff output into FileDiff structure
 */
function parseDiff(diffText: string, filePath: string): FileDiff {
  // Use diff2html to parse the diff
  const parsed = parseDiffText(diffText)

  if (parsed.length === 0) {
    throw new Error('Failed to parse diff')
  }

  const file = parsed[0]
  const hunks: DiffHunk[] = []

  for (let i = 0; i < file.blocks.length; i++) {
    const block = file.blocks[i]
    const lines: DiffLine[] = []

    for (const line of block.lines) {
      let type: DiffLine['type']
      if (line.type === 'insert') {
        type = 'added'
      } else if (line.type === 'delete') {
        type = 'removed'
      } else {
        type = 'context'
      }

      lines.push({
        type,
        oldLineNumber:
          line.oldNumber !== undefined && line.oldNumber > 0
            ? line.oldNumber
            : undefined,
        newLineNumber:
          line.newNumber !== undefined && line.newNumber > 0
            ? line.newNumber
            : undefined,
        content: line.content,
        highlights: [], // Word-level diff not implemented in MVP
      })
    }

    // Parse line counts from hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const headerMatch = block.header.match(
      /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
    )
    const oldLineCount = headerMatch ? parseInt(headerMatch[2] ?? '1', 10) : 0
    const newLineCount = headerMatch ? parseInt(headerMatch[4] ?? '1', 10) : 0

    hunks.push({
      id: `hunk-${i}`,
      header: block.header,
      oldStart: block.oldStartLine,
      oldLines: oldLineCount,
      newStart: block.newStartLine,
      newLines: newLineCount,
      lines,
    })
  }

  return {
    filePath,
    oldPath: file.oldName || filePath,
    newPath: file.newName || filePath,
    hunks,
  }
}

/**
 * Read request body as string
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let byteLength = 0
    let rejected = false
    req.on('data', (chunk: Buffer | string) => {
      if (rejected) {
        return
      }

      byteLength += Buffer.byteLength(chunk)
      if (byteLength > MAX_REQUEST_BODY_BYTES) {
        rejected = true
        reject(new Error('Request body too large'))
        req.destroy()

        return
      }

      body += chunk.toString()
    })

    req.on('end', () => {
      if (!rejected) {
        resolve(body)
      }
    })
    req.on('error', reject)
  })
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Tauri serves embedded production assets from its app protocol, so emitted
  // asset URLs must be relative instead of rooted at `/`.
  base: './',
  plugins: [
    react(),
    reactRefreshNoncePlugin(),
    gitApiPlugin(),
    fileApiPlugin(),
    ...(mode === 'electron'
      ? [
          electron({
            // Use vite-plugin-electron/simple's defaults. The plugin emits:
            //   - main as ESM at dist-electron/main.js — the plugin's `lib`
            //     config hard-codes `fileName: () => '[name].js'`, so the
            //     extension stays .js even under root package.json:type=module
            //   - preload as CJS-content with .mjs extension at
            //     dist-electron/preload.mjs — the plugin's separate preload
            //     config overrides entryFileNames with the .mjs suffix to
            //     trigger Electron's preload-loader special case
            // Verify after a build with `ls dist-electron/`; if either
            // filename ever changes after a vite-plugin-electron version
            // bump, `tests/e2e/shared/electron-app.ts:appEntryPoint`,
            // `package.json:main`, and `electron/main.ts:createWindow`'s
            // preload path all need updating in lockstep.
            // Custom build/lib/rollupOptions configs fight the
            // plugin's defaults because mergeConfig concatenates arrays
            // like `lib.formats`, producing dual ESM+CJS builds that
            // overwrite each other.
            main: {
              entry: 'electron/main.ts',
              onstart: async ({ startup }): Promise<void> => {
                try {
                  // DEV ONLY: keep Electron's renderer sandbox enabled unless
                  // a developer explicitly opts out for a Linux host that cannot
                  // launch Chromium's sandbox. Use VIMEFLOW_NO_SANDBOX=1 rather
                  // than inferring the weaker mode from CI or headless display
                  // state.
                  await startup(electronStartupArgs())
                } catch (error: unknown) {
                  const message =
                    error instanceof Error
                      ? (error.stack ?? error.message)
                      : String(error)

                  process.stderr.write(
                    `[electron] startup failed: ${message}\n`
                  )

                  throw error
                }
              },
              vite: {
                build: { outDir: 'dist-electron' },
              },
            },
            preload: {
              input: 'electron/preload.ts',
              vite: {
                build: { outDir: 'dist-electron' },
              },
            },
          }),
        ]
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    // esbuild's minifier mangles @xterm/xterm 6.0.0's const-enum IIFE in
    // requestMode (drops `let r`, rewrites `r ||= {}` as assignment to
    // an undeclared `i`), throwing ReferenceError when a TUI sends DECRQM
    // queries (nvim, less, htop). Terser preserves the pattern correctly.
    minify: 'terser',
  },
  worker: {
    // Pierre's worker entry (@pierre/diffs/worker/worker.js) is loaded by
    // WorkerPoolContextProvider via `new Worker(new URL(..., import.meta.url))`
    // — Vite's worker bundler emits it as a separate ESM asset so it's
    // resolvable in both dev and production builds.
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/pierre-worker-[hash].js',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/.vimeflow/**',
        '**/target/**',
        '**/.codex*/**',
        '**/.git/**',
        '**/dist-electron/**',
      ],
    },
  },
}))
