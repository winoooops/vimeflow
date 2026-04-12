import { type ReactElement, useState, useEffect } from 'react'
import { useGitStatus } from '../hooks/useGitStatus'
import { useFileDiff } from '../hooks/useFileDiff'
import { ChangedFilesList } from './ChangedFilesList'
import { DiffViewer } from './DiffViewer'

export interface DiffPanelContentProps {
  /** Working directory for git commands */
  cwd?: string
}

/**
 * DiffPanelContent - Real diff viewer that replaces the placeholder
 *
 * Fetches git status and displays changed files + diff viewer
 */
export const DiffPanelContent = ({
  cwd = '.',
}: DiffPanelContentProps): ReactElement => {
  const {
    files,
    loading: statusLoading,
    error: statusError,
  } = useGitStatus(cwd)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // Reset selection when cwd changes (avoids stale path from old repo)
  useEffect(() => {
    setSelectedFile(null)
  }, [cwd])

  // Auto-select first file when status loads. Guarded by
  // !statusLoading so this doesn't fire on the stale files array
  // during the loading window after a cwd change. Also re-selects
  // when the current selection disappears from the list (e.g. file
  // was committed or reverted).
  useEffect(() => {
    if (statusLoading) {
      return
    }

    const selectionValid =
      selectedFile !== null && files.some((f) => f.path === selectedFile)

    if (files.length > 0 && !selectionValid) {
      setSelectedFile(files[0].path)
    } else if (files.length === 0) {
      setSelectedFile(null)
    }
  }, [files, selectedFile, statusLoading])

  const selectedFileEntry = files.find((f) => f.path === selectedFile)
  const selectedFileStaged = selectedFileEntry?.staged ?? false
  const selectedFileIsUntracked = selectedFileEntry?.status === 'untracked'

  const {
    diff,
    loading: diffLoading,
    error: diffError,
  } = useFileDiff(selectedFile, selectedFileStaged, cwd)

  // Loading state
  if (statusLoading) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-on-surface-variant"
        role="status"
        aria-live="polite"
      >
        <div className="text-center space-y-2">
          <p className="text-sm">Loading diff…</p>
        </div>
      </div>
    )
  }

  // Error state
  if (statusError) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-error"
        role="alert"
      >
        <div className="text-center space-y-2">
          <p className="text-sm font-semibold">Failed to load git status</p>
          <p className="text-xs opacity-80">{statusError.message}</p>
        </div>
      </div>
    )
  }

  // Empty state (no changes)
  if (files.length === 0) {
    return (
      <div
        data-testid="diff-empty-state"
        className="flex h-full w-full items-center justify-center text-on-surface-variant"
      >
        <div className="text-center space-y-2">
          <p className="text-sm">No changes to review</p>
          <p className="text-xs opacity-60">Modified files will appear here</p>
        </div>
      </div>
    )
  }

  // Populated state (horizontal split: file list + diff viewer)
  return (
    <div
      data-testid="diff-populated-state"
      className="flex h-full min-h-0 overflow-hidden"
    >
      {/* Left: Changed files list (~240px fixed) */}
      <div className="w-60 shrink-0 border-r border-white/5 overflow-y-auto">
        <ChangedFilesList
          files={files}
          selectedPath={selectedFile}
          onSelectFile={setSelectedFile}
        />
      </div>

      {/* Right: Diff viewer (fills remaining space) */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedFileIsUntracked ? (
          <div className="flex h-full items-center justify-center text-on-surface-variant">
            <div className="text-center space-y-2">
              <p className="text-sm">New file — not yet tracked</p>
              <p className="text-xs opacity-60">
                Stage with git add to see diff against index
              </p>
            </div>
          </div>
        ) : diffError ? (
          <div
            className="flex h-full items-center justify-center text-error"
            role="alert"
          >
            <div className="text-center space-y-2">
              <p className="text-sm font-semibold">Failed to load diff</p>
              <p className="text-xs opacity-80">{diffError.message}</p>
            </div>
          </div>
        ) : diffLoading ? (
          <div
            className="flex h-full items-center justify-center text-on-surface-variant"
            role="status"
            aria-live="polite"
          >
            <p className="text-sm">Loading diff…</p>
          </div>
        ) : diff ? (
          <DiffViewer
            fileDiff={diff}
            viewMode="unified"
            focusedHunkIndex={-1}
            focusedLineIndex={-1}
          />
        ) : null}
      </div>
    </div>
  )
}
