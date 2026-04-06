import { useState, useCallback, useEffect, useRef } from 'react'
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
import { EmptyState } from './components/EmptyState'
import { LoadingState } from './components/LoadingState'
import { ErrorState } from './components/ErrorState'
import { mockConversations } from '../chat/data/mockMessages'
import {
  mockEditorTabs,
  mockEditorStatusBarState,
  mockContextMenuActions,
} from './data/mockEditorData'
import type { FileNode } from './types'
import { useFileTree } from './hooks/useFileTree'
import { useFileContent } from './hooks/useFileContent'

interface EditorViewProps {
  onTabChange?: (tab: TabName) => void
  isContextPanelOpen?: boolean
  onToggleContextPanel?: () => void
}

export const EditorView = ({
  onTabChange = undefined,
  isContextPanelOpen = true,
  onToggleContextPanel = undefined,
}: EditorViewProps): ReactElement => {
  const [isExplorerOpen, setIsExplorerOpen] = useState<boolean>(true)
  const [tabs, setTabs] = useState(mockEditorTabs)

  // Ref to always access latest tabs value (prevents stale closure)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  // Use real file tree and file content from API
  const { tree: fileTree } = useFileTree()
  const { content, loading, error, loadFile } = useFileContent()

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
        const existingTab = tabsRef.current.find(
          (tab) => tab.filePath === node.id
        )

        if (existingTab !== undefined) {
          // Tab already exists, just activate it
          handleTabClick(existingTab.id)
        } else {
          // Create new tab with isActive: true and deactivate others in one atomic update
          const newTab = {
            id: `tab-${crypto.randomUUID()}`,
            fileName: node.name,
            filePath: node.id,
            icon: node.icon ?? 'description',
            isActive: true,
            isDirty: false,
          }

          setTabs((prevTabs) => [
            ...prevTabs.map((t) => ({ ...t, isActive: false })),
            newTab,
          ])
        }
      }
    },
    [handleTabClick]
  )

  const activeTab = tabs.find((tab) => tab.isActive)

  // Load file content when active tab changes
  useEffect(() => {
    if (activeTab?.filePath) {
      void loadFile(activeTab.filePath)
    }
  }, [activeTab?.filePath, loadFile])

  // Determine what to render based on state
  const renderCodeArea = (): ReactElement => {
    // Empty state: no tabs open
    if (!activeTab && tabs.length === 0) {
      return <EmptyState />
    }

    // No active tab but tabs exist
    if (!activeTab) {
      return <EmptyState />
    }

    // Loading state: file is being fetched (only show if no fallback content)
    if (loading && !activeTab.content) {
      return <LoadingState />
    }

    // Error state: file loading failed (only show if no fallback content)
    if (error && !activeTab.content) {
      return <ErrorState message={error} />
    }

    // Normal state: show code editor with content
    // Priority: API content > tab.content > empty message
    const displayContent = content ?? activeTab.content ?? '// No file selected'

    return (
      <CodeEditor
        content={displayContent}
        currentLine={mockEditorStatusBarState.cursor.line}
        fileName={activeTab.fileName}
      />
    )
  }

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
        data-testid="editor-main-content"
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
            selectedFileId={activeTab?.filePath}
          />

          {/* Right: Code Area */}
          <div className="flex-1 flex flex-col" data-testid="code-area">
            {/* Editor Tabs */}
            <EditorTabs
              tabs={tabs}
              onTabClick={handleTabClick}
              onTabClose={handleTabClose}
            />

            {/* Code Editor or State Components */}
            {renderCodeArea()}
          </div>
        </div>
      </main>

      {/* Fixed right panel */}
      <ContextPanel
        isOpen={isContextPanelOpen}
        onToggle={onToggleContextPanel}
      />

      {/* Fixed bottom status bar */}
      <EditorStatusBar
        state={mockEditorStatusBarState}
        isContextPanelOpen={isContextPanelOpen}
      />
    </div>
  )
}
