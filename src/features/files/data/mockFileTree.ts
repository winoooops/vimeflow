import type { FileNode } from '../types'

/**
 * Mock file tree data matching the sidebar design reference.
 * See docs/design/left-sidebar/left-side-bar.png
 */
export const mockFileTree: FileNode[] = [
  {
    id: 'node-src',
    name: 'src/',
    type: 'folder',
    defaultExpanded: true,
    children: [
      {
        id: 'node-middleware',
        name: 'middleware/',
        type: 'folder',
        defaultExpanded: true,
        children: [
          {
            id: 'node-auth-ts',
            name: 'auth.ts',
            type: 'file',
          },
          {
            id: 'node-logger-ts',
            name: 'logger.ts',
            type: 'file',
          },
        ],
      },
      {
        id: 'node-routes',
        name: 'routes/',
        type: 'folder',
        defaultExpanded: false,
      },
    ],
  },
  {
    id: 'node-package',
    name: 'package.json',
    type: 'file',
  },
]

/**
 * Breadcrumb segments showing the current path.
 */
export const mockBreadcrumbs: string[] = ['vibm-project', 'src', 'middleware']

/**
 * Context menu action definitions.
 */
export const contextMenuActions = [
  { id: 'rename' as const, label: 'Rename', icon: 'edit' },
  {
    id: 'delete' as const,
    label: 'Delete',
    icon: 'delete',
    variant: 'danger' as const,
  },
  { label: '', icon: '', separator: true },
  { id: 'copy-path' as const, label: 'Copy Path', icon: 'content_copy' },
  {
    id: 'open-in-editor' as const,
    label: 'Open in Editor',
    icon: 'open_in_new',
  },
  { id: 'view-diff' as const, label: 'View Diff', icon: 'difference' },
]

/**
 * File status bar data.
 */
export interface FileStatusBarData {
  fileCount: number
  totalSize: string
  encoding: string
  gitBranch: string
  liveSyncActive: boolean
}

export const mockFileStatusBarData: FileStatusBarData = {
  fileCount: 142,
  totalSize: '12.4 MB',
  encoding: 'UTF-8',
  gitBranch: 'main*',
  liveSyncActive: true,
}
