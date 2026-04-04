import { useState } from 'react'
import type { ReactElement, MouseEvent } from 'react'
import type { FileNode, GitStatus } from '../types'

interface FileTreeNodeProps {
  node: FileNode
  onContextMenu: (event: MouseEvent, node: FileNode) => void
}

/**
 * Get the appropriate icon for a file based on its extension.
 */
const getFileIcon = (filename: string, customIcon?: string): string => {
  if (customIcon) {
    return customIcon
  }

  const extension = filename.split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'tsx':
    case 'ts':
    case 'jsx':
    case 'js':
      return 'code'
    case 'json':
      return 'data_object'
    case 'rs':
      return 'code_blocks'
    case 'md':
      return 'description'
    case 'css':
    case 'scss':
      return 'palette'
    default:
      return 'draft'
  }
}

/**
 * Get the badge color classes for a git status.
 */
const getGitStatusColor = (status: GitStatus): string => {
  switch (status) {
    case 'M':
      return 'bg-[#f9e2af] text-[#1e1e2e]' // Yellow for modified
    case 'A':
      return 'bg-[#a6e3a1] text-[#1e1e2e]' // Green for added
    case 'D':
      return 'bg-[#f38ba8] text-[#1e1e2e]' // Red for deleted
    case 'U':
      return 'bg-[#cba6f7] text-[#1e1e2e]' // Purple for untracked
  }
}

/**
 * Recursive file tree node component.
 */
export const FileTreeNode = ({
  node,
  onContextMenu,
}: FileTreeNodeProps): ReactElement => {
  const [isExpanded, setIsExpanded] = useState(node.defaultExpanded ?? false)

  const handleClick = (): void => {
    if (node.type === 'folder') {
      setIsExpanded(!isExpanded)
    }
  }

  const handleContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    onContextMenu(event, node)
  }

  // Build row classes based on drag states
  let rowClasses =
    'flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-surface-bright cursor-pointer transition-all duration-300'

  if (node.isDragging) {
    rowClasses +=
      ' opacity-60 scale-95 shadow-lg border-dashed border border-outline-variant translate-x-4'
  }

  if (node.isDragTarget) {
    rowClasses += ' bg-secondary-container/20 ring-1 ring-secondary/40'
  }

  const isFolder = node.type === 'folder'
  const folderIcon = isExpanded ? 'folder_open' : 'folder'
  const fileIcon = getFileIcon(node.name, node.icon)

  return (
    <div role="treeitem" aria-expanded={isFolder ? isExpanded : undefined}>
      <div
        className={rowClasses}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Chevron for folders */}
        {isFolder && (
          <span
            className={`material-symbols-outlined text-base text-on-surface-variant transition-transform ${
              isExpanded ? 'rotate-90' : ''
            }`}
            aria-hidden="true"
          >
            chevron_right
          </span>
        )}

        {/* Folder or file icon */}
        <span
          className={`material-symbols-outlined text-base ${
            isFolder && isExpanded
              ? 'text-[#a8c8ff]'
              : 'text-on-surface-variant'
          }`}
          style={
            isFolder && isExpanded
              ? { fontVariationSettings: '"FILL" 1' }
              : undefined
          }
          aria-hidden="true"
        >
          {isFolder ? folderIcon : fileIcon}
        </span>

        {/* Node name */}
        <span className="text-sm text-on-surface">{node.name}</span>

        {/* Git status badge */}
        {node.gitStatus && (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${getGitStatusColor(
              node.gitStatus
            )}`}
            aria-label={`Git status: ${node.gitStatus}`}
          >
            {node.gitStatus}
          </span>
        )}

        {/* Drag target badge */}
        {node.isDragTarget && (
          <span
            className="ml-auto text-[9px] px-2 py-0.5 rounded bg-secondary/40 text-secondary-on font-bold uppercase tracking-wider"
            aria-label="Drop target"
          >
            DROP HERE
          </span>
        )}
      </div>

      {/* Children (recursive) */}
      {isFolder && isExpanded && node.children && node.children.length > 0 && (
        <div className="pl-6 border-l border-[#4a444f]/20 ml-5">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.id}
              node={child}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}
