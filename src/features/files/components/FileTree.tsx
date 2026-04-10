import { useState } from 'react'
import type { ReactElement, MouseEvent } from 'react'
import type { FileNode, ContextMenuState, ContextMenuAction } from '../types'
import { FileTreeNode } from './FileTreeNode'
import { ContextMenu } from './ContextMenu'

interface FileTreeProps {
  nodes: FileNode[]
  contextMenuActions: ContextMenuAction[]
  /** Path of the directory these root nodes belong to (e.g. `~` or `~/src`). */
  rootPath?: string
  onNodeSelect?: (node: FileNode, fullPath: string) => void
}

/**
 * FileTree container component that manages the tree structure and context menu.
 */
export const FileTree = ({
  nodes,
  contextMenuActions,
  rootPath = '',
  onNodeSelect = undefined,
}: FileTreeProps): ReactElement => {
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    targetNode: null,
  })

  const handleContextMenu = (event: MouseEvent, node: FileNode): void => {
    setContextMenuState({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      targetNode: node,
    })
  }

  const handleCloseContextMenu = (): void => {
    setContextMenuState({
      visible: false,
      x: 0,
      y: 0,
      targetNode: null,
    })
  }

  return (
    <>
      <div role="tree" aria-label="File tree">
        {nodes.map((node) => (
          <FileTreeNode
            key={node.id}
            node={node}
            depth={0}
            parentPath={rootPath}
            onContextMenu={handleContextMenu}
            onNodeSelect={onNodeSelect}
          />
        ))}
      </div>

      <ContextMenu
        visible={contextMenuState.visible}
        x={contextMenuState.x}
        y={contextMenuState.y}
        actions={contextMenuActions}
        onClose={handleCloseContextMenu}
      />
    </>
  )
}
