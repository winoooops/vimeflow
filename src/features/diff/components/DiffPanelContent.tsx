import {
  type ReactElement,
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import { MultiFileDiff, useWorkerPool } from '@pierre/diffs/react'
import type { BaseDiffOptions, DiffsThemeNames } from '@pierre/diffs'
import { useGitStatus, type UseGitStatusReturn } from '../hooks/useGitStatus'
import { useFileDiff } from '../hooks/useFileDiff'
import { ChangedFilesList } from './ChangedFilesList'
import { DiffNarrowPlaceholder } from './DiffNarrowPlaceholder'
import {
  DiffChipToolbar,
  DIFF_MIN_WIDTH_PX,
  SPLIT_MIN_WIDTH_PX,
} from './toolbar'
import { toPierreInputs } from '../services/pierreAdapter'
import type { ChangedFile, SelectedDiffFile } from '../types'

// Pierre option subtypes — derived from `BaseDiffOptions` (rather than typed as
// the raw enum literals) so a Pierre version bump that widens or renames any
// of these surfaces as a type error rather than a silent string-typed
// regression.
type DiffStyle = NonNullable<BaseDiffOptions['diffStyle']>
type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>
type Overflow = NonNullable<BaseDiffOptions['overflow']>
type LineDiffType = NonNullable<BaseDiffOptions['lineDiffType']>

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
  /** Optional shared git status from a parent-level watcher subscription */
  gitStatus?: UseGitStatusReturn
}

export type DiffPanelContentProps = DiffPanelContentBaseProps &
  DiffPanelSelectionControl

// Small inline status cards. They previously lived as an inline JSX ladder in
// the right-pane block; extracting them keeps the populated-state JSX readable
// while still avoiding their own files (each is tiny + private to this view).
const ErrorCard = ({ message }: { message: string }): ReactElement => (
  <div
    className="flex h-full w-full items-center justify-center text-error"
    role="alert"
  >
    <div className="text-center space-y-2">
      <p className="text-sm font-semibold">Failed to load diff</p>
      <p className="text-xs opacity-80">{message}</p>
    </div>
  </div>
)

const LoadingCard = (): ReactElement => (
  <div
    className="flex h-full w-full items-center justify-center text-on-surface-variant"
    role="status"
    aria-live="polite"
  >
    <p className="text-sm">Loading diff…</p>
  </div>
)

/**
 * DiffPanelContent - Real diff viewer that replaces the placeholder
 *
 * Fetches git status and displays changed files + Pierre's <MultiFileDiff>
 * with the chip toolbar above it. Supports controlled mode for cross-
 * component selection coordination.
 */
export const DiffPanelContent = ({
  cwd = '.',
  gitStatus = undefined,
  selectedFile: controlledSelectedFile,
  onSelectedFileChange,
}: DiffPanelContentProps): ReactElement => {
  const internalGitStatus = useGitStatus(cwd, {
    watch: true,
    enabled: gitStatus === undefined,
  })

  const {
    files,
    filesCwd,
    loading: statusLoading,
    error: statusError,
    idle,
  } = gitStatus ?? internalGitStatus

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
  //
  // The discriminated union on props guarantees callers pair
  // `selectedFile` with `onSelectedFileChange`. TypeScript 4.4+ aliased-
  // condition narrowing (which this project relies on elsewhere, e.g.
  // BottomDrawer) tracks the `isControlled` const back through the
  // discriminant, so TypeScript narrows `onSelectedFileChange` to its
  // non-undefined variant inside `if (isControlled)`. Verified: tsc
  // --strict does NOT emit TS2722 here, and ESLint's
  // no-unnecessary-condition rule actively rejects an `&& onSelectedFileChange`
  // guard as provably truthy. Do not add that guard back — the union is
  // our single source of truth for the invariant.
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

  const selectedFileUntracked =
    selectedFileEntry === undefined
      ? undefined
      : selectedFileEntry.status === 'untracked'

  const {
    response,
    loading: diffLoading,
    error: diffError,
  } = useFileDiff(
    selectedFilePath,
    selectedFileStaged,
    cwd,
    selectedFileUntracked
  )

  // Pierre option state — every option here is a controlled-component value
  // surfaced upward from DiffChipToolbar. The toolbar reads / writes these
  // and the same values drive <MultiFileDiff options=...> on the next render,
  // so the chip UI and the rendered diff can never disagree.
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
  const [theme, setTheme] = useState<DiffsThemeNames>('pierre-dark')

  const [diffIndicators, setDiffIndicators] =
    useState<DiffIndicators>('classic')

  const [lineDiffType, setLineDiffType] = useState<LineDiffType>('word')
  const [overflowOpt, setOverflowOpt] = useState<Overflow>('scroll')
  const [disableLineNumbers, setDisableLineNumbers] = useState(false)
  const [disableBackground, setDisableBackground] = useState(false)
  const [disableFileHeader, setDisableFileHeader] = useState(false)
  const [stickyHeader, setStickyHeader] = useState(true)

  // Responsive width tracking. The right pane drives the two width bands:
  //   width < SPLIT_MIN_WIDTH_PX → coerce diffStyle to 'unified' (saved
  //                                preference preserved; coercion is read-only)
  //   width < DIFF_MIN_WIDTH_PX  → render <DiffNarrowPlaceholder> instead
  //                                of MultiFileDiff (toolbar stays mounted)
  // useLayoutEffect (not useEffect) so the observer attaches before paint
  // and the first measurement is reflected in the same commit — avoids a
  // momentary split-rendered-at-narrow flash on initial mount.
  const paneRef = useRef<HTMLDivElement>(null)
  const [paneWidth, setPaneWidth] = useState(SPLIT_MIN_WIDTH_PX)

  useLayoutEffect(() => {
    const node = paneRef.current
    if (!node) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      // ResizeObserver fires with `entries.length >= 1` for an observed
      // node — `entries[0]` is non-optional under our current tsconfig
      // (no `noUncheckedIndexedAccess`).
      setPaneWidth(entries[0].contentRect.width)
    })
    observer.observe(node)

    return (): void => observer.disconnect()
  }, [])

  // Push theme changes into the shared Pierre worker pool. The worker
  // tokenizes off-main-thread and DiffHunksRenderer pulls its theme from
  // `workerManager.getDiffRenderOptions().theme` (see
  // node_modules/@pierre/diffs/dist/renderers/DiffHunksRenderer.js getOptionsWithDefaults),
  // shadowing the per-instance `<MultiFileDiff options.theme>` prop. Without
  // this sync, the chip-toolbar theme dropdown writes to local state but the
  // diff keeps rendering with the pool's initial theme (the bug surfaced
  // during PR1 QA).
  const workerPool = useWorkerPool()
  useEffect(() => {
    if (!workerPool) {
      return
    }
    void workerPool.setRenderOptions({ theme })
  }, [workerPool, theme])

  const splitForced = diffStyle === 'split' && paneWidth < SPLIT_MIN_WIDTH_PX
  const effectiveDiffStyle: DiffStyle = splitForced ? 'unified' : diffStyle
  const tooNarrow = paneWidth > 0 && paneWidth < DIFF_MIN_WIDTH_PX

  // Memoize the Pierre input pair on response identity. Without this,
  // `toPierreInputs(response)` would mint fresh { oldFile, newFile } object
  // references on every parent render, invalidating Pierre's internal
  // `useMemo([oldFile, newFile])` and forcing a re-tokenize on each render —
  // also a suspected contributor to the "theme switches once, then sticks"
  // bug observed during PR1 QA. Declared BEFORE the early returns below so
  // the hook order is stable across renders (rules-of-hooks).
  const pierreInputs = useMemo(
    () => (response ? toPierreInputs(response) : null),
    [response]
  )

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

  // Populated state (horizontal split: file list + toolbar + Pierre diff)
  return (
    <div
      data-testid="diff-populated-state"
      className="flex h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden"
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

      {/* Right: chip toolbar (top) + Pierre MultiFileDiff (bottom). The
          ResizeObserver above watches THIS wrapper so both width bands
          (SPLIT_MIN / DIFF_MIN) come from one source. */}
      <div ref={paneRef} className="flex min-w-0 flex-1 flex-col overflow-auto">
        <DiffChipToolbar
          diffMode={selectedFileStaged ? 'staged' : 'unstaged'}
          diffStyle={effectiveDiffStyle}
          onDiffStyleChange={setDiffStyle}
          theme={theme}
          onThemeChange={setTheme}
          lineDiffType={lineDiffType}
          onLineDiffTypeChange={setLineDiffType}
          diffIndicators={diffIndicators}
          onDiffIndicatorsChange={setDiffIndicators}
          overflow={overflowOpt}
          onOverflowChange={setOverflowOpt}
          disableLineNumbers={disableLineNumbers}
          onDisableLineNumbersChange={setDisableLineNumbers}
          disableBackground={disableBackground}
          onDisableBackgroundChange={setDisableBackground}
          disableFileHeader={disableFileHeader}
          onDisableFileHeaderChange={setDisableFileHeader}
          stickyHeader={stickyHeader}
          onStickyHeaderChange={setStickyHeader}
          totalHunks={response?.fileDiff.hunks.length ?? 0}
          focusedHunkIndex={0}
        />
        {diffError ? (
          <ErrorCard message={diffError.message} />
        ) : diffLoading ? (
          <LoadingCard />
        ) : pierreInputs ? (
          tooNarrow ? (
            <DiffNarrowPlaceholder min={DIFF_MIN_WIDTH_PX} />
          ) : (
            <MultiFileDiff
              // `key={theme}` forces a clean remount on theme change.
              // Pierre's WorkerPoolManager-driven theme path normally
              // rerenders via subscribeToThemeChanges, but PR1 QA observed
              // the second theme switch sticking. Forcing a remount is a
              // belt-and-braces remedy: a brand-new FileDiff instance
              // requests fresh tokenization from the pool, which has the
              // updated theme by then (our useEffect above flushed it).
              // Cost: one extra tokenize per theme change. Acceptable for
              // v1; revisit if perf is an issue with very large diffs.
              key={theme}
              oldFile={pierreInputs.oldFile}
              newFile={pierreInputs.newFile}
              options={{
                diffStyle: effectiveDiffStyle,
                theme,
                diffIndicators,
                lineDiffType,
                overflow: overflowOpt,
                disableLineNumbers,
                disableBackground,
                disableFileHeader,
                stickyHeader,
              }}
              style={{ display: 'block', width: '100%' }}
            />
          )
        ) : null}
      </div>
    </div>
  )
}
