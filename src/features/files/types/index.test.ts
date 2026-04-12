import { describe, test, expect } from 'vitest'
import type { FileNode } from './index'
import {
  isGitStatus,
  isFileNode,
  isContextMenuAction,
  isContextMenuState,
  getNodePath,
} from './index'

describe('GitStatus type guard', () => {
  test('returns true for valid modified status', () => {
    expect(isGitStatus('modified')).toBe(true)
  })

  test('returns true for valid added status', () => {
    expect(isGitStatus('added')).toBe(true)
  })

  test('returns true for valid deleted status', () => {
    expect(isGitStatus('deleted')).toBe(true)
  })

  test('returns true for valid untracked status', () => {
    expect(isGitStatus('untracked')).toBe(true)
  })

  test('returns false for invalid status', () => {
    expect(isGitStatus('X')).toBe(false)
  })

  test('returns false for non-string', () => {
    expect(isGitStatus(123)).toBe(false)
  })

  test('returns false for null', () => {
    expect(isGitStatus(null)).toBe(false)
  })
})

describe('FileNode type guard', () => {
  test('returns true for valid file node', () => {
    expect(
      isFileNode({
        id: '1',
        name: 'test.ts',
        type: 'file',
      })
    ).toBe(true)
  })

  test('returns true for valid folder node with children', () => {
    expect(
      isFileNode({
        id: '1',
        name: 'src',
        type: 'folder',
        children: [
          {
            id: '2',
            name: 'test.ts',
            type: 'file',
          },
        ],
        defaultExpanded: true,
      })
    ).toBe(true)
  })

  test('returns true for file node with git status', () => {
    expect(
      isFileNode({
        id: '1',
        name: 'test.ts',
        type: 'file',
        gitStatus: 'modified',
      })
    ).toBe(true)
  })

  test('returns true for file node with all optional fields', () => {
    expect(
      isFileNode({
        id: '1',
        name: 'test.ts',
        type: 'file',
        gitStatus: 'added',
        icon: 'code',
        isDragging: true,
        isDragTarget: false,
      })
    ).toBe(true)
  })

  test('returns false for object missing id', () => {
    expect(
      isFileNode({
        name: 'test.ts',
        type: 'file',
      })
    ).toBe(false)
  })

  test('returns false for object missing name', () => {
    expect(
      isFileNode({
        id: '1',
        type: 'file',
      })
    ).toBe(false)
  })

  test('returns false for object missing type', () => {
    expect(
      isFileNode({
        id: '1',
        name: 'test.ts',
      })
    ).toBe(false)
  })

  test('returns false for invalid type value', () => {
    expect(
      isFileNode({
        id: '1',
        name: 'test.ts',
        type: 'invalid',
      })
    ).toBe(false)
  })

  test('returns false for invalid children array', () => {
    expect(
      isFileNode({
        id: '1',
        name: 'src',
        type: 'folder',
        children: [{ invalid: 'node' }],
      })
    ).toBe(false)
  })

  test('returns false for invalid gitStatus', () => {
    expect(
      isFileNode({
        id: '1',
        name: 'test.ts',
        type: 'file',
        gitStatus: 'X',
      })
    ).toBe(false)
  })

  test('returns false for null', () => {
    expect(isFileNode(null)).toBe(false)
  })

  test('returns false for non-object', () => {
    expect(isFileNode('not an object')).toBe(false)
  })
})

describe('ContextMenuAction type guard', () => {
  test('returns true for valid action', () => {
    expect(
      isContextMenuAction({
        label: 'Rename',
        icon: 'edit',
      })
    ).toBe(true)
  })

  test('returns true for action with danger variant', () => {
    expect(
      isContextMenuAction({
        label: 'Delete',
        icon: 'delete',
        variant: 'danger',
      })
    ).toBe(true)
  })

  test('returns true for action with separator', () => {
    expect(
      isContextMenuAction({
        label: 'Copy Path',
        icon: 'content_copy',
        separator: true,
      })
    ).toBe(true)
  })

  test('returns false for object missing label', () => {
    expect(
      isContextMenuAction({
        icon: 'edit',
      })
    ).toBe(false)
  })

  test('returns false for object missing icon', () => {
    expect(
      isContextMenuAction({
        label: 'Rename',
      })
    ).toBe(false)
  })

  test('returns false for invalid variant', () => {
    expect(
      isContextMenuAction({
        label: 'Rename',
        icon: 'edit',
        variant: 'invalid',
      })
    ).toBe(false)
  })

  test('returns false for null', () => {
    expect(isContextMenuAction(null)).toBe(false)
  })

  test('returns false for non-object', () => {
    expect(isContextMenuAction('not an object')).toBe(false)
  })
})

describe('ContextMenuState type guard', () => {
  test('returns true for valid state with null targetNode', () => {
    expect(
      isContextMenuState({
        visible: false,
        x: 0,
        y: 0,
        targetNode: null,
      })
    ).toBe(true)
  })

  test('returns true for valid state with targetNode', () => {
    expect(
      isContextMenuState({
        visible: true,
        x: 100,
        y: 200,
        targetNode: {
          id: '1',
          name: 'test.ts',
          type: 'file',
        },
      })
    ).toBe(true)
  })

  test('returns false for object missing visible', () => {
    expect(
      isContextMenuState({
        x: 0,
        y: 0,
        targetNode: null,
      })
    ).toBe(false)
  })

  test('returns false for object missing x', () => {
    expect(
      isContextMenuState({
        visible: false,
        y: 0,
        targetNode: null,
      })
    ).toBe(false)
  })

  test('returns false for object missing y', () => {
    expect(
      isContextMenuState({
        visible: false,
        x: 0,
        targetNode: null,
      })
    ).toBe(false)
  })

  test('returns false for invalid targetNode', () => {
    expect(
      isContextMenuState({
        visible: true,
        x: 100,
        y: 200,
        targetNode: { invalid: 'node' },
      })
    ).toBe(false)
  })

  test('returns false for null', () => {
    expect(isContextMenuState(null)).toBe(false)
  })

  test('returns false for non-object', () => {
    expect(isContextMenuState('not an object')).toBe(false)
  })
})

describe('getNodePath', () => {
  const tree: FileNode[] = [
    {
      id: 'src',
      name: 'src',
      type: 'folder',
      children: [
        {
          id: 'components',
          name: 'components',
          type: 'folder',
          children: [
            { id: 'file-tree', name: 'FileTree.tsx', type: 'file' },
            { id: 'navbar', name: 'NavBar.tsx', type: 'file' },
          ],
        },
        {
          id: 'utils',
          name: 'utils',
          type: 'folder',
          children: [{ id: 'helper', name: 'api-helper.rs', type: 'file' }],
        },
      ],
    },
    { id: 'readme', name: 'README.md', type: 'file' },
  ]

  test('returns path to a root-level file', () => {
    expect(getNodePath(tree, 'readme')).toEqual(['README.md'])
  })

  test('returns path to a root-level folder', () => {
    expect(getNodePath(tree, 'src')).toEqual(['src'])
  })

  test('returns path to a nested folder', () => {
    expect(getNodePath(tree, 'components')).toEqual(['src', 'components'])
  })

  test('returns path to a deeply nested file', () => {
    expect(getNodePath(tree, 'file-tree')).toEqual([
      'src',
      'components',
      'FileTree.tsx',
    ])
  })

  test('returns path to a file in a different subtree', () => {
    expect(getNodePath(tree, 'helper')).toEqual([
      'src',
      'utils',
      'api-helper.rs',
    ])
  })

  test('returns empty array for non-existent node', () => {
    expect(getNodePath(tree, 'does-not-exist')).toEqual([])
  })

  test('returns empty array for empty tree', () => {
    expect(getNodePath([], 'any-id')).toEqual([])
  })
})
