import { useState, useCallback } from 'react'
import type { ReactElement } from 'react'
import IconRail from '../../components/layout/IconRail'
import { Sidebar } from '../../components/layout/Sidebar'
import type { TabName } from '../../components/layout/TopTabBar'
import { TopTabBar } from '../../components/layout/TopTabBar'
import ContextPanel from '../../components/layout/ContextPanel'
import { Breadcrumbs } from './components/Breadcrumbs'
import { FileTree } from './components/FileTree'
import { DropZone } from './components/DropZone'
import { FileStatusBar } from './components/FileStatusBar'
import type { FileNode } from './types'
import { getNodePath } from './types'
import {
  mockFileTree,
  mockBreadcrumbs,
  contextMenuActions,
  mockFileStatusBarData,
} from './data/mockFileTree'
import { mockConversations } from '../chat/data/mockMessages'

const PROJECT_ROOT = 'vibm-project'

interface FilesViewProps {
  onTabChange?: (tab: TabName) => void
}

const FilesView = ({
  onTabChange = undefined,
}: FilesViewProps): ReactElement => {
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>(mockBreadcrumbs)

  const handleNodeSelect = useCallback((node: FileNode): void => {
    const path = getNodePath(mockFileTree, node.id)
    if (path.length > 0) {
      setBreadcrumbs([PROJECT_ROOT, ...path])
    }
  }, [])

  return (
    <div
      className="h-screen overflow-hidden flex bg-background text-on-surface font-body selection:bg-primary-container/30"
      data-testid="files-view"
    >
      {/* Fixed left sidebar components */}
      <IconRail />
      <Sidebar conversations={mockConversations} />

      {/* Main content area with margins to account for fixed sidebars */}
      <main
        className="ml-[308px] mr-[280px] flex-1 flex flex-col"
        data-testid="main-content"
      >
        {/* Top navigation bar with Files tab active */}
        <TopTabBar activeTab="Files" onTabChange={onTabChange} />

        {/* File explorer content area */}
        <div
          className="flex-1 flex flex-col overflow-y-auto p-6"
          data-testid="files-area"
        >
          <Breadcrumbs segments={breadcrumbs} />
          <div className="mt-6">
            <FileTree
              nodes={mockFileTree}
              contextMenuActions={contextMenuActions}
              onNodeSelect={handleNodeSelect}
            />
          </div>
          <DropZone targetPath="src/components/" />
        </div>

        {/* Fixed file status bar at bottom */}
        <FileStatusBar {...mockFileStatusBarData} />
      </main>

      {/* Fixed right panel */}
      <ContextPanel />
    </div>
  )
}

export default FilesView
