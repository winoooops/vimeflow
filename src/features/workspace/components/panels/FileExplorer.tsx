import type { ReactElement } from 'react'
import { FileTree } from '../../../files/components/FileTree'
import {
  mockFileTree,
  contextMenuActions,
} from '../../../files/data/mockFileTree'
import type { FileNode } from '../../../files/types'

export interface FileExplorerProps {
  onFileSelect?: (node: FileNode) => void
}

/**
 * FileExplorer displays the file tree in the sidebar (v2 design).
 * Features glass panel container with FILE EXPLORER header.
 */
export const FileExplorer = ({
  onFileSelect = undefined,
}: FileExplorerProps): ReactElement => (
  <div
    className="flex h-1/2 flex-col border-t border-white/5 pt-4 px-3"
    data-testid="file-explorer"
  >
    {/* Header */}
    <div className="mb-3 flex items-center gap-2">
      <span className="material-symbols-outlined text-lg text-on-surface/70">
        folder_open
      </span>
      <h3 className="font-label text-xs font-semibold uppercase tracking-wider text-on-surface/70">
        File Explorer
      </h3>
    </div>

    {/* File tree wrapped in glass panel */}
    <div className="glass-panel flex-1 overflow-y-auto rounded-xl p-3">
      <FileTree
        nodes={mockFileTree}
        contextMenuActions={contextMenuActions}
        onNodeSelect={onFileSelect}
      />
    </div>
  </div>
)
