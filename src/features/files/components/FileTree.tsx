import { useState, useRef, useEffect, useCallback } from 'react'
import type { ReactElement, MouseEvent, KeyboardEvent } from 'react'
import type { FileNode, ContextMenuState, ContextMenuAction } from '../types'
import { FileTreeNode } from './FileTreeNode'
import { ContextMenu } from './ContextMenu'

interface FileTreeProps {
  nodes: FileNode[]
  contextMenuActions: ContextMenuAction[]
  /**
   * Path of the directory these root nodes belong to (e.g. `~` or `~/src`).
   * Defaults to `~` so a caller that forgets to pass it still emits
   * canonical `~`-relative paths to `onNodeSelect` instead of silently
   * dropping the root and producing bare filenames (which the Tauri
   * `read_file` / `write_file` commands reject as non-absolute).
   */
  rootPath?: string
  onNodeSelect?: (node: FileNode, fullPath: string) => void
}

/**
 * FileTree container component that manages the tree structure, context menu,
 * and vim-style keyboard navigation (h/j/k/l + arrows).
 *
 * Navigation model: selection is tracked via a DOM-querying approach rather
 * than lifted tree state. Every rendered row in `FileTreeNode` carries a
 * `data-file-tree-row` marker along with depth/expansion metadata, so the
 * parent tree can treat the visible rows as an ordered flat list without
 * having to hoist per-node expansion state out of each `FileTreeNode`.
 *
 * j/ArrowDown → next visible row
 * k/ArrowUp   → previous visible row
 * l/Enter/ArrowRight → activate current row (expand folder or open file)
 * h/ArrowLeft → collapse expanded folder, otherwise jump to parent row
 *
 * The selected row is always scrolled into view with `scrollIntoView({ block:
 * 'nearest' })` so a long tree scrolls to follow the cursor instead of
 * stranding it off-screen.
 */
export const FileTree = ({
  nodes,
  contextMenuActions,
  rootPath = '~',
  onNodeSelect = undefined,
}: FileTreeProps): ReactElement => {
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    targetNode: null,
  })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

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

  const getRows = useCallback((): HTMLElement[] => {
    if (!containerRef.current) {
      return []
    }

    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(
        '[data-file-tree-row="true"]'
      )
    )
  }, [])

  // Reset selection when the tree content changes (e.g. directory nav).
  // Clamp the stored index to the new row count so a stale index doesn't
  // point past the end of the visible list.
  useEffect(() => {
    const rows = getRows()
    setSelectedIndex((prev) => {
      if (rows.length === 0) {
        return 0
      }

      return Math.min(prev, rows.length - 1)
    })
  }, [nodes, getRows])

  // Paint the selection + scroll-follow behavior. Runs after every render
  // so newly-expanded folders correctly re-mark the active row and bring it
  // into view.
  useEffect(() => {
    const rows = getRows()
    rows.forEach((row, i) => {
      if (i === selectedIndex) {
        row.setAttribute('data-selected', 'true')
        row.scrollIntoView({ block: 'nearest' })
      } else {
        row.removeAttribute('data-selected')
      }
    })
  })

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const rows = getRows()
    if (rows.length === 0) {
      return
    }

    const key = event.key

    if (key === 'j' || key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((i) => Math.min(rows.length - 1, i + 1))

      return
    }

    if (key === 'k' || key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((i) => Math.max(0, i - 1))

      return
    }

    if (key === 'l' || key === 'Enter' || key === 'ArrowRight') {
      event.preventDefault()
      rows[selectedIndex]?.click()

      return
    }

    if (key === 'h' || key === 'ArrowLeft') {
      event.preventDefault()
      const current = rows[selectedIndex]

      // Expanded folder → collapse in place.
      if (current.getAttribute('data-is-expanded') === 'true') {
        current.click()

        return
      }

      // Otherwise walk backwards to the nearest row with shallower depth
      // (the visual parent) and select it.
      const depth = Number(current.getAttribute('data-depth') ?? '0')
      for (let i = selectedIndex - 1; i >= 0; i -= 1) {
        const candidateDepth = Number(
          rows[i].getAttribute('data-depth') ?? '0'
        )
        if (candidateDepth < depth) {
          setSelectedIndex(i)

          return
        }
      }
    }
  }

  return (
    <>
      <div
        ref={containerRef}
        role="tree"
        aria-label="File tree"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
      >
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
