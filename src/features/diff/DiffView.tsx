import {
  type ReactElement,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react'
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
import type { DiffViewMode, DiffFocusTarget, GitStatus } from './types'
import { createGitService } from './services/gitService'

export interface DiffViewProps {
  selectedDiffFile?: string | null
  onClearSelectedFile?: () => void
  onTabChange?: (tab: TabName) => void
  isContextPanelOpen?: boolean
  onToggleContextPanel?: () => void
}

const defaultProps = {
  selectedDiffFile: null,
  onClearSelectedFile: undefined,
  onTabChange: undefined,
  isContextPanelOpen: true,
  onToggleContextPanel: undefined,
}

export const DiffView = ({
  selectedDiffFile = defaultProps.selectedDiffFile,
  onClearSelectedFile = defaultProps.onClearSelectedFile,
  onTabChange = defaultProps.onTabChange,
  isContextPanelOpen = defaultProps.isContextPanelOpen,
  onToggleContextPanel = defaultProps.onToggleContextPanel,
}: DiffViewProps): ReactElement => {
  const gitService = createGitService()

  // Fetch changed files
  const {
    files: changedFiles,
    loading: filesLoading,
    refresh: refreshStatus,
  } = useGitStatus()

  // State management
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [viewMode, setViewMode] = useState<DiffViewMode>('split')
  const [focusTarget, setFocusTarget] = useState<DiffFocusTarget>('diffViewer')
  const [focusedHunkIndex, setFocusedHunkIndex] = useState(0)
  const [focusedLineIndex, setFocusedLineIndex] = useState(0)
  const [diffVersion, setDiffVersion] = useState(0)

  // Sort files consistently: M first, then A, then D, then U
  const statusOrder: Record<GitStatus, number> = { M: 0, A: 1, D: 2, U: 3 }

  const sortedFiles = useMemo(
    () =>
      [...changedFiles].sort(
        (a, b) => statusOrder[a.status] - statusOrder[b.status]
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changedFiles]
  )

  // Clamp selectedFileIndex when file list shrinks (after stage/discard)
  useEffect(() => {
    if (sortedFiles.length === 0) {
      setSelectedFileIndex(0)
    } else if (selectedFileIndex >= sortedFiles.length) {
      setSelectedFileIndex(sortedFiles.length - 1)
    }
  }, [sortedFiles.length, selectedFileIndex])

  // Determine which file to show
  let currentFile: string | null = null

  if (selectedDiffFile) {
    currentFile = selectedDiffFile
  } else if (sortedFiles[selectedFileIndex]?.path) {
    currentFile = sortedFiles[selectedFileIndex].path
  }

  // Fetch diff for current file (diffVersion triggers re-fetch after mutations)
  const { diff, loading: diffLoading } = useFileDiff(
    currentFile,
    false,
    diffVersion
  )

  // Sync selectedFileIndex when sortedFiles loads, then clear the prop
  useEffect(() => {
    if (!selectedDiffFile || sortedFiles.length === 0) {
      return
    }

    const index = sortedFiles.findIndex((f) => f.path === selectedDiffFile)

    if (index !== -1) {
      setSelectedFileIndex(index)
    }

    // Clear prop only after index is synced so selection is preserved
    onClearSelectedFile?.()
  }, [selectedDiffFile, sortedFiles, onClearSelectedFile])

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
    setDiffVersion((v) => v + 1)
    await refreshStatus()
  }, [currentFile, focusedHunkIndex, gitService, refreshStatus])

  const handleDiscardHunk = useCallback(async (): Promise<void> => {
    if (!currentFile) {
      return
    }

    await gitService.discardChanges(currentFile, focusedHunkIndex)
    setDiffVersion((v) => v + 1)
    await refreshStatus()
  }, [currentFile, focusedHunkIndex, gitService, refreshStatus])

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
    filesCount: sortedFiles.length,
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
          files={sortedFiles}
          selectedPath={currentFile}
          onSelectFile={(file) => {
            const index = sortedFiles.findIndex((f) => f.path === file)

            if (index !== -1) {
              handleSelectFile(index)
            }
          }}
        />
      </aside>

      {/* Main content area with margins to account for fixed sidebars */}
      <main
        className={`ml-[308px] ${isContextPanelOpen ? 'mr-[320px]' : 'mr-0'} flex-1 flex flex-col transition-all duration-300`}
      >
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
        isOpen={isContextPanelOpen}
        onToggle={onToggleContextPanel}
      />

      {/* Floating Legend */}
      <DiffLegend />
    </div>
  )
}
