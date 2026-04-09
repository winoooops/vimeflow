import type { FileNode } from '../types'
import { isTauri } from '../../../lib/environment'
import { mockFileTree } from '../data/mockFileTree'

export interface IFileSystemService {
  listDir(path: string): Promise<FileNode[]>
}

interface TauriFileEntry {
  name: string
  type: 'file' | 'folder'
  children?: TauriFileEntry[]
}

let nextMockId = 0

const toFileNode = (entry: TauriFileEntry): FileNode => ({
  id: `fs-${nextMockId++}`,
  name: entry.type === 'folder' ? `${entry.name}/` : entry.name,
  type: entry.type,
  children: entry.children?.map(toFileNode),
})

class TauriFileSystemService implements IFileSystemService {
  async listDir(path: string): Promise<FileNode[]> {
    const { invoke } = await import('@tauri-apps/api/core')

    const entries = await invoke<TauriFileEntry[]>('list_dir', {
      request: { path },
    })

    return entries.map(toFileNode)
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
}

export const createFileSystemService = (): IFileSystemService => {
  if (isTauri()) {
    return new TauriFileSystemService()
  }

  return new MockFileSystemService()
}
