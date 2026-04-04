/**
 * Git status indicator for files.
 */
export type GitStatus = 'M' | 'A' | 'D' | 'U'

/**
 * Represents a file or folder node in the file tree.
 */
export interface FileNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: FileNode[]
  gitStatus?: GitStatus
  icon?: string
  defaultExpanded?: boolean
  isDragTarget?: boolean
  isDragging?: boolean
}

/**
 * Represents an action in the context menu.
 */
export interface ContextMenuAction {
  label: string
  icon: string
  variant?: 'danger'
  separator?: boolean
}

/**
 * Represents the state of the context menu.
 */
export interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  targetNode: FileNode | null
}

/**
 * Type guard to check if a value is a valid GitStatus.
 */
export const isGitStatus = (value: unknown): value is GitStatus =>
  typeof value === 'string' && ['M', 'A', 'D', 'U'].includes(value)

/**
 * Type guard to check if an unknown value is a valid FileNode.
 */
export const isFileNode = (value: unknown): value is FileNode => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Check required fields
  if (
    typeof obj.id !== 'string' ||
    typeof obj.name !== 'string' ||
    typeof obj.type !== 'string' ||
    !['file', 'folder'].includes(obj.type)
  ) {
    return false
  }

  // Validate optional children array
  if (obj.children !== undefined) {
    if (!Array.isArray(obj.children)) {
      return false
    }
    // All items must be valid FileNodes
    if (!obj.children.every(isFileNode)) {
      return false
    }
  }

  // Validate optional gitStatus
  if (obj.gitStatus !== undefined && !isGitStatus(obj.gitStatus)) {
    return false
  }

  // Validate optional icon
  if (obj.icon !== undefined && typeof obj.icon !== 'string') {
    return false
  }

  // Validate optional defaultExpanded
  if (
    obj.defaultExpanded !== undefined &&
    typeof obj.defaultExpanded !== 'boolean'
  ) {
    return false
  }

  // Validate optional isDragTarget
  if (obj.isDragTarget !== undefined && typeof obj.isDragTarget !== 'boolean') {
    return false
  }

  // Validate optional isDragging
  if (obj.isDragging !== undefined && typeof obj.isDragging !== 'boolean') {
    return false
  }

  return true
}

/**
 * Type guard to check if an unknown value is a valid ContextMenuAction.
 */
export const isContextMenuAction = (
  value: unknown
): value is ContextMenuAction => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Check required fields
  if (typeof obj.label !== 'string' || typeof obj.icon !== 'string') {
    return false
  }

  // Validate optional variant
  if (obj.variant !== undefined && obj.variant !== 'danger') {
    return false
  }

  // Validate optional separator
  if (obj.separator !== undefined && typeof obj.separator !== 'boolean') {
    return false
  }

  return true
}

/**
 * Find the path of node names from root to a target node by ID.
 * Returns an empty array if the node is not found.
 */
export const getNodePath = (
  nodes: readonly FileNode[],
  targetId: string
): string[] => {
  for (const node of nodes) {
    if (node.id === targetId) {
      return [node.name]
    }

    if (node.children) {
      const childPath = getNodePath(node.children, targetId)
      if (childPath.length > 0) {
        return [node.name, ...childPath]
      }
    }
  }

  return []
}

/**
 * Type guard to check if an unknown value is a valid ContextMenuState.
 */
export const isContextMenuState = (
  value: unknown
): value is ContextMenuState => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Check required fields
  if (
    typeof obj.visible !== 'boolean' ||
    typeof obj.x !== 'number' ||
    typeof obj.y !== 'number'
  ) {
    return false
  }

  // Validate targetNode (can be null or FileNode)
  if (obj.targetNode !== null && !isFileNode(obj.targetNode)) {
    return false
  }

  return true
}
