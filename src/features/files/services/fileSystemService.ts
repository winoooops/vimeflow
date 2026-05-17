import type { FileNode } from '../types'
import type { FileEntry } from '../../../bindings'
import { isDesktop } from '../../../lib/environment'
import { invoke } from '../../../lib/backend'
import { mockFileTree } from '../data/mockFileTree'

export interface IFileSystemService {
  listDir(path: string): Promise<FileNode[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
}

// Join a parent directory path and a child name. Matches the semantics
// of joinPath() in FileTreeNode so identical paths produce identical
// ids — critical because `id` is used as React's reconciler key.
const joinPath = (parent: string, name: string): string => {
  if (parent === '') {
    return name
  }

  return parent.endsWith('/') ? `${parent}${name}` : `${parent}/${name}`
}

// Convert a Desktop filesystem entry to a FileNode, using the canonical
// full path as the `id`. Previously the id was a module-level counter
// (`fs-${nextMockId++}`) that incremented on every listDir call, so
// the same entry received a different id each time the user navigated
// back to a directory — React fully unmounted and remounted every
// FileTreeNode, losing all local state (expand/collapse, rename input).
// Using the full path gives stable, unique identity across navigation.
const toFileNode = (entry: FileEntry, parentPath: string): FileNode => {
  const displayName = entry.type === 'folder' ? `${entry.name}/` : entry.name
  const fullPath = joinPath(parentPath, entry.name)

  return {
    id: fullPath,
    name: displayName,
    type: entry.type,
    children: entry.children?.map((child) => toFileNode(child, fullPath)),
  }
}

class DesktopFileSystemService implements IFileSystemService {
  async listDir(path: string): Promise<FileNode[]> {
    const entries = await invoke<FileEntry[]>('list_dir', {
      request: { path },
    })

    return entries.map((entry) => toFileNode(entry, path))
  }

  async readFile(path: string): Promise<string> {
    return invoke<string>('read_file', {
      request: { path },
    })
  }

  async writeFile(path: string, content: string): Promise<void> {
    await invoke<void>('write_file', {
      request: { path, content },
    })
  }
}

/** Walk mock tree to find children matching a path like "~/src" */
const resolveMockPath = (nodes: FileNode[], segments: string[]): FileNode[] => {
  if (segments.length === 0) {
    return nodes
  }
  const [head, ...rest] = segments

  const match = nodes.find(
    (n) => n.type === 'folder' && n.name.replace(/\/$/, '') === head
  )
  if (!match?.children) {
    return []
  }

  return resolveMockPath(match.children, rest)
}

class MockFileSystemService implements IFileSystemService {
  listDir(path: string): Promise<FileNode[]> {
    // Split "~/src/middleware" → ["src", "middleware"]
    const normalized = path.replace(/^~\/?/, '').replace(/\/$/, '')
    const segments = normalized ? normalized.split('/') : []

    return Promise.resolve(resolveMockPath(mockFileTree, segments))
  }

  readFile(): Promise<string> {
    // Mock implementation — returns placeholder content for browser/test mode.
    // This service is only used in browser mode (not desktop).
    return Promise.resolve('// Mock file content')
  }

  writeFile(): Promise<void> {
    // Mock implementation - no-op
    // This service is only used in browser mode (not desktop)
    return Promise.resolve()
  }
}

export const createFileSystemService = (): IFileSystemService => {
  if (isDesktop()) {
    return new DesktopFileSystemService()
  }

  return new MockFileSystemService()
}
