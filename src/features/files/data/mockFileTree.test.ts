import { describe, test, expect } from 'vitest'
import { isFileNode, isContextMenuAction } from '../types'
import {
  mockFileTree,
  mockBreadcrumbs,
  contextMenuActions,
  mockFileStatusBarData,
} from './mockFileTree'

describe('mockFileTree', () => {
  test('contains valid FileNode objects', () => {
    mockFileTree.forEach((node) => {
      expect(isFileNode(node)).toBe(true)
    })
  })

  test('has expected root nodes', () => {
    expect(mockFileTree).toHaveLength(2)
    expect(mockFileTree[0].name).toBe('src/')
    expect(mockFileTree[1].name).toBe('package.json')
  })

  test('src folder is expanded by default', () => {
    const srcNode = mockFileTree[0]
    expect(srcNode.type).toBe('folder')
    expect(srcNode.defaultExpanded).toBe(true)
  })

  test('middleware folder has correct children', () => {
    const srcNode = mockFileTree[0]

    const middlewareNode = srcNode.children?.find(
      (n) => n.name === 'middleware/'
    )
    expect(middlewareNode).toBeDefined()
    expect(middlewareNode?.defaultExpanded).toBe(true)
    expect(middlewareNode?.children).toHaveLength(2)
    expect(middlewareNode?.children?.[0].name).toBe('auth.ts')
    expect(middlewareNode?.children?.[1].name).toBe('logger.ts')
  })

  test('routes folder is collapsed by default', () => {
    const srcNode = mockFileTree[0]
    const routesNode = srcNode.children?.find((n) => n.name === 'routes/')
    expect(routesNode?.defaultExpanded).toBe(false)
  })
})

describe('mockBreadcrumbs', () => {
  test('has expected segments', () => {
    expect(mockBreadcrumbs).toEqual(['vibm-project', 'src', 'middleware'])
  })
})

describe('contextMenuActions', () => {
  test('contains valid ContextMenuAction objects', () => {
    const validActions = contextMenuActions.filter(
      (action) => !action.separator
    )
    validActions.forEach((action) => {
      expect(isContextMenuAction(action)).toBe(true)
    })
  })

  test('includes expected actions', () => {
    expect(contextMenuActions).toHaveLength(6)
    expect(contextMenuActions[0].label).toBe('Rename')
    expect(contextMenuActions[1].label).toBe('Delete')
    expect(contextMenuActions[1].variant).toBe('danger')
    expect(contextMenuActions[2].separator).toBe(true)
    expect(contextMenuActions[3].label).toBe('Copy Path')
  })
})

describe('mockFileStatusBarData', () => {
  test('has expected properties', () => {
    expect(mockFileStatusBarData.fileCount).toBe(142)
    expect(mockFileStatusBarData.totalSize).toBe('12.4 MB')
    expect(mockFileStatusBarData.encoding).toBe('UTF-8')
    expect(mockFileStatusBarData.gitBranch).toBe('main*')
    expect(mockFileStatusBarData.liveSyncActive).toBe(true)
  })
})
