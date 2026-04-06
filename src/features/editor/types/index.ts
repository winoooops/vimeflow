export type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL' | 'COMMAND'

export type FileLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'html'
  | 'css'
  | 'rust'
  | 'python'
  | 'go'

export interface CursorPosition {
  line: number
  column: number
}

export interface EditorFile {
  id: string
  path: string
  name: string
  content: string
  language: FileLanguage
  modified: boolean
  encoding: string
}

export interface EditorState {
  openFiles: EditorFile[]
  activeFileIndex: number
  vimMode: VimMode
  cursorPosition: CursorPosition
  showMinimap: boolean
}

export interface Selection {
  start: CursorPosition
  end: CursorPosition
}

/**
 * Represents a tab in the editor tab bar.
 */
export interface EditorTab {
  id: string
  fileName: string
  filePath: string
  icon: string
  isActive: boolean
  isDirty: boolean
  content?: string
}

/**
 * Represents the state displayed in the editor status bar.
 */
export interface EditorStatusBarState {
  vimMode: VimMode
  gitBranch: string
  syncStatus: { behind: number; ahead: number }
  fileName: string
  encoding: string
  language: string
  cursor: CursorPosition
}

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
 * Type guard to check if a value is a valid VimMode.
 */
export const isVimMode = (value: unknown): value is VimMode =>
  typeof value === 'string' &&
  ['NORMAL', 'INSERT', 'VISUAL', 'COMMAND'].includes(value)

/**
 * Type guard to check if a value is a valid CursorPosition.
 */
export const isCursorPosition = (value: unknown): value is CursorPosition => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return typeof obj.line === 'number' && typeof obj.column === 'number'
}

/**
 * Type guard to check if a value is a valid EditorTab.
 */
export const isEditorTab = (value: unknown): value is EditorTab => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  return (
    typeof obj.id === 'string' &&
    typeof obj.fileName === 'string' &&
    typeof obj.filePath === 'string' &&
    typeof obj.icon === 'string' &&
    typeof obj.isActive === 'boolean' &&
    typeof obj.isDirty === 'boolean'
  )
}

/**
 * Type guard to check if a value is a valid GitStatus.
 */
export const isGitStatus = (value: unknown): value is GitStatus =>
  typeof value === 'string' && ['M', 'A', 'D', 'U'].includes(value)

/**
 * Type guard to check if a value is a valid FileNode.
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

  return true
}

/**
 * Type guard to check if a value is a valid ContextMenuAction.
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
