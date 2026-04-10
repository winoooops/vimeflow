import type { ReactElement } from 'react'
import { FileTree } from '../../../files/components/FileTree'
import {
  mockFileTree,
  contextMenuActions,
} from '../../../files/data/mockFileTree'
import type { FileNode } from '../../../files/types'

export interface FilesPanelProps {
  onFileSelect?: (node: FileNode) => void
}

/**
 * FilesPanel displays the file tree in the sidebar context panel (260px width).
 * Shows project files with git status badges and context menu support.
 */
export const FilesPanel = ({
  onFileSelect = undefined,
}: FilesPanelProps): ReactElement => (
  <div
    className="flex flex-1 flex-col overflow-y-auto px-3 py-4"
    data-testid="files-panel"
  >
    <FileTree
      nodes={mockFileTree}
      contextMenuActions={contextMenuActions}
      onNodeSelect={(node) => onFileSelect?.(node)}
    />
  </div>
)
