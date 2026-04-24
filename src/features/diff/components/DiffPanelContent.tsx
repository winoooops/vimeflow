import {
  type ReactElement,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react'
import { useGitStatus } from '../hooks/useGitStatus'
import { useFileDiff } from '../hooks/useFileDiff'
import { ChangedFilesList } from './ChangedFilesList'
import { DiffViewer } from './DiffViewer'
import type { ChangedFile, SelectedDiffFile } from '../types'

export interface DiffPanelContentProps {
  /** Working directory for git commands */
  cwd?: string
  /** Controlled selected file (with cwd tag for staleness detection) */
  selectedFile?: SelectedDiffFile | null
  /** Controlled selection change handler */
  onSelectedFileChange?: ((file: SelectedDiffFile | null) => void) | null
}

/**
 * DiffPanelContent - Real diff viewer that replaces the placeholder
 *
 * Fetches git status and displays changed files + diff viewer.
 * Supports controlled mode for cross-component selection coordination.
 */
export const DiffPanelContent = ({
  cwd = '.',
  selectedFile: controlledSelectedFile = undefined,
  onSelectedFileChange = null,
}: DiffPanelContentProps): ReactElement => {
  const {
    files,
    filesCwd,
    loading: statusLoading,
    error: statusError,
  } = useGitStatus(cwd, { watch: true })

  const [uncontrolledSelectedFile, setUncontrolledSelectedFile] =
    useState<SelectedDiffFile | null>(null)

  const isControlled = controlledSelectedFile !== undefined

  const rawSelection = isControlled
    ? controlledSelectedFile
    : uncontrolledSelectedFile

  // Derive freshness: are the files from the current cwd?
  const filesAreFresh = filesCwd === cwd

  const effectiveFiles = useMemo(
    (): ChangedFile[] => (filesAreFresh ? files : []),
    [filesAreFresh, files]
  )

  const effectiveStatusLoading =
    statusLoading || (!filesAreFresh && statusError === null)

  // Render-time cwd guard: reject selections from a different cwd
  const effectiveSelectedFile = rawSelection?.cwd === cwd ? rawSelection : null

  // Shared commitSelection helper that tags with current cwd
  const commitSelection = useCallback(
    (newSelection: SelectedDiffFile | null): void => {
      if (isControlled && onSelectedFileChange) {
        onSelectedFileChange(newSelection)
      } else if (!isControlled) {
        setUncontrolledSelectedFile(newSelection)
      }
    },
    [isControlled, onSelectedFileChange]
  )

  // Reset selection when cwd changes (belt-and-suspenders, render guard is primary)
  useEffect(() => {
    commitSelection(null)
  }, [cwd, commitSelection])

  // Auto-select first file when effectiveFiles changes. Gated on effectiveFiles
  // (not raw files) so filesCwd freshness check is automatic.
  useEffect(() => {
    if (effectiveStatusLoading) {
      return
    }

    const selectionValid =
      effectiveSelectedFile !== null &&
      effectiveFiles.some(
        (f) =>
          f.path === effectiveSelectedFile.path &&
          f.staged === effectiveSelectedFile.staged
      )

    if (effectiveFiles.length > 0 && !selectionValid) {
      commitSelection({
        path: effectiveFiles[0].path,
        staged: effectiveFiles[0].staged,
        cwd,
      })
    } else if (effectiveFiles.length === 0 && effectiveSelectedFile !== null) {
      commitSelection(null)
    }
  }, [
    effectiveFiles,
    effectiveSelectedFile,
    effectiveStatusLoading,
    cwd,
    commitSelection,
  ])

  // Resolve the selected entry from effectiveFiles (not raw files)
  const selectedFileEntry =
    effectiveSelectedFile !== null
      ? effectiveFiles.find(
          (f) =>
            f.path === effectiveSelectedFile.path &&
            f.staged === effectiveSelectedFile.staged
        )
      : undefined
  const selectedFilePath = selectedFileEntry?.path ?? null
  const selectedFileStaged = selectedFileEntry?.staged ?? false
  const selectedFileIsUntracked = selectedFileEntry?.status === 'untracked'

  const {
    diff,
    loading: diffLoading,
    error: diffError,
  } = useFileDiff(selectedFilePath, selectedFileStaged, cwd)

  // Loading state
  if (effectiveStatusLoading) {
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
  if (effectiveFiles.length === 0) {
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
          files={effectiveFiles}
          selectedFile={
            effectiveSelectedFile !== null
              ? {
                  path: effectiveSelectedFile.path,
                  staged: effectiveSelectedFile.staged,
                }
              : null
          }
          onSelectFile={(file: ChangedFile): void => {
            commitSelection({ path: file.path, staged: file.staged, cwd })
          }}
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
