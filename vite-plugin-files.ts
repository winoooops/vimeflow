import path from 'path'
import fs from 'fs/promises'
import type { Plugin } from 'vite'
import type { FileNode, GitStatus } from './src/features/editor/types'

const repoRoot = process.cwd()
const MAX_FILE_SIZE = 1024 * 1024 // 1MB

/**
 * Files and directories to exclude from file tree
 */
const EXCLUDED_PATTERNS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.vscode',
  '.idea',
  'coverage',
  '.DS_Store',
  'Thumbs.db',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.npmrc',
  '.claude',
]

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
 * Validate the real path (resolving symlinks) is within the repo root.
 * Prevents symlink-based path traversal attacks.
 */
async function validateRealPath(filePath: string): Promise<string | null> {
  const relative = validateRepoPath(filePath)

  if (relative === null) {
    return null
  }

  // Reject paths that contain excluded segments (e.g., .git, node_modules, .env)
  if (containsExcludedSegment(relative)) {
    return null
  }

  try {
    const fullPath = path.resolve(repoRoot, relative)
    const realPath = await fs.realpath(fullPath)
    const realRepoRoot = await fs.realpath(repoRoot)
    const realRelative = path.relative(realRepoRoot, realPath)

    // Reject if real path escapes the repo
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      return null
    }

    // Also check resolved path for excluded segments
    if (containsExcludedSegment(realRelative)) {
      return null
    }

    return realRelative
  } catch {
    // Path doesn't exist or can't be resolved
    return null
  }
}

/**
 * Check if a name should be excluded from the file tree
 */
function shouldExclude(name: string): boolean {
  return EXCLUDED_PATTERNS.some(
    (pattern) =>
      name === pattern ||
      name.startsWith(`${pattern}/`) ||
      // Match .env.* variants (e.g., .env.staging, .env.local.backup)
      (pattern === '.env' && name.startsWith('.env.'))
  )
}

/**
 * Check if any segment of a file path matches an excluded pattern.
 * Prevents direct access to excluded files/directories via API params.
 */
function containsExcludedSegment(filePath: string): boolean {
  const segments = filePath.split(path.sep)

  return segments.some((segment) => shouldExclude(segment))
}

/**
 * Get icon for a file based on its extension or name
 */
function getFileIcon(name: string, isFolder: boolean): string {
  if (isFolder) {
    return 'folder'
  }

  const ext = path.extname(name).toLowerCase()

  const iconMap: Record<string, string> = {
    '.ts': 'description',
    '.tsx': 'description',
    '.js': 'description',
    '.jsx': 'description',
    '.json': 'data_object',
    '.md': 'article',
    '.html': 'code',
    '.css': 'palette',
    '.rs': 'settings',
    '.py': 'code',
    '.go': 'code',
    '.yml': 'settings',
    '.yaml': 'settings',
  }

  return iconMap[ext] || 'description'
}

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()

  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.json': 'json',
    '.md': 'markdown',
    '.html': 'html',
    '.css': 'css',
    '.rs': 'rust',
    '.py': 'python',
    '.go': 'go',
  }

  return languageMap[ext] || 'plaintext'
}

/**
 * Build file tree recursively
 */
async function buildFileTree(
  dirPath: string,
  relativePath = ''
): Promise<FileNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = []

  for (const entry of entries) {
    const name = entry.name
    const entryRelativePath = relativePath ? `${relativePath}/${name}` : name

    // Skip excluded files/folders
    if (shouldExclude(name)) {
      continue
    }

    const isFolder = entry.isDirectory()
    const node: FileNode = {
      id: entryRelativePath,
      name,
      type: isFolder ? 'folder' : 'file',
      icon: getFileIcon(name, isFolder),
    }

    // Recursively build children for folders
    if (isFolder) {
      const fullPath = path.join(dirPath, name)
      node.children = await buildFileTree(fullPath, entryRelativePath)

      // Default expand for common source directories
      if (['src', 'lib', 'app'].includes(name)) {
        node.defaultExpanded = true
      }
    }

    nodes.push(node)
  }

  // Sort: folders first, then files, alphabetically
  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1
    }

    return a.name.localeCompare(b.name)
  })
}

/**
 * Vite plugin providing file operations via HTTP API during development
 */
export function fileApiPlugin(): Plugin {
  return {
    name: 'file-api',
    configureServer(server): void {
      server.middlewares.use(async (req, res, next) => {
        // Only handle /api/files/* routes
        if (!req.url?.startsWith('/api/files/')) {
          return next()
        }

        try {
          // Parse URL
          const url = new URL(req.url, `http://${req.headers.host}`)
          const pathname = url.pathname

          // GET /api/files/tree?root=<optional-path>
          if (pathname === '/api/files/tree' && req.method === 'GET') {
            const rootParam = url.searchParams.get('root') || ''
            const rootPath = rootParam
              ? path.join(repoRoot, rootParam)
              : repoRoot

            // Validate root path (including symlink resolution)
            const safePath = rootParam ? await validateRealPath(rootParam) : ''

            if (rootParam && safePath === null) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid root path' }))

              return
            }

            const safeRootPath = safePath
              ? path.join(repoRoot, safePath)
              : repoRoot

            // Build file tree
            const tree = await buildFileTree(safeRootPath, safePath || '')

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(tree))

            return
          }

          // GET /api/files/content?path=<file-path>
          if (pathname === '/api/files/content' && req.method === 'GET') {
            const filePath = url.searchParams.get('path')

            if (!filePath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing path parameter' }))

              return
            }

            // Validate path (including symlink resolution)
            const safePath = await validateRealPath(filePath)

            if (!safePath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid file path' }))

              return
            }

            const fullPath = path.join(repoRoot, safePath)

            // Check file exists and is a file (not directory)
            try {
              const stats = await fs.stat(fullPath)

              if (!stats.isFile()) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Path is not a file' }))

                return
              }

              // Check file size limit
              if (stats.size > MAX_FILE_SIZE) {
                res.writeHead(413, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
                  })
                )

                return
              }
            } catch {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'File not found' }))

              return
            }

            // Read file content
            const content = await fs.readFile(fullPath, 'utf-8')
            const language = detectLanguage(filePath)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ content, language }))

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
