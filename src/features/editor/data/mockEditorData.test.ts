import { describe, test, expect } from 'vitest'
import {
  mockFileTree,
  mockEditorTabs,
  mockEditorStatusBarState,
  mockEditorFiles,
  mockEditorState,
} from './mockEditorData'
import {
  isFileNode,
  isEditorTab,
  isVimMode,
  isCursorPosition,
  type EditorFile,
  type EditorState,
  type FileNode,
  type EditorTab,
  type EditorStatusBarState,
} from '../types'

describe('mockEditorData', () => {
  describe('mockFileTree', () => {
    test('is an array of FileNode objects', () => {
      expect(Array.isArray(mockFileTree)).toBe(true)
      expect(mockFileTree.length).toBeGreaterThan(0)
      mockFileTree.forEach((node) => {
        expect(isFileNode(node)).toBe(true)
      })
    })

    test('includes both folders and files', () => {
      const hasFolder = mockFileTree.some((node) => node.type === 'folder')
      const hasFile = mockFileTree.some((node) => node.type === 'file')
      expect(hasFolder).toBe(true)
      expect(hasFile).toBe(true)
    })

    test('folders have children arrays', () => {
      const folders = mockFileTree.filter((node) => node.type === 'folder')
      folders.forEach((folder) => {
        expect(Array.isArray(folder.children)).toBe(true)
      })
    })

    test('includes git status indicators', () => {
      const findNodesWithGitStatus = (nodes: FileNode[]): FileNode[] => {
        const result: FileNode[] = []
        nodes.forEach((node) => {
          if (node.gitStatus) {
            result.push(node)
          }
          if (node.children) {
            result.push(...findNodesWithGitStatus(node.children))
          }
        })

        return result
      }

      const nodesWithGitStatus = findNodesWithGitStatus(mockFileTree)
      expect(nodesWithGitStatus.length).toBeGreaterThan(0)
    })

    test('has valid node IDs', () => {
      const getAllNodes = (nodes: FileNode[]): FileNode[] => {
        const result: FileNode[] = []
        nodes.forEach((node) => {
          result.push(node)
          if (node.children) {
            result.push(...getAllNodes(node.children))
          }
        })

        return result
      }

      const allNodes = getAllNodes(mockFileTree)
      allNodes.forEach((node) => {
        expect(typeof node.id).toBe('string')
        expect(node.id.length).toBeGreaterThan(0)
      })
    })
  })

  describe('mockEditorTabs', () => {
    test('is an array of EditorTab objects', () => {
      expect(Array.isArray(mockEditorTabs)).toBe(true)
      expect(mockEditorTabs.length).toBeGreaterThan(0)
      mockEditorTabs.forEach((tab) => {
        expect(isEditorTab(tab)).toBe(true)
      })
    })

    test('has exactly one active tab', () => {
      const activeTabs = mockEditorTabs.filter((tab) => tab.isActive)
      expect(activeTabs).toHaveLength(1)
    })

    test('includes both clean and dirty tabs', () => {
      const hasDirty = mockEditorTabs.some((tab) => tab.isDirty)
      const hasClean = mockEditorTabs.some((tab) => !tab.isDirty)
      expect(hasDirty).toBe(true)
      expect(hasClean).toBe(true)
    })

    test('has valid file paths', () => {
      mockEditorTabs.forEach((tab) => {
        expect(typeof tab.filePath).toBe('string')
        expect(tab.filePath.length).toBeGreaterThan(0)
        expect(tab.fileName).toBe(tab.filePath.split('/').pop())
      })
    })

    test('has Material Symbols icons', () => {
      mockEditorTabs.forEach((tab) => {
        expect(typeof tab.icon).toBe('string')
        expect(tab.icon.length).toBeGreaterThan(0)
      })
    })
  })

  describe('mockEditorStatusBarState', () => {
    test('has valid vim mode', () => {
      expect(isVimMode(mockEditorStatusBarState.vimMode)).toBe(true)
    })

    test('has git branch', () => {
      expect(typeof mockEditorStatusBarState.gitBranch).toBe('string')
      expect(mockEditorStatusBarState.gitBranch.length).toBeGreaterThan(0)
    })

    test('has sync status with ahead and behind counts', () => {
      expect(typeof mockEditorStatusBarState.syncStatus.ahead).toBe('number')
      expect(typeof mockEditorStatusBarState.syncStatus.behind).toBe('number')
      expect(mockEditorStatusBarState.syncStatus.ahead).toBeGreaterThanOrEqual(
        0
      )

      expect(mockEditorStatusBarState.syncStatus.behind).toBeGreaterThanOrEqual(
        0
      )
    })

    test('has file metadata', () => {
      expect(typeof mockEditorStatusBarState.fileName).toBe('string')
      expect(mockEditorStatusBarState.fileName.length).toBeGreaterThan(0)
      expect(typeof mockEditorStatusBarState.encoding).toBe('string')
      expect(mockEditorStatusBarState.encoding.length).toBeGreaterThan(0)
      expect(typeof mockEditorStatusBarState.language).toBe('string')
      expect(mockEditorStatusBarState.language.length).toBeGreaterThan(0)
    })

    test('has valid cursor position', () => {
      expect(isCursorPosition(mockEditorStatusBarState.cursor)).toBe(true)
      expect(mockEditorStatusBarState.cursor.line).toBeGreaterThan(0)
      expect(mockEditorStatusBarState.cursor.column).toBeGreaterThan(0)
    })
  })

  describe('mockEditorFiles (legacy compatibility)', () => {
    test('is an array of EditorFile objects', () => {
      expect(Array.isArray(mockEditorFiles)).toBe(true)
      expect(mockEditorFiles.length).toBeGreaterThan(0)
    })

    test('each file has required properties', () => {
      mockEditorFiles.forEach((file: EditorFile) => {
        expect(typeof file.id).toBe('string')
        expect(typeof file.path).toBe('string')
        expect(typeof file.name).toBe('string')
        expect(typeof file.language).toBe('string')
        expect(typeof file.modified).toBe('boolean')
        expect(typeof file.encoding).toBe('string')
        expect(typeof file.content).toBe('string')
      })
    })

    test('includes both modified and unmodified files', () => {
      const hasModified = mockEditorFiles.some((file) => file.modified)
      const hasUnmodified = mockEditorFiles.some((file) => !file.modified)
      expect(hasModified).toBe(true)
      expect(hasUnmodified).toBe(true)
    })
  })

  describe('mockEditorState (legacy compatibility)', () => {
    test('has valid structure', () => {
      expect(typeof mockEditorState).toBe('object')
      expect(Array.isArray(mockEditorState.openFiles)).toBe(true)
      expect(typeof mockEditorState.activeFileIndex).toBe('number')
      expect(isVimMode(mockEditorState.vimMode)).toBe(true)
      expect(isCursorPosition(mockEditorState.cursorPosition)).toBe(true)
      expect(typeof mockEditorState.showMinimap).toBe('boolean')
    })

    test('references mockEditorFiles', () => {
      expect(mockEditorState.openFiles).toBe(mockEditorFiles)
    })

    test('activeFileIndex is within bounds', () => {
      expect(mockEditorState.activeFileIndex).toBeGreaterThanOrEqual(0)
      expect(mockEditorState.activeFileIndex).toBeLessThan(
        mockEditorState.openFiles.length
      )
    })
  })

  describe('type compliance', () => {
    test('mockFileTree matches FileNode[] type', () => {
      const tree: FileNode[] = mockFileTree
      expect(tree).toBeDefined()
    })

    test('mockEditorTabs matches EditorTab[] type', () => {
      const tabs: EditorTab[] = mockEditorTabs
      expect(tabs).toBeDefined()
    })

    test('mockEditorStatusBarState matches EditorStatusBarState type', () => {
      const state: EditorStatusBarState = mockEditorStatusBarState
      expect(state).toBeDefined()
    })

    test('mockEditorFiles matches EditorFile[] type', () => {
      const files: EditorFile[] = mockEditorFiles
      expect(files).toBeDefined()
    })

    test('mockEditorState matches EditorState type', () => {
      const state: EditorState = mockEditorState
      expect(state).toBeDefined()
    })
  })
})
