import type { ReactElement } from 'react'
import { FileTree } from '../../../files/components/FileTree'
import { contextMenuActions } from '../../../files/data/mockFileTree'
import { useFileTree } from '../../../files/hooks/useFileTree'
import type { FileNode } from '../../../files/types'

export interface FileExplorerProps {
  cwd?: string
  onFileSelect?: (node: FileNode) => void
}

/**
 * FileExplorer displays the file tree in the sidebar.
 * Reads real files via Tauri, falls back to mock data in browser.
 * Click a folder to navigate into it. Use the back button or breadcrumb to go up.
 */
export const FileExplorer = ({
  cwd = '~',
  onFileSelect = undefined,
}: FileExplorerProps): ReactElement => {
  const {
    nodes,
    currentPath,
    isLoading,
    error,
    refresh,
    navigateTo,
    navigateUp,
  } = useFileTree(cwd)

  const handleNodeSelect = (node: FileNode, fullPath: string): void => {
    if (node.type === 'folder') {
      // Navigate into the folder — the `fullPath` already includes the ancestry.
      navigateTo(fullPath)
    } else {
      // File: emit with canonical full path as the id so consumers can read/save it.
      onFileSelect?.({ ...node, id: fullPath })
    }
  }

  // Display a short label for the current path
  const pathLabel =
    currentPath === '~'
      ? '~'
      : (currentPath.split('/').filter(Boolean).pop() ?? currentPath)

  const isRoot = currentPath === '~' || currentPath === '/'

  return (
    <div className="flex h-full flex-col px-4 pt-3" data-testid="file-explorer">
      {/* Header */}
      <div className="mb-1 flex items-center gap-2">
        <span className="material-symbols-outlined text-base text-on-surface/50">
          folder_open
        </span>
        <h3 className="flex-1 font-label text-xs font-semibold uppercase tracking-wider text-on-surface/50">
          File Explorer
        </h3>
        <button
          type="button"
          onClick={refresh}
          className="material-symbols-outlined text-sm text-on-surface/30 transition-colors hover:text-on-surface/60"
          aria-label="Refresh file tree"
          title="Refresh"
        >
          refresh
        </button>
      </div>

      {/* Path bar */}
      <div className="mb-1 flex items-center gap-1">
        <button
          type="button"
          onClick={navigateUp}
          disabled={isRoot}
          className={`material-symbols-outlined shrink-0 rounded p-0.5 text-sm transition-colors ${
            isRoot
              ? 'text-on-surface/20'
              : 'text-on-surface/50 hover:bg-white/5 hover:text-on-surface'
          }`}
          aria-label="Go to parent directory"
          title="Parent directory"
        >
          arrow_upward
        </button>
        <span
          className="min-w-0 truncate font-mono text-xs text-on-surface/50"
          title={currentPath}
        >
          {pathLabel}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="py-4 text-center font-mono text-xs text-on-surface/40">
            Loading...
          </div>
        )}
        {error && (
          <div className="py-4 text-center font-mono text-xs text-red-400">
            {error}
          </div>
        )}
        {!isLoading && !error && (
          <FileTree
            nodes={nodes}
            contextMenuActions={contextMenuActions}
            rootPath={currentPath}
            onNodeSelect={handleNodeSelect}
          />
        )}
      </div>
    </div>
  )
}
