import { useState, useCallback } from 'react'
import type { ReactElement } from 'react'
import IconRail from '../../components/layout/IconRail'
import { Sidebar } from '../../components/layout/Sidebar'
import type { TabName } from '../../components/layout/TopTabBar'
import { TopTabBar } from '../../components/layout/TopTabBar'
import ContextPanel from '../../components/layout/ContextPanel'
import { ExplorerPane } from './components/ExplorerPane'
import { EditorTabs } from './components/EditorTabs'
import { CodeEditor } from './components/CodeEditor'
import { EditorStatusBar } from './components/EditorStatusBar'
import { mockConversations } from '../chat/data/mockMessages'
import {
  mockEditorTabs,
  mockEditorStatusBarState,
  mockContextMenuActions,
  mockEditorFiles,
} from './data/mockEditorData'
import type { FileNode } from './types'
import { useFileTree } from './hooks/useFileTree'

interface EditorViewProps {
  onTabChange?: (tab: TabName) => void
  onFileDiffRequest?: (filePath: string) => void
  isContextPanelOpen?: boolean
  onToggleContextPanel?: () => void
}

export const EditorView = ({
  onTabChange = undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onFileDiffRequest: _onFileDiffRequest = undefined,
  isContextPanelOpen = true,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onToggleContextPanel: _onToggleContextPanel = undefined,
}: EditorViewProps): ReactElement => {
  const [isExplorerOpen, setIsExplorerOpen] = useState<boolean>(true)
  const [tabs, setTabs] = useState(mockEditorTabs)

  // Use real file tree from API
  const { tree: fileTree } = useFileTree()

  const handleExplorerToggle = useCallback((): void => {
    setIsExplorerOpen((prev) => !prev)
  }, [])

  const handleTabClick = useCallback((tabId: string): void => {
    setTabs((prevTabs) =>
      prevTabs.map((tab) => ({
        ...tab,
        isActive: tab.id === tabId,
      }))
    )
  }, [])

  const handleTabClose = useCallback((tabId: string): void => {
    setTabs((prevTabs) => {
      const tabIndex = prevTabs.findIndex((tab) => tab.id === tabId)
      const newTabs = prevTabs.filter((tab) => tab.id !== tabId)

      // If closing the active tab, activate an adjacent tab
      if (prevTabs[tabIndex]?.isActive && newTabs.length > 0) {
        const newActiveIndex = Math.min(tabIndex, newTabs.length - 1)
        newTabs[newActiveIndex] = { ...newTabs[newActiveIndex], isActive: true }
      }

      return newTabs
    })
  }, [])

  const handleNodeSelect = useCallback(
    (node: FileNode): void => {
      // If it's a file, open it in a tab
      if (node.type === 'file') {
        const existingTab = tabs.find((tab) => tab.fileName === node.name)

        if (existingTab !== undefined) {
          // Tab already exists, just activate it
          handleTabClick(existingTab.id)
        } else {
          // Create new tab
          const newTab = {
            id: `tab-${Date.now()}`,
            fileName: node.name,
            filePath: `${node.name}`, // Simplified path
            icon: node.icon ?? 'description',
            isActive: false,
            isDirty: false,
          }

          setTabs((prevTabs) => [...prevTabs, newTab])
          handleTabClick(newTab.id)
        }
      }
    },
    [tabs, handleTabClick]
  )

  const activeTab = tabs.find((tab) => tab.isActive)

  const activeFile = mockEditorFiles.find(
    (file) => file.name === activeTab?.fileName
  )

  return (
    <div
      className="h-screen overflow-hidden flex bg-background text-on-surface font-body selection:bg-primary-container/30"
      data-testid="editor-view"
    >
      {/* Fixed left sidebar components */}
      <IconRail />
      <Sidebar conversations={mockConversations} />

      {/* Main content area with dynamic margins */}
      <main
        className={`ml-[308px] ${isContextPanelOpen ? 'mr-[280px]' : 'mr-0'} flex-1 flex flex-col transition-all duration-300`}
        data-testid="main-content"
      >
        {/* Top navigation bar */}
        <TopTabBar activeTab="Editor" onTabChange={onTabChange} />

        {/* Horizontal flex: ExplorerPane + Code Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Explorer Pane */}
          <ExplorerPane
            fileTree={fileTree}
            contextMenuActions={mockContextMenuActions}
            isOpen={isExplorerOpen}
            onToggle={handleExplorerToggle}
            onNodeSelect={handleNodeSelect}
          />

          {/* Right: Code Area */}
          <div className="flex-1 flex flex-col" data-testid="code-area">
            {/* Editor Tabs */}
            <EditorTabs
              tabs={tabs}
              onTabClick={handleTabClick}
              onTabClose={handleTabClose}
            />

            {/* Code Editor */}
            <CodeEditor
              content={activeFile?.content ?? '// No file selected'}
              currentLine={mockEditorStatusBarState.cursor.line}
              fileName={activeTab?.fileName ?? 'untitled.txt'}
            />
          </div>
        </div>
      </main>

      {/* Fixed right panel */}
      <ContextPanel />

      {/* Fixed bottom status bar */}
      <EditorStatusBar
        state={mockEditorStatusBarState}
        isContextPanelOpen={isContextPanelOpen}
      />
    </div>
  )
}
