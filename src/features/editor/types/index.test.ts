import { describe, test, expect } from 'vitest'
import type {
  VimMode,
  FileLanguage,
  CursorPosition,
  EditorFile,
  EditorState,
  Selection,
  EditorTab,
  EditorStatusBarState,
  FileNode,
  GitStatus,
  ContextMenuAction,
  ContextMenuState,
} from './index'
import {
  isVimMode,
  isCursorPosition,
  isEditorTab,
  isGitStatus,
  isFileNode,
  isContextMenuAction,
} from './index'

describe('Editor Types', () => {
  test('VimMode accepts valid values', () => {
    const modes: VimMode[] = ['NORMAL', 'INSERT', 'VISUAL', 'COMMAND']
    expect(modes).toHaveLength(4)
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

  test('EditorTab structure', () => {
    const tab: EditorTab = {
      id: 'tab-1',
      fileName: 'App.tsx',
      filePath: '/src/App.tsx',
      icon: 'description',
      isActive: true,
      isDirty: false,
    }
    expect(tab.fileName).toBe('App.tsx')
    expect(tab.isActive).toBe(true)
  })

  test('EditorStatusBarState structure', () => {
    const state: EditorStatusBarState = {
      vimMode: 'NORMAL',
      gitBranch: 'main',
      syncStatus: { behind: 0, ahead: 2 },
      fileName: 'App.tsx',
      encoding: 'UTF-8',
      language: 'TypeScript',
      cursor: { line: 10, column: 5 },
    }
    expect(state.gitBranch).toBe('main')
    expect(state.syncStatus.ahead).toBe(2)
  })

  test('GitStatus accepts valid values', () => {
    const statuses: GitStatus[] = ['modified', 'added', 'deleted', 'untracked']
    expect(statuses).toHaveLength(4)
  })

  test('FileNode structure', () => {
    const node: FileNode = {
      id: 'node-1',
      name: 'App.tsx',
      type: 'file',
      gitStatus: 'modified',
      icon: 'description',
    }
    expect(node.type).toBe('file')
    expect(node.gitStatus).toBe('modified')
  })

  test('FileNode with children structure', () => {
    const folder: FileNode = {
      id: 'folder-1',
      name: 'src',
      type: 'folder',
      defaultExpanded: true,
      children: [
        {
          id: 'file-1',
          name: 'App.tsx',
          type: 'file',
        },
      ],
    }
    expect(folder.children).toHaveLength(1)
    expect(folder.defaultExpanded).toBe(true)
  })

  test('ContextMenuAction structure', () => {
    const action: ContextMenuAction = {
      label: 'Delete',
      icon: 'delete',
      variant: 'danger',
      separator: false,
    }
    expect(action.variant).toBe('danger')
  })

  test('ContextMenuState structure', () => {
    const state: ContextMenuState = {
      visible: true,
      x: 100,
      y: 200,
      targetNode: {
        id: 'node-1',
        name: 'App.tsx',
        type: 'file',
      },
    }
    expect(state.visible).toBe(true)
    expect(state.x).toBe(100)
  })
})

describe('Type Guards', () => {
  describe('isVimMode', () => {
    test('returns true for valid VimMode values', () => {
      expect(isVimMode('NORMAL')).toBe(true)
      expect(isVimMode('INSERT')).toBe(true)
      expect(isVimMode('VISUAL')).toBe(true)
      expect(isVimMode('COMMAND')).toBe(true)
    })

    test('returns false for invalid values', () => {
      expect(isVimMode('INVALID')).toBe(false)
      expect(isVimMode(123)).toBe(false)
      expect(isVimMode(null)).toBe(false)
      expect(isVimMode(undefined)).toBe(false)
      expect(isVimMode({})).toBe(false)
    })
  })

  describe('isCursorPosition', () => {
    test('returns true for valid CursorPosition', () => {
      expect(isCursorPosition({ line: 1, column: 0 })).toBe(true)
      expect(isCursorPosition({ line: 100, column: 50 })).toBe(true)
    })

    test('returns false for invalid values', () => {
      expect(isCursorPosition({ line: 'invalid', column: 0 })).toBe(false)
      expect(isCursorPosition({ line: 1 })).toBe(false)
      expect(isCursorPosition({ column: 0 })).toBe(false)
      expect(isCursorPosition(null)).toBe(false)
      expect(isCursorPosition('string')).toBe(false)
    })
  })

  describe('isEditorTab', () => {
    test('returns true for valid EditorTab', () => {
      const tab: EditorTab = {
        id: 'tab-1',
        fileName: 'App.tsx',
        filePath: '/src/App.tsx',
        icon: 'description',
        isActive: true,
        isDirty: false,
      }
      expect(isEditorTab(tab)).toBe(true)
    })

    test('returns false for invalid values', () => {
      expect(
        isEditorTab({
          id: 'tab-1',
          fileName: 'App.tsx',
          filePath: '/src/App.tsx',
        })
      ).toBe(false)
      expect(isEditorTab({ id: 123 })).toBe(false)
      expect(isEditorTab(null)).toBe(false)
      expect(isEditorTab('string')).toBe(false)
    })
  })

  describe('isGitStatus', () => {
    test('returns true for valid GitStatus values', () => {
      expect(isGitStatus('modified')).toBe(true)
      expect(isGitStatus('added')).toBe(true)
      expect(isGitStatus('deleted')).toBe(true)
      expect(isGitStatus('untracked')).toBe(true)
    })

    test('returns false for invalid values', () => {
      expect(isGitStatus('X')).toBe(false)
      expect(isGitStatus(123)).toBe(false)
      expect(isGitStatus(null)).toBe(false)
    })
  })

  describe('isFileNode', () => {
    test('returns true for valid FileNode', () => {
      const node: FileNode = {
        id: 'node-1',
        name: 'App.tsx',
        type: 'file',
      }
      expect(isFileNode(node)).toBe(true)
    })

    test('returns true for FileNode with children', () => {
      const folder: FileNode = {
        id: 'folder-1',
        name: 'src',
        type: 'folder',
        children: [
          {
            id: 'file-1',
            name: 'App.tsx',
            type: 'file',
          },
        ],
      }
      expect(isFileNode(folder)).toBe(true)
    })

    test('returns false for invalid type', () => {
      expect(
        isFileNode({
          id: 'node-1',
          name: 'App.tsx',
          type: 'invalid',
        })
      ).toBe(false)
    })

    test('returns false for invalid children', () => {
      expect(
        isFileNode({
          id: 'folder-1',
          name: 'src',
          type: 'folder',
          children: ['invalid'],
        })
      ).toBe(false)
    })

    test('returns false for missing required fields', () => {
      expect(isFileNode({ id: 'node-1', name: 'App.tsx' })).toBe(false)
      expect(isFileNode(null)).toBe(false)
      expect(isFileNode('string')).toBe(false)
    })
  })

  describe('isContextMenuAction', () => {
    test('returns true for valid ContextMenuAction', () => {
      const action: ContextMenuAction = {
        label: 'Delete',
        icon: 'delete',
      }
      expect(isContextMenuAction(action)).toBe(true)
    })

    test('returns true with optional fields', () => {
      const action: ContextMenuAction = {
        label: 'Delete',
        icon: 'delete',
        variant: 'danger',
        separator: true,
      }
      expect(isContextMenuAction(action)).toBe(true)
    })

    test('returns false for invalid variant', () => {
      expect(
        isContextMenuAction({
          label: 'Delete',
          icon: 'delete',
          variant: 'invalid',
        })
      ).toBe(false)
    })

    test('returns false for missing required fields', () => {
      expect(isContextMenuAction({ label: 'Delete' })).toBe(false)
      expect(isContextMenuAction({ icon: 'delete' })).toBe(false)
      expect(isContextMenuAction(null)).toBe(false)
    })
  })
})
