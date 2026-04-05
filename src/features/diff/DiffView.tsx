import { type ReactElement, useState, useEffect, useCallback } from 'react'
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
}

const defaultProps = {
  selectedDiffFile: null,
  onClearSelectedFile: undefined,
}

export const DiffView = ({
  selectedDiffFile = defaultProps.selectedDiffFile,
  onClearSelectedFile = defaultProps.onClearSelectedFile,
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

  // Clear selectedDiffFile prop after initial render
  useEffect(() => {
    if (selectedDiffFile && onClearSelectedFile) {
      onClearSelectedFile()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update selectedFileIndex when selectedDiffFile prop changes
  useEffect(() => {
    if (selectedDiffFile) {
      const index = changedFiles.findIndex((f) => f.path === selectedDiffFile)

      if (index !== -1) {
        setSelectedFileIndex(index)
      }
    }
  }, [selectedDiffFile, changedFiles])

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

    setFocusedHunkIndex((prev) => Math.min(totalHunks - 1, prev + 1))
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

  // Loading state
  if (filesLoading || diffLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-on-surface-variant">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
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

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: Changed Files List */}
        <div className="w-64 border-r border-outline-variant/10 bg-surface-container-low">
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
        </div>

        {/* Diff viewer */}
        <div className="flex-1 overflow-auto">
          {diff ? (
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

        {/* Context Panel: Commit Info */}
        <div className="w-80 border-l border-outline-variant/10 bg-surface-container-low">
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
        </div>
      </div>

      {/* Floating Legend */}
      <DiffLegend />
    </div>
  )
}
