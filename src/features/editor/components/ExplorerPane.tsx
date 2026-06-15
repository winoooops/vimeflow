import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import type { FileNode, ContextMenuAction } from '../types'
import { FileTree } from './FileTree'

interface ExplorerPaneProps {
  fileTree: FileNode[]
  contextMenuActions: ContextMenuAction[]
  isOpen: boolean
  onToggle: () => void
  onNodeSelect?: (node: FileNode) => void
  selectedFileId?: string
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
  selectedFileId = undefined,
}: ExplorerPaneProps): ReactElement => (
  <>
    {/* Floating reopen button - only visible when explorer is collapsed */}
    <IconButton
      icon="chevron_right"
      label="Open explorer panel"
      onClick={onToggle}
      className={`fixed left-[308px] top-14 z-30 w-6 h-10 bg-surface-container text-on-surface-variant hover:bg-surface-container-high rounded-none rounded-r-lg border-r border-y border-outline-variant/10 transition-all duration-300 ${
        isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    />

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
        <IconButton
          icon="keyboard_double_arrow_left"
          label={isOpen ? 'Collapse explorer' : 'Expand explorer'}
          onClick={onToggle}
        />
      </div>

      {/* File tree content */}
      <div className="flex-1 overflow-y-auto px-2 font-label text-[13px]">
        <FileTree
          nodes={fileTree}
          contextMenuActions={contextMenuActions}
          onNodeSelect={onNodeSelect}
          selectedFileId={selectedFileId}
        />
      </div>
    </nav>
  </>
)
