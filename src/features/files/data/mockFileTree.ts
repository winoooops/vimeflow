import type { FileNode } from '../types'

/**
 * Mock file tree data for the Files Explorer UI.
 * Matches the structure shown in docs/design/files_explorer/screen.png
 */
export const mockFileTree: FileNode[] = [
  {
    id: 'node-src',
    name: 'src',
    type: 'folder',
    defaultExpanded: true,
    children: [
      {
        id: 'node-components',
        name: 'components',
        type: 'folder',
        defaultExpanded: true,
        isDragTarget: true,
        children: [
          {
            id: 'node-file-tree',
            name: 'FileTree.tsx',
            type: 'file',
            gitStatus: 'M',
          },
          {
            id: 'node-navbar',
            name: 'NavBar.tsx',
            type: 'file',
            gitStatus: 'M',
          },
          {
            id: 'node-terminal-panel',
            name: 'TerminalPanel.tsx',
            type: 'file',
            isDragging: true,
            gitStatus: 'M',
          },
        ],
      },
      {
        id: 'node-utils',
        name: 'utils',
        type: 'folder',
        defaultExpanded: true,
        children: [
          {
            id: 'node-api-helper',
            name: 'api-helper.rs',
            type: 'file',
            gitStatus: 'A',
          },
        ],
      },
      {
        id: 'node-tests',
        name: 'tests',
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
  {
    id: 'node-tsconfig',
    name: 'tsconfig.json',
    type: 'file',
    gitStatus: 'D',
  },
  {
    id: 'node-readme',
    name: 'README.md',
    type: 'file',
  },
]

/**
 * Breadcrumb segments showing the current path.
 */
export const mockBreadcrumbs: string[] = ['vibm-project', 'src', 'components']

/**
 * Context menu action definitions.
 */
export const contextMenuActions = [
  { label: 'Rename', icon: 'edit' },
  { label: 'Delete', icon: 'delete', variant: 'danger' as const },
  { label: '', icon: '', separator: true },
  { label: 'Copy Path', icon: 'content_copy' },
  { label: 'Open in Editor', icon: 'open_in_new' },
  { label: 'View Diff', icon: 'difference' },
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
