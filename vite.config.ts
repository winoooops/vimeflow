import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import simpleGit from 'simple-git'
import { Diff2Html } from 'diff2html'
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
            const status = await git.status()
            const changedFiles: ChangedFile[] = []

            // Process modified, added, deleted files
            for (const file of status.files) {
              let gitStatus: 'M' | 'A' | 'D' | 'U'
              let staged = false

              // Map git status to our status codes
              if (file.index === 'D' || file.working_dir === 'D') {
                gitStatus = 'D'
                staged = file.index === 'D'
              } else if (
                file.index === 'A' ||
                file.working_dir === 'A' ||
                file.index === '?'
              ) {
                gitStatus = 'A'
                staged = file.index === 'A'
              } else if (file.index === 'M' || file.working_dir === 'M') {
                gitStatus = 'M'
                staged = file.index === 'M'
              } else {
                gitStatus = 'U' // Unmerged/conflict
                staged = false
              }

              // Get insertion/deletion counts from diff
              const diffSummary = await git.diffSummary([
                staged ? '--cached' : 'HEAD',
                '--',
                file.path,
              ])

              const fileDiff = diffSummary.files.find(
                (f) => f.file === file.path
              )

              changedFiles.push({
                path: file.path,
                status: gitStatus,
                insertions: fileDiff?.insertions ?? 0,
                deletions: fileDiff?.deletions ?? 0,
                staged,
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

            // Get unified diff from git
            const diffArgs = staged
              ? ['--cached', '--', file]
              : ['HEAD', '--', file]
            const diff = await git.diff(diffArgs)

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
              // Stage specific hunk using git add --patch
              // This is complex, for MVP we'll stage the entire file
              await git.add(file)
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
            const { file } = JSON.parse(body)

            if (!file) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing file parameter' }))

              return
            }

            await git.checkout(['--', file])

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
  const parsed = Diff2Html.parse(diffText)

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

    hunks.push({
      id: `hunk-${i}`,
      header: block.header,
      oldStart: block.oldStartLine,
      oldLines: block.oldStartLine2 - block.oldStartLine,
      newStart: block.newStartLine,
      newLines: block.newStartLine2 - block.newStartLine,
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
