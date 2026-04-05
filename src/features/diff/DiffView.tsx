import { type ReactElement, useState, useEffect, useCallback } from 'react'
import IconRail from '../../components/layout/IconRail'
import type { TabName } from '../../components/layout/TopTabBar'
import { TopTabBar } from '../../components/layout/TopTabBar'
import { ChangedFilesList } from './components/ChangedFilesList'
import DiffToolbar from './components/DiffToolbar'
import { DiffViewer } from './components/DiffViewer'
import DiffLegend from './components/DiffLegend'
import CommitInfoPanel from './components/CommitInfoPanel'
import { useGitStatus } from './hooks/useGitStatus'
import { useFileDiff } from './hooks/useFileDiff'
import { useDiffKeyboard } from './hooks/useDiffKeyboard'
import type { DiffViewMode, DiffFocusTarget } from './types'
import { createGitService } from './services/gitService'

export interface DiffViewProps {
  selectedDiffFile?: string | null
  onClearSelectedFile?: () => void
  onTabChange?: (tab: TabName) => void
}

const defaultProps = {
  selectedDiffFile: null,
  onClearSelectedFile: undefined,
  onTabChange: undefined,
}

export const DiffView = ({
  selectedDiffFile = defaultProps.selectedDiffFile,
  onClearSelectedFile = defaultProps.onClearSelectedFile,
  onTabChange = defaultProps.onTabChange,
}: DiffViewProps): ReactElement => {
  const gitService = createGitService()

  // Fetch changed files
  const { files: changedFiles, loading: filesLoading } = useGitStatus()

  // State management
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [viewMode, setViewMode] = useState<DiffViewMode>('split')
  const [focusTarget, setFocusTarget] = useState<DiffFocusTarget>('diffViewer')
  const [focusedHunkIndex, setFocusedHunkIndex] = useState(0)
  const [focusedLineIndex, setFocusedLineIndex] = useState(0)

  // Determine which file to show
  let currentFile: string | null = null

  if (selectedDiffFile) {
    currentFile = selectedDiffFile
  } else if (changedFiles[selectedFileIndex]?.path) {
    currentFile = changedFiles[selectedFileIndex].path
  }

  // Fetch diff for current file
  const { diff, loading: diffLoading } = useFileDiff(currentFile, false)

  // Sync selectedFileIndex when changedFiles loads, then clear the prop
  useEffect(() => {
    if (!selectedDiffFile || changedFiles.length === 0) {
      return
    }

    const index = changedFiles.findIndex((f) => f.path === selectedDiffFile)

    if (index !== -1) {
      setSelectedFileIndex(index)
    }

    // Clear prop only after index is synced so selection is preserved
    onClearSelectedFile?.()
  }, [selectedDiffFile, changedFiles, onClearSelectedFile])

  // Handlers
  const handleSelectFile = useCallback((index: number): void => {
    setSelectedFileIndex(index)
    setFocusedHunkIndex(0)
    setFocusedLineIndex(0)
  }, [])

  const handleOpenFile = useCallback((index: number): void => {
    setSelectedFileIndex(index)
    setFocusTarget('diffViewer')
  }, [])

  const handleStageHunk = useCallback(async (): Promise<void> => {
    if (!currentFile) {
      return
    }

    await gitService.stageFile(currentFile, focusedHunkIndex)
  }, [currentFile, focusedHunkIndex, gitService])

  const handleDiscardHunk = useCallback(async (): Promise<void> => {
    if (!currentFile) {
      return
    }

    await gitService.discardChanges(currentFile, focusedHunkIndex)
  }, [currentFile, focusedHunkIndex, gitService])

  const handleToggleStagedFilter = useCallback((): void => {
    // TODO: Implement staged/unstaged filter toggle
  }, [])

  const handlePrevHunk = useCallback((): void => {
    setFocusedHunkIndex((prev) => Math.max(0, prev - 1))
  }, [])

  const handleNextHunk = useCallback((): void => {
    const totalHunks = diff?.hunks.length ?? 0

    if (totalHunks > 0) {
      setFocusedHunkIndex((prev) => Math.min(totalHunks - 1, prev + 1))
    }
  }, [diff])

  const handleViewModeChange = useCallback((mode: DiffViewMode): void => {
    setViewMode(mode)
  }, [])

  // Keyboard navigation
  const currentHunk = diff?.hunks[focusedHunkIndex]
  const totalLinesInHunk = currentHunk?.lines.length ?? 0

  useDiffKeyboard({
    focusTarget,
    filesCount: changedFiles.length,
    selectedFileIndex,
    focusedHunkIndex,
    focusedLineIndex,
    totalHunks: diff?.hunks.length ?? 0,
    totalLinesInHunk,
    onSelectFile: handleSelectFile,
    onOpenFile: handleOpenFile,
    onFocusHunk: setFocusedHunkIndex,
    onFocusLine: setFocusedLineIndex,
    onStage: () => void handleStageHunk(),
    onDiscard: () => void handleDiscardHunk(),
    onToggleStagedFilter: handleToggleStagedFilter,
    onSetFocusTarget: setFocusTarget,
  })

  return (
    <div
      className="h-screen overflow-hidden flex bg-background text-on-surface font-body selection:bg-primary-container/30"
      data-testid="diff-view"
    >
      {/* Fixed left sidebar components */}
      <IconRail />

      {/* Custom sidebar for changed files list - replaces standard Sidebar */}
      <aside className="w-[260px] h-screen fixed left-[48px] top-0 bg-[#1a1a2a] border-r border-[#4a444f]/15 flex flex-col z-40">
        <ChangedFilesList
          files={changedFiles}
          selectedPath={currentFile}
          onSelectFile={(file) => {
            const index = changedFiles.findIndex((f) => f.path === file)

            if (index !== -1) {
              handleSelectFile(index)
            }
          }}
        />
      </aside>

      {/* Main content area with margins to account for fixed sidebars */}
      <main className="ml-[308px] mr-[320px] flex-1 flex flex-col">
        {/* Top navigation bar */}
        <TopTabBar activeTab="Diff" onTabChange={onTabChange} />

        {/* Diff content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <DiffToolbar
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            currentHunkIndex={focusedHunkIndex}
            totalHunks={diff?.hunks.length ?? 0}
            onPreviousHunk={handlePrevHunk}
            onNextHunk={handleNextHunk}
            onStageHunk={() => void handleStageHunk()}
            onDiscard={() => void handleDiscardHunk()}
          />

          {/* Diff viewer */}
          <div className="thin-scrollbar flex-1 overflow-auto">
            {filesLoading || diffLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-on-surface-variant">Loading...</div>
              </div>
            ) : diff ? (
              <DiffViewer
                fileDiff={diff}
                viewMode={viewMode}
                focusedHunkIndex={focusedHunkIndex}
                focusedLineIndex={focusedLineIndex}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-on-surface-variant">No diff available</div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Fixed right panel with commit info - replaces standard ContextPanel */}
      <aside className="thin-scrollbar w-[320px] h-screen fixed right-0 top-0 bg-[#1a1a2a] border-l border-[#4a444f]/15 z-40 overflow-y-auto">
        <CommitInfoPanel
          commitHash="abc123d"
          commitMessage="feat: add dark mode toggle to settings"
          authorName="Claude"
          timestamp={new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()}
          contextMemoryPercent={65}
          tokensProcessedPercent={42}
          onSubmitReview={() => {
            // TODO: Implement review submission
          }}
        />
      </aside>

      {/* Floating Legend */}
      <DiffLegend />
    </div>
  )
}
