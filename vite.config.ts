import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import simpleGit from 'simple-git'
import { parse as parseDiffText } from 'diff2html'
import type {
  ChangedFile,
  FileDiff,
  DiffHunk,
  DiffLine,
} from './src/features/diff/types'

const git = simpleGit()

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

          // GET /api/git/diff?file=<path>&staged=<bool>
          if (pathname === '/api/git/diff' && req.method === 'GET') {
            const file = url.searchParams.get('file')
            const staged = url.searchParams.get('staged') === 'true'

            if (!file) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing file parameter' }))

              return
            }

            // Always diff against the base branch to show all changes
            let diff = ''

            if (staged) {
              diff = await git.diff(['--cached', '--', file])
            } else {
              // Diff against main to capture all committed + working tree changes
              diff = await git.diff(['main', '--', file])
            }

            // Handle untracked files — git diff won't show them
            if (!diff) {
              const status = await git.status()
              const fileStatus = status.files.find((f) => f.path === file)

              if (
                fileStatus &&
                (fileStatus.index === '?' || fileStatus.working_dir === '?')
              ) {
                // Generate diff for untracked file using --no-index
                // Use spawnSync with args array to prevent command injection
                const { spawnSync } = await import('child_process')
                const safeFile = file.replace(/\.\./g, '') // reject path traversal

                const result = spawnSync(
                  'git',
                  ['diff', '--no-index', '--', '/dev/null', safeFile],
                  { cwd: process.cwd(), encoding: 'utf-8' }
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
            const { file, hunkIndex } = JSON.parse(body)

            if (!file) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing file parameter' }))

              return
            }

            if (hunkIndex !== undefined) {
              // Stage a specific hunk by extracting the patch and applying it
              const fullDiff = await git.diff(['main', '--', file])

              if (fullDiff) {
                const hunks = fullDiff.split(/(?=^@@\s)/m)
                const header = hunks.shift() ?? '' // diff header lines

                if (hunkIndex < hunks.length) {
                  const patch = header + hunks[hunkIndex]
                  const { execSync } = await import('child_process')
                  execSync('git apply --cached -', {
                    input: patch,
                    cwd: process.cwd(),
                  })
                } else {
                  await git.add(file)
                }
              } else {
                await git.add(file)
              }
            } else {
              await git.add(file)
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

            await git.reset(['HEAD', '--', file])

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))

            return
          }

          // POST /api/git/discard
          if (pathname === '/api/git/discard' && req.method === 'POST') {
            const body = await readBody(req)
            const { file, hunkIndex } = JSON.parse(body)

            if (!file) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing file parameter' }))

              return
            }

            // Check if file is untracked or newly added
            const status = await git.status()
            const fileStatus = status.files.find((f) => f.path === file)

            if (
              fileStatus &&
              (fileStatus.index === '?' || fileStatus.working_dir === '?')
            ) {
              // Untracked file — remove from disk
              await git.clean('f', ['--', file])
            } else if (fileStatus && fileStatus.index === 'A') {
              // Staged new file — unstage then remove
              await git.reset(['HEAD', '--', file])
              await git.clean('f', ['--', file])
            } else if (hunkIndex !== undefined) {
              // Discard a specific hunk via reverse patch
              const fullDiff = await git.diff(['main', '--', file])

              if (fullDiff) {
                const hunks = fullDiff.split(/(?=^@@\s)/m)
                const header = hunks.shift() ?? ''

                if (hunkIndex < hunks.length) {
                  const patch = header + hunks[hunkIndex]
                  const { execSync } = await import('child_process')
                  execSync('git apply -R -', {
                    input: patch,
                    cwd: process.cwd(),
                  })
                } else {
                  await git.checkout(['--', file])
                }
              } else {
                await git.checkout(['--', file])
              }
            } else {
              // Full file discard — restore from HEAD
              await git.checkout(['--', file])
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
export default defineConfig({
  plugins: [react(), gitApiPlugin()],
})
