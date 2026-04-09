import { useState } from 'react'
import type { ReactElement, MouseEvent } from 'react'
import type { FileNode, GitStatus } from '../types'

interface FileTreeNodeProps {
  node: FileNode
  depth?: number
  onContextMenu: (event: MouseEvent, node: FileNode) => void
  onNodeSelect?: (node: FileNode) => void
}

/**
 * Get the appropriate Material Symbols icon for a file based on its extension.
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
      return 'description'
    case 'json':
      return 'settings'
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
 * Get the text color class for a git status indicator.
 */
const getGitStatusColor = (status: GitStatus): string => {
  switch (status) {
    case 'M':
      return 'text-amber-400'
    case 'A':
      return 'text-emerald-400'
    case 'D':
      return 'text-red-400'
    case 'U':
      return 'text-purple-400'
  }
}

/**
 * Recursive file tree node — minimal, compact design.
 */
export const FileTreeNode = ({
  node,
  depth = 0,
  onContextMenu,
  onNodeSelect = undefined,
}: FileTreeNodeProps): ReactElement => {
  const [isExpanded, setIsExpanded] = useState(node.defaultExpanded ?? false)

  const handleClick = (): void => {
    if (node.type === 'folder' && node.children !== undefined) {
      setIsExpanded(!isExpanded)
    }
    onNodeSelect?.(node)
  }

  const handleContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    onContextMenu(event, node)
  }

  const isFolder = node.type === 'folder'
  const folderIcon = isExpanded ? 'folder_open' : 'folder'
  const fileIcon = getFileIcon(node.name, node.icon)
  const indent = depth * 16

  return (
    <div role="treeitem" aria-expanded={isFolder ? isExpanded : undefined}>
      <div
        className="group flex h-7 cursor-pointer items-center gap-1.5 rounded px-1 text-on-surface/80 transition-colors hover:bg-white/5"
        style={{ paddingLeft: `${indent + 4}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Chevron for folders */}
        {isFolder ? (
          <span
            className={`material-symbols-outlined text-sm text-on-surface/40 transition-transform ${
              isExpanded ? 'rotate-90' : ''
            }`}
            aria-hidden="true"
          >
            chevron_right
          </span>
        ) : (
          /* Spacer to align files with folder names */
          <span className="w-[18px] shrink-0" />
        )}

        {/* Icon */}
        <span
          className={`material-symbols-outlined text-sm ${
            isFolder
              ? isExpanded
                ? 'text-sky-400'
                : 'text-on-surface/50'
              : 'text-on-surface/40'
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

        {/* Name */}
        <span className="min-w-0 truncate font-mono text-xs">{node.name}</span>

        {/* Git status — subtle letter, no badge */}
        {node.gitStatus && (
          <span
            className={`ml-auto shrink-0 font-mono text-[10px] font-bold ${getGitStatusColor(node.gitStatus)}`}
            aria-label={`Git status: ${node.gitStatus}`}
          >
            {node.gitStatus}
          </span>
        )}
      </div>

      {/* Children (recursive) */}
      {isFolder && isExpanded && node.children && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onContextMenu={onContextMenu}
              onNodeSelect={onNodeSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
