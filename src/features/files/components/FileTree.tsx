import { useState } from 'react'
import type { ReactElement } from 'react'
import type { FileNode, ContextMenuState, ContextMenuAction } from '../types'
import { FileTreeNode } from './FileTreeNode'
import { ContextMenu } from './ContextMenu'

interface FileTreeProps {
  nodes: FileNode[]
  contextMenuActions: ContextMenuAction[]
}

/**
 * FileTree container component that manages the tree structure and context menu.
 */
export const FileTree = ({
  nodes,
  contextMenuActions,
}: FileTreeProps): ReactElement => {
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    targetNode: null,
  })

  const handleContextMenu = (
    event: React.MouseEvent,
    node: FileNode
  ): void => {
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
      <div
        className="bg-surface-container-low rounded-xl p-4 max-w-4xl mx-auto"
        role="tree"
        aria-label="File tree"
      >
        {nodes.map((node) => (
          <FileTreeNode
            key={node.id}
            node={node}
            onContextMenu={handleContextMenu}
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
