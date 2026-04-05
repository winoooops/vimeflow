import type { ReactElement } from 'react'
import type { FileNode, ContextMenuAction } from '../types'
import { FileTree } from './FileTree'

interface ExplorerPaneProps {
  fileTree: FileNode[]
  contextMenuActions: ContextMenuAction[]
  isOpen: boolean
  onToggle: () => void
  onNodeSelect?: (node: FileNode) => void
}

/**
 * ExplorerPane component - Left sidebar file explorer with collapsible behavior.
 */
export const ExplorerPane = ({
  fileTree,
  contextMenuActions,
  isOpen,
  onToggle,
  onNodeSelect = undefined,
}: ExplorerPaneProps): ReactElement => (
  <nav
    className={`
        ${isOpen ? 'w-64' : 'w-0'}
        bg-surface-container-low/50
        backdrop-blur-lg
        flex
        flex-col
        border-r
        border-outline-variant/10
        transition-all
        duration-300
        overflow-hidden
      `}
    aria-label="File explorer"
    data-testid="explorer-pane"
  >
    {/* Header */}
    <div className="p-4 flex items-center justify-between">
      <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant/70">
        EXPLORER
      </span>
      <button
        onClick={onToggle}
        className="text-on-surface-variant/60 hover:text-on-surface transition-colors"
        aria-label={isOpen ? 'Collapse explorer' : 'Expand explorer'}
        type="button"
      >
        <span className="material-symbols-outlined text-[20px]">
          keyboard_double_arrow_left
        </span>
      </button>
    </div>

    {/* File tree content */}
    <div className="flex-1 overflow-y-auto px-2 font-label text-[13px]">
      <FileTree
        nodes={fileTree}
        contextMenuActions={contextMenuActions}
        onNodeSelect={onNodeSelect}
      />
    </div>
  </nav>
)
