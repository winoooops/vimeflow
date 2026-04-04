import type { ReactElement } from 'react'
import IconRail from '../../components/layout/IconRail'
import { Sidebar } from '../../components/layout/Sidebar'
import { TopTabBar } from '../../components/layout/TopTabBar'
import ContextPanel from '../../components/layout/ContextPanel'
import { Breadcrumbs } from './components/Breadcrumbs'
import { FileTree } from './components/FileTree'
import { DropZone } from './components/DropZone'
import { FileStatusBar } from './components/FileStatusBar'
import {
  mockFileTree,
  mockBreadcrumbs,
  contextMenuActions,
  mockFileStatusBarData,
} from './data/mockFileTree'
import { mockConversations } from '../chat/data/mockMessages'

/**
 * FilesView component - Main page assembly with all layout components and file explorer content.
 * This component integrates the Icon Rail, Sidebar, Top Tab Bar, Context Panel,
 * Breadcrumbs, File Tree, Drop Zone, and File Status Bar into a single cohesive file explorer interface.
 */
export const FilesView = (): ReactElement => (
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
      <TopTabBar activeTab="Files" />

      {/* File explorer content area */}
      <div
        className="flex-1 flex flex-col overflow-y-auto p-6"
        data-testid="files-area"
      >
        <Breadcrumbs segments={mockBreadcrumbs} />
        <div className="mt-6">
          <FileTree
            nodes={mockFileTree}
            contextMenuActions={contextMenuActions}
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
