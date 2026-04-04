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
    expect(mockFileTree).toHaveLength(4)
    expect(mockFileTree[0].name).toBe('src')
    expect(mockFileTree[1].name).toBe('package.json')
    expect(mockFileTree[2].name).toBe('tsconfig.json')
    expect(mockFileTree[3].name).toBe('README.md')
  })

  test('src folder is expanded by default', () => {
    const srcNode = mockFileTree[0]
    expect(srcNode.type).toBe('folder')
    expect(srcNode.defaultExpanded).toBe(true)
  })

  test('components folder has isDragTarget flag', () => {
    const srcNode = mockFileTree[0]
    const componentsNode = srcNode.children?.find((n) => n.name === 'components')
    expect(componentsNode?.isDragTarget).toBe(true)
  })

  test('TerminalPanel.tsx has isDragging flag', () => {
    const srcNode = mockFileTree[0]
    const componentsNode = srcNode.children?.find((n) => n.name === 'components')

    const terminalNode = componentsNode?.children?.find(
      (n) => n.name === 'TerminalPanel.tsx'
    )
    expect(terminalNode?.isDragging).toBe(true)
    expect(terminalNode?.gitStatus).toBe('M')
  })

  test('git status badges are present on specific files', () => {
    const srcNode = mockFileTree[0]

    // NavBar.tsx has M status
    const componentsNode = srcNode.children?.find((n) => n.name === 'components')
    const navBarNode = componentsNode?.children?.find((n) => n.name === 'NavBar.tsx')
    expect(navBarNode?.gitStatus).toBe('M')

    // api-helper.rs has A status
    const utilsNode = srcNode.children?.find((n) => n.name === 'utils')
    const apiHelperNode = utilsNode?.children?.find((n) => n.name === 'api-helper.rs')
    expect(apiHelperNode?.gitStatus).toBe('A')

    // tsconfig.json has D status
    const tsconfigNode = mockFileTree[2]
    expect(tsconfigNode.gitStatus).toBe('D')
  })

  test('tests folder is collapsed by default', () => {
    const srcNode = mockFileTree[0]
    const testsNode = srcNode.children?.find((n) => n.name === 'tests')
    expect(testsNode?.defaultExpanded).toBe(false)
  })
})

describe('mockBreadcrumbs', () => {
  test('has expected segments', () => {
    expect(mockBreadcrumbs).toEqual(['vibm-project', 'src', 'components'])
  })
})

describe('contextMenuActions', () => {
  test('contains valid ContextMenuAction objects', () => {
    const validActions = contextMenuActions.filter((action) => !action.separator)
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
