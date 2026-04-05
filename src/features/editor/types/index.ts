export type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL'

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
