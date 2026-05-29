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
import type {
  AnnotationSide,
  BaseDiffOptions,
  DiffLineAnnotation,
  DiffsThemeNames,
  SelectedLineRange,
} from '@pierre/diffs'
import { useGitStatus, type UseGitStatusReturn } from '../hooks/useGitStatus'
import { useFileDiff } from '../hooks/useFileDiff'
import { ChangedFilesList } from './ChangedFilesList'
import { DiffNarrowPlaceholder } from './DiffNarrowPlaceholder'
import {
  DiffChipToolbar,
  DIFF_MIN_WIDTH_PX,
  SPLIT_MIN_WIDTH_PX,
} from './toolbar'
import { toPierreInputs, findRawDiffHunkIndex } from '../services/pierreAdapter'
import { extractHunkPatch } from '../services/gitPatch'
import { createGitService } from '../services/gitService'
import { enqueuePoolWrite } from '../services/workerPoolWrites'
import { useNotifyInfo } from '../../workspace/hooks/useNotifyInfo'
import type { ChangedFile, SelectedDiffFile } from '../types'
import { useFeedbackBatch, type ReviewComment } from '../hooks/useFeedbackBatch'
import { ReviewCommentComposer } from './ReviewCommentComposer'
import { ReviewCommentRow } from './ReviewCommentRow'
import { FinishFeedbackPopover } from './FinishFeedbackPopover'
import {
  dispatchFeedbackBatch,
  type DispatchEntry,
} from '../services/feedbackDispatch'
import {
  resolveCandidatePanes,
  type PaneCandidate,
} from '../services/activePanePicker'

// Pierre option subtypes — derived from `BaseDiffOptions` (rather than typed as
// the raw enum literals) so a Pierre version bump that widens or renames any
// of these surfaces as a type error rather than a silent string-typed
// regression.
type DiffStyle = NonNullable<BaseDiffOptions['diffStyle']>
type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>
type Overflow = NonNullable<BaseDiffOptions['overflow']>
type LineDiffType = NonNullable<BaseDiffOptions['lineDiffType']>

// The subset of Pierre options the worker pool OWNS once a pool is active:
// the Shiki `theme` and the intra-line word-diff algorithm (`lineDiffType`).
// `DiffHunksRenderer.getRenderOptions()` returns
// `workerManager.getDiffRenderOptions()` wholesale under a pool (see
// node_modules/@pierre/diffs/dist/renderers/DiffHunksRenderer.js), so the
// per-instance `<MultiFileDiff options>` props for these two are ignored —
// they must be pushed into the pool via `setRenderOptions` instead.
interface PoolRenderOptions {
  theme: DiffsThemeNames
  lineDiffType: LineDiffType
}

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
  /** Optional feedback dispatch target for inline review comments */
  feedbackDispatch?: {
    candidates: PaneCandidate[]
    writePty: (ptyId: string, data: string) => Promise<void>
  }
}

export type DiffPanelContentProps = DiffPanelContentBaseProps &
  DiffPanelSelectionControl

// Sentinel id marking the transient "draft" annotation that renders the
// composer inline before a real comment exists.
const DRAFT_ID = '__draft__'

// Monotonic id source. A module counter keeps comment ids stable + unique
// without reaching for Date.now()/Math.random() in render.
let feedbackCommentSeq = 0

const nextFeedbackCommentId = (): string =>
  `feedback-comment-${(feedbackCommentSeq += 1)}`

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
  feedbackDispatch = undefined,
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
    refetch: refetchDiff,
  } = useFileDiff(
    selectedFilePath,
    selectedFileStaged,
    cwd,
    selectedFileUntracked
  )

  // Notification hook — reused for the "Pierre split differently" and
  // "could not isolate hunk" informational messages.
  const { message: notifyMessage, notifyInfo } = useNotifyInfo()

  // Inline review comment batch state.
  const feedback = useFeedbackBatch()

  // Clear the feedback batch when cwd changes so stale comments from a
  // previous workspace do not leak into the new one.
  const previousCwdRef = useRef(cwd)

  useEffect(() => {
    if (previousCwdRef.current !== cwd) {
      previousCwdRef.current = cwd
      feedback.clearBatch()
    }
  }, [cwd, feedback, feedback.clearBatch])

  // Composer target state: which line currently has an open composer.
  // `editId` set => editing an existing comment in place; absent => a new
  // draft on that line.
  const [composerTarget, setComposerTarget] = useState<{
    lineNumber: number
    side: AnnotationSide
    filePath: string
    staged: boolean
    editId?: string
  } | null>(null)

  // Finish feedback popover open state.
  const [finishOpen, setFinishOpen] = useState(false)

  // Real annotations for the currently selected file.
  const realAnnotations = feedback.annotationsForFile(
    cwd,
    selectedFilePath ?? '',
    selectedFileStaged
  )

  // Merge a transient draft annotation in only while composing a NEW comment,
  // so the composer renders inline below the target line. Editing reuses the
  // existing annotation's slot, so no draft is added there. When idle we pass
  // `realAnnotations` straight through to keep its identity stable (avoids
  // Pierre re-tokenizing on every render).
  const lineAnnotations = useMemo((): DiffLineAnnotation<ReviewComment>[] => {
    if (composerTarget !== null && composerTarget.editId === undefined) {
      const draft: DiffLineAnnotation<ReviewComment> = {
        side: composerTarget.side,
        lineNumber: composerTarget.lineNumber,
        metadata: { id: DRAFT_ID, text: '', author: 'self', createdAt: 0 },
      }

      return [...realAnnotations, draft]
    }

    return realAnnotations
  }, [realAnnotations, composerTarget])

  const confirmComposer = useCallback(
    (text: string): void => {
      if (composerTarget === null) {
        return
      }

      if (selectedFilePath === null) {
        return
      }

      if (
        composerTarget.filePath !== selectedFilePath ||
        composerTarget.staged !== selectedFileStaged
      ) {
        setComposerTarget(null)

        return
      }

      if (composerTarget.editId !== undefined) {
        feedback.updateAnnotation(
          cwd,
          selectedFilePath,
          selectedFileStaged,
          composerTarget.editId,
          { text }
        )
        setComposerTarget(null)
      } else {
        const result = feedback.addAnnotation(
          cwd,
          selectedFilePath,
          selectedFileStaged,
          {
            side: composerTarget.side,
            lineNumber: composerTarget.lineNumber,
            metadata: {
              id: nextFeedbackCommentId(),
              text,
              author: 'self',
              createdAt: Date.now(),
            },
          }
        )
        if (result === 'cap-reached') {
          notifyInfo(
            'Feedback limit reached (50 comments). Finish or discard before adding more.'
          )
        } else {
          setComposerTarget(null)
        }
      }
    },
    [
      composerTarget,
      selectedFilePath,
      selectedFileStaged,
      feedback,
      cwd,
      notifyInfo,
    ]
  )

  const closeComposer = useCallback((): void => {
    setComposerTarget(null)
  }, [])

  const sendingFeedbackRef = useRef(false)

  const handleSendFeedback = useCallback(
    (pane: PaneCandidate): void => {
      if (sendingFeedbackRef.current) {
        return
      }
      sendingFeedbackRef.current = true
      void (async (): Promise<void> => {
        const entries: DispatchEntry[] = []
        for (const [key, annotations] of feedback.batch) {
          const firstSep = key.indexOf('::')
          const remainder = key.slice(firstSep + 2)
          const lastSep = remainder.lastIndexOf('::')
          const filePath = remainder.slice(0, lastSep)
          entries.push({ filePath, annotations })
        }

        try {
          if (feedbackDispatch) {
            await dispatchFeedbackBatch(
              pane.paneId,
              pane.ptyId,
              entries,
              feedbackDispatch.writePty
            )
          }
          feedback.clearBatch()
          setFinishOpen(false)
        } catch {
          notifyInfo('Terminal session ended; feedback not sent.')
        } finally {
          sendingFeedbackRef.current = false
        }
      })()
    },
    [feedback, feedbackDispatch, notifyInfo]
  )

  // Single-flight staging flag — drops clicks while an IPC is in flight.
  const [staging, setStaging] = useState(false)

  // PR3: focusedHunkIndex is the 0-based index into response.fileDiff.hunks.
  // Replaced the PR2 hardcoded `[0]` so prev/next navigation can step through
  // hunks. Null when there are no hunks (whole-file operations only).
  const [focusedHunkIndex, setFocusedHunkIndex] = useState(0)

  // Reset focusedHunkIndex to 0 when the selected file changes. Without this,
  // a stale index (e.g. 2) would point out of range when switching to a file
  // with fewer hunks — focusedHunk would be undefined and staging would no-op.
  // Key off the (path, staged) pair that uniquely identifies the file, matching
  // how useFileDiff and selectedFileEntry are driven.
  useEffect(() => {
    setFocusedHunkIndex(0)
  }, [selectedFilePath, selectedFileStaged])

  // Clear composer when the selected file changes so a draft opened on one
  // file is not accidentally submitted against another.
  useEffect(() => {
    setComposerTarget(null)
  }, [selectedFilePath, selectedFileStaged])

  const hunkCount = response?.fileDiff.hunks.length ?? 0

  // Clamp focusedHunkIndex when the hunk array shrinks WITHOUT a file change.
  // Staging/discarding a hunk reloads the SAME file with fewer hunks, so the
  // file-change reset above does not fire (path + staged are unchanged). A
  // stale index would then point out of range: focusedHunk goes null, the
  // counter renders an invalid value (e.g. "3/2"), and stage/unstage/discard
  // silently no-op until the user manually navigates. Clamp to the last valid
  // index — preserves position for middle-hunk staging, only adjusting at the
  // boundary. (PR3 review: Claude HIGH + codex P2.)
  useEffect(() => {
    if (hunkCount > 0) {
      setFocusedHunkIndex((prev) => Math.min(prev, hunkCount - 1))
    }
  }, [hunkCount])

  // Read the index through a clamp so the single render between a hunk-count
  // shrink and the effect above can't surface a stale/out-of-range value — the
  // counter, focused hunk, and selection all stay valid even on that frame.
  const clampedHunkIndex =
    hunkCount > 0 ? Math.min(focusedHunkIndex, hunkCount - 1) : 0

  const focusedHunk = response?.fileDiff.hunks[clampedHunkIndex] ?? null

  const onPrevHunk = useCallback((): void => {
    if (!response) {
      return
    }

    const len = response.fileDiff.hunks.length
    if (len === 0) {
      return
    }

    setFocusedHunkIndex((prev) => (prev + len - 1) % len)
  }, [response])

  const onNextHunk = useCallback((): void => {
    if (!response) {
      return
    }

    const len = response.fileDiff.hunks.length
    if (len === 0) {
      return
    }

    setFocusedHunkIndex((prev) => (prev + 1) % len)
  }, [response])

  // Derive the Pierre selectedLines from the focused hunk. Deletion-only hunks
  // (newLines === 0) use the old-side coordinates so the highlight lands on the
  // deletions column; all other hunks use the new-side (additions).
  const selectedLines: SelectedLineRange | null =
    useMemo((): SelectedLineRange | null => {
      const hunk = response?.fileDiff.hunks[clampedHunkIndex]
      if (!hunk) {
        return null
      }

      const isDeletionOnly = hunk.newLines === 0
      const lineStart = isDeletionOnly ? hunk.oldStart : hunk.newStart
      const lineCount = isDeletionOnly ? hunk.oldLines : hunk.newLines

      const side = isDeletionOnly
        ? ('deletions' as const)
        : ('additions' as const)

      return {
        start: lineStart,
        end: lineStart + Math.max(lineCount - 1, 0),
        side,
      }
    }, [response, clampedHunkIndex])

  // Shared helper for all three hunk-based staging operations. Extracts the
  // focused hunk patch, calls the provided service operation, then refreshes
  // the diff and git status. Surfaces any IPC failure via notifyInfo so the
  // chip caller (void onStage()) sees user feedback instead of an unhandled
  // rejection. The single-flight `staging` flag is set/cleared in try/finally
  // so it clears even when the service call rejects.
  const runHunkStaging = useCallback(
    async (
      verb: 'stage' | 'unstage' | 'discard',
      op: (file: string, patch: string) => Promise<void>
    ): Promise<void> => {
      if (
        staging ||
        !selectedFilePath ||
        response === null ||
        focusedHunk === null
      ) {
        return
      }

      const rawIndex = findRawDiffHunkIndex(response, focusedHunk)
      if (rawIndex === -1) {
        notifyInfo(
          `Pierre split this hunk differently than git — cannot ${verb} this region; use Discard All or the file-level chip`
        )

        return
      }

      const hunkPatch = extractHunkPatch(response.rawDiff, rawIndex)
      if (hunkPatch === null) {
        notifyInfo('Could not isolate this hunk — try refreshing the diff')

        return
      }

      setStaging(true)

      try {
        await op(selectedFilePath, hunkPatch)
        refetchDiff()
        ;(gitStatus ?? internalGitStatus).refresh()
      } catch (err) {
        notifyInfo(
          `Failed to ${verb} hunk: ${err instanceof Error ? err.message : String(err)}`
        )
      } finally {
        setStaging(false)
      }
    },
    [
      staging,
      selectedFilePath,
      response,
      focusedHunk,
      notifyInfo,
      refetchDiff,
      gitStatus,
      internalGitStatus,
    ]
  )

  // Stage the currently focused hunk.
  const handleStage = useCallback(
    (): Promise<void> =>
      runHunkStaging('stage', (f, p) => createGitService(cwd).stageFile(f, p)),
    [runHunkStaging, cwd]
  )

  // Unstage the currently focused hunk.
  const handleUnstage = useCallback(
    (): Promise<void> =>
      runHunkStaging('unstage', (f, p) =>
        createGitService(cwd).unstageFile(f, p)
      ),
    [runHunkStaging, cwd]
  )

  // Discard the currently focused hunk.
  // When viewing the STAGED diff the user expects both the staged and
  // working-tree changes to be removed, so pass scope='both'.
  const handleDiscard = useCallback(
    (): Promise<void> =>
      runHunkStaging('discard', (f, p) =>
        createGitService(cwd).discardChanges(
          f,
          p,
          selectedFileStaged ? 'both' : 'unstaged'
        )
      ),
    [runHunkStaging, cwd, selectedFileStaged]
  )

  // Discard ALL changes to the selected file (no hunk patch — whole file).
  // When viewing the STAGED diff use scope='both' so staged-new files are
  // removed from disk and staged modifications are fully reverted to HEAD.
  const handleDiscardAll = useCallback(async (): Promise<void> => {
    if (staging || !selectedFilePath) {
      return
    }

    const service = createGitService(cwd)
    setStaging(true)

    try {
      await service.discardChanges(
        selectedFilePath,
        undefined,
        selectedFileStaged ? 'both' : 'unstaged'
      )

      refetchDiff()
      ;(gitStatus ?? internalGitStatus).refresh()
    } catch (err) {
      notifyInfo(
        `Failed to discard all changes: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setStaging(false)
    }
  }, [
    staging,
    selectedFilePath,
    selectedFileStaged,
    cwd,
    notifyInfo,
    refetchDiff,
    gitStatus,
    internalGitStatus,
  ])

  // Pierre option state — every option here is a controlled-component value
  // surfaced upward from DiffChipToolbar. Most values drive <MultiFileDiff>
  // on the next render. `theme` and `lineDiffType` are special: the worker
  // pool owns them (see the render-options sync effect below), so they flow
  // through `syncedRenderOptions` and the diff remount waits for the pool to
  // accept the new value first.
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
  const [theme, setTheme] = useState<DiffsThemeNames>('pierre-dark')
  const [lineDiffType, setLineDiffType] = useState<LineDiffType>('word')

  const [diffIndicators, setDiffIndicators] =
    useState<DiffIndicators>('classic')

  const [overflowOpt, setOverflowOpt] = useState<Overflow>('scroll')
  const [disableLineNumbers, setDisableLineNumbers] = useState(false)
  const [disableBackground, setDisableBackground] = useState(false)
  const [disableFileHeader, setDisableFileHeader] = useState(false)
  const [stickyHeader, setStickyHeader] = useState(true)

  // Pool-owned render options, gated behind the worker-pool sync below so the
  // diff remount waits until the pool actually accepts the new value.
  // `renderedTheme` / `renderedLineDiffType` read from HERE (not from `theme` /
  // `lineDiffType` directly) whenever a pool is present.
  const [syncedRenderOptions, setSyncedRenderOptions] =
    useState<PoolRenderOptions>({ theme, lineDiffType })
  const syncedRenderOptionsRef = useRef<PoolRenderOptions>(syncedRenderOptions)

  const [renderSyncError, setRenderSyncErrorState] = useState<string | null>(
    null
  )
  const renderSyncErrorRef = useRef<string | null>(null)

  const setRenderSyncError = useCallback((message: string | null): void => {
    if (renderSyncErrorRef.current === message) {
      return
    }

    renderSyncErrorRef.current = message
    setRenderSyncErrorState(message)
  }, [])

  const commitSyncedRenderOptions = useCallback(
    (next: PoolRenderOptions): void => {
      const prev = syncedRenderOptionsRef.current
      if (
        prev.theme === next.theme &&
        prev.lineDiffType === next.lineDiffType
      ) {
        return
      }

      syncedRenderOptionsRef.current = next
      setSyncedRenderOptions(next)
    },
    []
  )

  // Responsive width tracking. The right pane drives the two width bands:
  //   width < SPLIT_MIN_WIDTH_PX → coerce diffStyle to 'unified' (saved
  //                                preference preserved; coercion is read-only)
  //   width < DIFF_MIN_WIDTH_PX  → render <DiffNarrowPlaceholder> instead
  //                                of MultiFileDiff (toolbar stays mounted)
  // Track the actual DOM node because the populated pane mounts after the
  // loading branch. A one-shot ref read can miss that later mount entirely.
  const [paneNode, setPaneNode] = useState<HTMLDivElement | null>(null)
  const [paneWidth, setPaneWidth] = useState(0)

  useLayoutEffect(() => {
    if (!paneNode) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      setPaneWidth(entries[0].contentRect.width)
    })
    observer.observe(paneNode)

    return (): void => observer.disconnect()
  }, [paneNode])

  // Push pool-owned render options (theme + lineDiffType) into the shared
  // Pierre worker pool. The worker tokenizes off-main-thread AND computes
  // word-level intra-line decorations there, and
  // `DiffHunksRenderer.getRenderOptions()` returns
  // `workerManager.getDiffRenderOptions()` wholesale when a pool is active (see
  // node_modules/@pierre/diffs/dist/renderers/DiffHunksRenderer.js), shadowing
  // the per-instance `<MultiFileDiff options>` props. Without this sync the
  // toolbar's THEME and HIGHLIGHT dropdowns write local state but the diff
  // keeps rendering with the pool's initial values (both surfaced during PR1
  // QA). NOTE: `setRenderOptions` resets every omitted field to its default,
  // so theme and lineDiffType must be pushed together — passing only `theme`
  // silently reset lineDiffType back to Pierre's `word-alt` default.
  const workerPool = useWorkerPool()

  // Push pool-owned render options (theme + lineDiffType) into the shared
  // Pierre worker pool via module-level pool-keyed serialization. Each write
  // is enqueued after the pool's previous pending write so submissions land in
  // order across ALL DiffPanelContent instances that share the same pool — the
  // per-instance chain from #276 only serialized within one instance and left
  // a race window when two panes (split layout) or an unmount/remount overlapped
  // on the app-wide pool singleton.
  //
  // theme and lineDiffType are intentionally app-wide for v1: the app mounts
  // ONE <WorkerPoolContextProvider>, so all diff panes share one pool instance
  // which holds one set of render options. Per-pane independent themes are out
  // of scope and would require per-pane pool topology changes.
  //
  // The per-run `cancelled` flag (set by the effect cleanup) is passed as the
  // `shouldSkip` predicate so a superseded effect run silently skips its write
  // while still letting subsequent runs proceed through the chain.
  useEffect(() => {
    const next: PoolRenderOptions = { theme, lineDiffType }

    if (!workerPool) {
      commitSyncedRenderOptions(next)

      return
    }

    let cancelled = false

    const run = async (): Promise<void> => {
      try {
        await enqueuePoolWrite(workerPool, next, () => cancelled)

        if (!cancelled) {
          setRenderSyncError(null)
          commitSyncedRenderOptions(next)
        }
      } catch (err) {
        if (!cancelled) {
          setRenderSyncError(err instanceof Error ? err.message : String(err))
        }
      }
    }

    void run()

    return (): void => {
      cancelled = true
    }
  }, [
    commitSyncedRenderOptions,
    setRenderSyncError,
    workerPool,
    theme,
    lineDiffType,
  ])
  const renderedTheme = workerPool ? syncedRenderOptions.theme : theme

  const renderedLineDiffType = workerPool
    ? syncedRenderOptions.lineDiffType
    : lineDiffType

  const hasMeasuredPane = paneWidth > 0

  const splitForced =
    hasMeasuredPane && diffStyle === 'split' && paneWidth < SPLIT_MIN_WIDTH_PX
  const effectiveDiffStyle: DiffStyle = splitForced ? 'unified' : diffStyle
  const tooNarrow = hasMeasuredPane && paneWidth < DIFF_MIN_WIDTH_PX

  const handleDiffStyleChange = useCallback(
    (next: DiffStyle): void => {
      if (splitForced && next === 'unified') {
        return
      }

      setDiffStyle(next)
    },
    [splitForced]
  )

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

  // File navigation — index of the selected file within effectiveFiles, or
  // -1 when nothing is selected. The (path, staged) pair is the identity used
  // everywhere else in this component (auto-select, selectedFileEntry), so we
  // match on both rather than path alone. The `=== null` guard mirrors
  // `selectedFileEntry` above (ESLint's no-unnecessary-condition rejects
  // optional chaining inside the predicate, since a truthy first comparison
  // already proves the receiver non-null).
  const currentFileIndex =
    effectiveSelectedFile === null
      ? -1
      : effectiveFiles.findIndex(
          (f) =>
            f.path === effectiveSelectedFile.path &&
            f.staged === effectiveSelectedFile.staged
        )

  // Step the selection by `delta` files with wrap-around. Declared BEFORE the
  // early-return ladder below so the hook order stays stable across renders
  // (rules-of-hooks — a recent regression added a hook after an early return
  // and hit "rendered more hooks than during the previous render").
  const goToFile = useCallback(
    (delta: number): void => {
      if (effectiveFiles.length === 0) {
        return
      }

      const nextIndex =
        currentFileIndex === -1
          ? delta >= 0
            ? 0
            : effectiveFiles.length - 1
          : (((currentFileIndex + delta) % effectiveFiles.length) +
              effectiveFiles.length) %
            effectiveFiles.length
      const file = effectiveFiles[nextIndex]
      commitSelection({ path: file.path, staged: file.staged, cwd })
    },
    [effectiveFiles, currentFileIndex, commitSelection, cwd]
  )

  // Toolbar shell ref for anchoring the FinishFeedbackPopover.
  const toolbarShellRef = useRef<HTMLDivElement>(null)

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
      <div className="thin-scrollbar w-60 shrink-0 border-r border-white/5 overflow-y-auto">
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
      <div
        ref={setPaneNode}
        data-testid="diff-right-pane"
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div
          ref={toolbarShellRef}
          data-testid="diff-toolbar-shell"
          className="shrink-0"
        >
          <DiffChipToolbar
            diffMode={selectedFileStaged ? 'staged' : 'unstaged'}
            diffStyle={effectiveDiffStyle}
            onDiffStyleChange={handleDiffStyleChange}
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
            totalHunks={hunkCount}
            focusedHunkIndex={clampedHunkIndex}
            onPrevHunk={onPrevHunk}
            onNextHunk={onNextHunk}
            onPrevFile={(): void => goToFile(-1)}
            onNextFile={(): void => goToFile(1)}
            currentFileIndex={currentFileIndex}
            totalFiles={effectiveFiles.length}
            onStage={handleStage}
            onUnstage={handleUnstage}
            onDiscard={handleDiscard}
            onDiscardAll={handleDiscardAll}
            staging={staging}
            selectedFileName={selectedFilePath ?? undefined}
            feedbackCount={feedback.totalAnnotations()}
            onDiscardFeedback={feedback.clearBatch}
            onFinishFeedback={(): void => setFinishOpen(true)}
          />
          {renderSyncError !== null ? (
            <div
              role="alert"
              className="px-3 pb-2 text-[11px] leading-4 text-[#f38ba8]"
            >
              Diff render sync failed: {renderSyncError}
            </div>
          ) : null}
          {notifyMessage !== null ? (
            <div
              role="status"
              aria-live="polite"
              className="px-3 pb-2 text-[11px] leading-4 text-on-surface-variant"
            >
              {notifyMessage}
            </div>
          ) : null}
          {finishOpen && toolbarShellRef.current !== null ? (
            <FinishFeedbackPopover
              anchor={toolbarShellRef.current}
              result={resolveCandidatePanes({
                allPanes: feedbackDispatch?.candidates ?? [],
                diffCwd: cwd,
              })}
              commentCount={feedback.totalAnnotations()}
              fileCount={feedback.batch.size}
              onCancel={(): void => setFinishOpen(false)}
              onSend={handleSendFeedback}
            />
          ) : null}
        </div>
        <div
          data-testid="diff-scroll-body"
          className="min-h-0 flex-1 overflow-auto"
        >
          {diffError ? (
            <ErrorCard message={diffError.message} />
          ) : diffLoading ? (
            <LoadingCard />
          ) : pierreInputs ? (
            tooNarrow ? (
              <DiffNarrowPlaceholder min={DIFF_MIN_WIDTH_PX} />
            ) : (
              <MultiFileDiff
                // `key` forces a clean remount after the worker pool has
                // accepted new pool-owned options (theme + lineDiffType).
                // Pierre's WorkerPoolManager path normally rerenders via its
                // theme subscribers, but PR1 QA observed the second theme
                // switch sticking. Forcing a remount is a belt-and-braces
                // remedy: a brand-new FileDiff instance requests fresh
                // tokenization from the pool only after `setRenderOptions`
                // resolves. The key is built from the SYNCED values so it only
                // changes once the pool has the new option — no flash of the
                // prior highlighting.
                // Cost: one extra tokenize per theme/highlight change.
                // Acceptable for v1; revisit if perf is an issue with very
                // large diffs.
                key={`${renderedTheme}:${renderedLineDiffType}`}
                oldFile={pierreInputs.oldFile}
                newFile={pierreInputs.newFile}
                selectedLines={selectedLines}
                lineAnnotations={lineAnnotations}
                options={{
                  diffStyle: effectiveDiffStyle,
                  theme: renderedTheme,
                  diffIndicators,
                  lineDiffType: renderedLineDiffType,
                  overflow: overflowOpt,
                  disableLineNumbers,
                  disableBackground,
                  disableFileHeader,
                  stickyHeader,
                  enableGutterUtility: true,
                }}
                renderGutterUtility={(getHoveredLine): ReactElement => (
                  <button
                    type="button"
                    aria-label="Add comment on this line"
                    className="flex h-5 w-5 items-center justify-center rounded bg-primary/80 text-on-primary hover:bg-primary"
                    onClick={(): void => {
                      const hovered = getHoveredLine()
                      if (hovered && selectedFilePath !== null) {
                        setComposerTarget({
                          lineNumber: hovered.lineNumber,
                          side: hovered.side,
                          filePath: selectedFilePath,
                          staged: selectedFileStaged,
                        })
                      }
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-sm leading-none"
                    >
                      add
                    </span>
                  </button>
                )}
                renderAnnotation={(
                  annotation: DiffLineAnnotation<ReviewComment>
                ): ReactElement => {
                  const isDraft = annotation.metadata.id === DRAFT_ID

                  const isEditing =
                    composerTarget?.editId !== undefined &&
                    composerTarget.editId === annotation.metadata.id

                  if (isDraft || isEditing) {
                    return (
                      <ReviewCommentComposer
                        lineNumber={annotation.lineNumber}
                        side={annotation.side}
                        initialText={isEditing ? annotation.metadata.text : ''}
                        onConfirm={confirmComposer}
                        onCancel={closeComposer}
                      />
                    )
                  }

                  return (
                    <ReviewCommentRow
                      comment={annotation.metadata}
                      onEdit={(): void =>
                        setComposerTarget({
                          lineNumber: annotation.lineNumber,
                          side: annotation.side,
                          filePath: selectedFilePath ?? '',
                          staged: selectedFileStaged,
                          editId: annotation.metadata.id,
                        })
                      }
                      onDelete={(): void =>
                        feedback.removeAnnotation(
                          cwd,
                          selectedFilePath ?? '',
                          selectedFileStaged,
                          annotation.metadata.id
                        )
                      }
                    />
                  )
                }}
                style={{ display: 'block', width: '100%' }}
              />
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}
