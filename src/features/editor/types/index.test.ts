import { describe, test, expect } from 'vitest'
import type {
  VimMode,
  FileLanguage,
  CursorPosition,
  EditorFile,
  EditorState,
  Selection,
} from './index'

describe('Editor Types', () => {
  test('VimMode accepts valid values', () => {
    const modes: VimMode[] = ['NORMAL', 'INSERT', 'VISUAL']
    expect(modes).toHaveLength(3)
  })

  test('FileLanguage accepts valid values', () => {
    const languages: FileLanguage[] = [
      'typescript',
      'javascript',
      'json',
      'markdown',
      'html',
      'css',
      'rust',
      'python',
      'go',
    ]
    expect(languages).toHaveLength(9)
  })

  test('CursorPosition structure', () => {
    const position: CursorPosition = {
      line: 1,
      column: 0,
    }
    expect(position.line).toBe(1)
    expect(position.column).toBe(0)
  })

  test('EditorFile structure', () => {
    const file: EditorFile = {
      id: 'file-1',
      path: '/src/App.tsx',
      name: 'App.tsx',
      content: 'export default function App() {}',
      language: 'typescript',
      modified: false,
      encoding: 'UTF-8',
    }
    expect(file.id).toBe('file-1')
    expect(file.language).toBe('typescript')
  })

  test('EditorState structure', () => {
    const state: EditorState = {
      openFiles: [],
      activeFileIndex: 0,
      vimMode: 'NORMAL',
      cursorPosition: { line: 1, column: 0 },
      showMinimap: true,
    }
    expect(state.vimMode).toBe('NORMAL')
    expect(state.openFiles).toEqual([])
  })

  test('Selection structure', () => {
    const selection: Selection = {
      start: { line: 1, column: 0 },
      end: { line: 5, column: 10 },
    }
    expect(selection.start.line).toBe(1)
    expect(selection.end.line).toBe(5)
  })
})
