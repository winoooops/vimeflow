import { describe, expect, test } from 'vitest'
import type { Command } from './types'
import {
  buildTree,
  findCommandById,
  findLeaf,
  getAllLeaves,
  mergeTrees,
  traverseNamespace,
} from './commandTree'

describe('commandTree', () => {
  const mockLeafCommand: Command = {
    id: 'test-leaf',
    label: 'Test Leaf',
    icon: 'check',
    execute: (): void => {
      // Mock execute
    },
  }

  const mockNamespaceCommand: Command = {
    id: 'test-namespace',
    label: 'Test Namespace',
    icon: 'folder',
    children: [
      {
        id: 'child-1',
        label: 'Child 1',
        icon: 'file',
        execute: (): void => {
          // Mock execute
        },
      },
      {
        id: 'child-2',
        label: 'Child 2',
        icon: 'file',
        execute: (): void => {
          // Mock execute
        },
      },
    ],
  }

  const mockNestedCommand: Command = {
    id: 'parent',
    label: 'Parent',
    icon: 'folder',
    children: [
      {
        id: 'child',
        label: 'Child',
        icon: 'folder',
        children: [
          {
            id: 'grandchild',
            label: 'Grandchild',
            icon: 'file',
            execute: (): void => {
              // Mock execute
            },
          },
        ],
      },
    ],
  }

  describe('buildTree', () => {
    test('returns the same array (no-op)', () => {
      const commands = [mockLeafCommand, mockNamespaceCommand]
      const result = buildTree(commands)
      expect(result).toBe(commands)
      expect(result).toEqual(commands)
    })
  })

  describe('mergeTrees', () => {
    test('combines multiple command trees', () => {
      const tree1 = [mockLeafCommand]
      const tree2 = [mockNamespaceCommand]
      const result = mergeTrees(tree1, tree2)

      expect(result).toHaveLength(2)
      expect(result).toContain(mockLeafCommand)
      expect(result).toContain(mockNamespaceCommand)
    })

    test('handles empty trees', () => {
      const result = mergeTrees([], [])
      expect(result).toEqual([])
    })

    test('flattens multiple tree levels', () => {
      const tree1 = [mockLeafCommand]
      const tree2 = [mockNamespaceCommand]
      const tree3 = [mockNestedCommand]
      const result = mergeTrees(tree1, tree2, tree3)

      expect(result).toHaveLength(3)
    })
  })

  describe('traverseNamespace', () => {
    test('returns children for namespace command', () => {
      const result = traverseNamespace(mockNamespaceCommand)
      expect(result).toEqual(mockNamespaceCommand.children)
      expect(result).toHaveLength(2)
    })

    test('returns null for leaf command (no children)', () => {
      const result = traverseNamespace(mockLeafCommand)
      expect(result).toBeNull()
    })

    test('returns null for null command', () => {
      const result = traverseNamespace(null)
      expect(result).toBeNull()
    })
  })

  describe('findCommandById', () => {
    test('finds root-level command', () => {
      const commands = [mockLeafCommand, mockNamespaceCommand]
      const result = findCommandById(commands, 'test-leaf')

      expect(result).toBe(mockLeafCommand)
    })

    test('finds nested command', () => {
      const commands = [mockNamespaceCommand]
      const result = findCommandById(commands, 'child-1')

      expect(result).toEqual(mockNamespaceCommand.children![0])
    })

    test('finds deeply nested command', () => {
      const commands = [mockNestedCommand]
      const result = findCommandById(commands, 'grandchild')

      expect(result?.id).toBe('grandchild')
      expect(result?.label).toBe('Grandchild')
    })

    test('returns null for non-existent command', () => {
      const commands = [mockLeafCommand]
      const result = findCommandById(commands, 'non-existent')

      expect(result).toBeNull()
    })
  })

  describe('findLeaf', () => {
    test('returns leaf command if found', () => {
      const commands = [mockLeafCommand, mockNamespaceCommand]
      const result = findLeaf(commands, 'test-leaf')

      expect(result).toBe(mockLeafCommand)
    })

    test('returns null for namespace command', () => {
      const commands = [mockNamespaceCommand]
      const result = findLeaf(commands, 'test-namespace')

      expect(result).toBeNull()
    })

    test('finds leaf command nested in namespace', () => {
      const commands = [mockNamespaceCommand]
      const result = findLeaf(commands, 'child-1')

      expect(result?.id).toBe('child-1')
      expect(result?.execute).toBeDefined()
    })

    test('returns null for non-existent command', () => {
      const commands = [mockLeafCommand]
      const result = findLeaf(commands, 'non-existent')

      expect(result).toBeNull()
    })
  })

  describe('getAllLeaves', () => {
    test('returns all leaf commands from flat tree', () => {
      const commands = [mockLeafCommand, mockLeafCommand]
      const result = getAllLeaves(commands)

      expect(result).toHaveLength(2)
    })

    test('extracts leaves from namespace', () => {
      const commands = [mockNamespaceCommand]
      const result = getAllLeaves(commands)

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('child-1')
      expect(result[1].id).toBe('child-2')
    })

    test('extracts leaves from deeply nested structure', () => {
      const commands = [mockNestedCommand]
      const result = getAllLeaves(commands)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('grandchild')
    })

    test('returns empty array for namespace-only tree', () => {
      const namespaceOnly: Command = {
        id: 'namespace',
        label: 'Namespace',
        icon: 'folder',
        children: [
          {
            id: 'child-namespace',
            label: 'Child Namespace',
            icon: 'folder',
            children: [],
          },
        ],
      }

      const result = getAllLeaves([namespaceOnly])
      expect(result).toEqual([])
    })
  })
})
