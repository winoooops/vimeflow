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

/**
 * Controlled/uncontrolled selection pair as a discriminated union. Forces
 * callers to pass BOTH `selectedFile` + `onSelectedFileChange` (controlled
 * mode) or NEITHER (uncontrolled). Without this, a caller that passed only
 * `selectedFile` would flip `isControlled` to true but hit the
 * `if (isControlled && onSelectedFileChange)` guard inside `commitSelection`
 * and get a silently-frozen selection — no auto-select-first, no cwd reset,
 * no stale-selection invalidation. Same pattern as `BottomDrawerProps`.
 */
type DiffPanelSelectionControl =
  | { selectedFile?: undefined; onSelectedFileChange?: undefined }
  | {
      selectedFile: SelectedDiffFile | null
      onSelectedFileChange: (file: SelectedDiffFile | null) => void
    }

interface DiffPanelContentBaseProps {
  /** Working directory for git commands */
  cwd?: string
}

export type DiffPanelContentProps = DiffPanelContentBaseProps &
  DiffPanelSelectionControl

/**
 * DiffPanelContent - Real diff viewer that replaces the placeholder
 *
 * Fetches git status and displays changed files + diff viewer.
 * Supports controlled mode for cross-component selection coordination.
 */
export const DiffPanelContent = ({
  cwd = '.',
  selectedFile: controlledSelectedFile,
  onSelectedFileChange,
}: DiffPanelContentProps): ReactElement => {
  const {
    files,
    filesCwd,
    loading: statusLoading,
    error: statusError,
    idle,
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

  // Gate the transitional-loading arm on the hook actually running. When
  // `idle` (hook short-circuited — `.`/`~` cwd, etc.), `filesCwd` never
  // updates and `!filesAreFresh` would spin "Loading…" forever. An idle
  // hook never loads, so skip the transitional arm entirely.
  const effectiveStatusLoading =
    !idle && (statusLoading || (!filesAreFresh && statusError === null))

  // Render-time cwd guard: reject selections from a different cwd
  const effectiveSelectedFile = rawSelection?.cwd === cwd ? rawSelection : null

  // Shared commitSelection helper that tags with current cwd.
  // The discriminated union on props guarantees onSelectedFileChange is
  // defined whenever isControlled is true, so the inner `&& onSelectedFileChange`
  // guard is no longer needed — TypeScript narrows it across the union.
  const commitSelection = useCallback(
    (newSelection: SelectedDiffFile | null): void => {
      if (isControlled) {
        onSelectedFileChange(newSelection)
      } else {
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

      {/* Right: Diff viewer (fills remaining space).
          Untracked files used to short-circuit here to a placeholder
          because `git diff -- <file>` returned empty. The backend now
          falls back to `git diff --no-index /dev/null <file>` so untracked
          files render as an all-added diff in the normal DiffViewer. */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {diffError ? (
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
