import path from 'path'
import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import simpleGit from 'simple-git'
import { parse as parseDiffText } from 'diff2html'
import { fileApiPlugin } from './vite-plugin-files'
import packageJson from './package.json' with { type: 'json' }
import type {
  ChangedFile,
  FileDiff,
  DiffHunk,
  DiffLine,
} from './src/features/diff/types'
import {
  buildGitDiffArgs,
  extractHunkPatch,
} from './src/features/diff/services/gitPatch'

const git = simpleGit()
const repoRoot = process.cwd()

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
            let diff = await git.diff(
              buildGitDiffArgs({ safePath, staged, baseBranch })
            )

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
                  ['diff', '--no-index', '--', '/dev/null', safePath],
                  { cwd: repoRoot, encoding: 'utf-8' }
                )

                // git diff --no-index exits with 1 when files differ (expected)
                if (result.stdout) {
                  diff = result.stdout
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

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(fileDiff))

            return
          }

          // POST /api/git/stage
          if (pathname === '/api/git/stage' && req.method === 'POST') {
            const body = await readBody(req)
            const { file, hunkIndex, base } = JSON.parse(body)

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
              typeof hunkIndex === 'number' &&
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

            if (typeof hunkIndex === 'number') {
              // Stage a specific hunk by extracting the patch and applying it
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

              // encoding: 'utf-8' so result.stderr is a string we can
              // forward verbatim. `git apply` failures often carry
              // actionable detail ("error: patch does not apply",
              // "corrupt patch at line N", context mismatch); swallowing
              // them turns every dev-time apply error into a generic 409
              // with no path forward for the developer.
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
            const { file } = JSON.parse(body)

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

            await git.reset(['HEAD', '--', safePath])

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))

            return
          }

          // POST /api/git/discard
          if (pathname === '/api/git/discard' && req.method === 'POST') {
            const body = await readBody(req)
            const { file, hunkIndex, base } = JSON.parse(body)

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
              // Untracked file — remove from disk. `hunkIndex` is
              // irrelevant for this branch (git.clean takes the whole
              // file), so the base= guard does not apply here.
              await git.clean('f', ['--', safePath])
            } else if (fileStatus && fileStatus.index === 'A') {
              // Staged new file — unstage then remove. Same: `hunkIndex`
              // is irrelevant for this branch.
              await git.reset(['HEAD', '--', safePath])
              await git.clean('f', ['--', safePath])
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

              // Same encoding+stderr-forward as /api/git/stage so a
              // failed reverse-apply surfaces git's actual error text.
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
              // Full file discard — restore from HEAD
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
function readBody(
  req: NodeJS.ReadableStream & {
    on: (event: string, listener: (...args: unknown[]) => void) => void
  }
): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer | string) => {
      body += chunk.toString()
    })
    req.on('end', () => resolve(body))
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
    gitApiPlugin(),
    fileApiPlugin(),
    ...(mode === 'electron'
      ? [
          electron({
            // Use vite-plugin-electron/simple's defaults. With root
            // package.json:type=module, the plugin emits:
            //   - main as ESM at dist-electron/main.mjs
            //   - preload as CJS-content with .mjs extension at
            //     dist-electron/preload.mjs (Electron's preload loader
            //     handles this special case)
            // Custom build/lib/rollupOptions configs fight the
            // plugin's defaults because mergeConfig concatenates arrays
            // like `lib.formats`, producing dual ESM+CJS builds that
            // overwrite each other.
            main: {
              entry: 'electron/main.ts',
              onstart: async ({ startup }): Promise<void> => {
                try {
                  await startup(['.'])
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
