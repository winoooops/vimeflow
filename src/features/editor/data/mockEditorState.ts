import type { EditorState } from '../types'
import { mockFiles } from './mockFiles'

export const mockEditorState: EditorState = {
  openFiles: mockFiles,
  activeFileIndex: 0,
  vimMode: 'NORMAL',
  cursorPosition: {
    line: 15,
    column: 23,
  },
  showMinimap: true,
}
