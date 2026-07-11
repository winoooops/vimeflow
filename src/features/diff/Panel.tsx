import {
  type ReactElement,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import type {
  AnnotationSide,
  DiffLineAnnotation,
  FileDiffOptions,
  SelectedLineRange,
} from '@pierre/diffs'
import { Popover } from '@/components/Popover'
import { useGitStatus, type UseGitStatusReturn } from './hooks/useGitStatus'
import { useFileDiff } from './hooks/useFileDiff'
import { ChangedFilesListSurface } from './components/ChangedFilesList'
import { toPierreInputs, findRawDiffHunkIndex } from './services/pierreAdapter'
import { extractHunkPatch } from './services/gitPatch'
import { createGitService } from './services/gitService'
import { useNotifyInfo } from '../workspace/hooks/useNotifyInfo'
import type { ChangedFile, SelectedDiffFile } from './types'
import {
  FILE_COMMENT_LINE_NUMBER,
  DEFAULT_REVIEW_COMMENT_CATEGORY,
  isFileLevelReviewAnnotation,
  isLineLevelReviewAnnotation,
  isPendingReviewAnnotation,
  reviewCommentCategory,
  useFeedbackBatch,
  parseBatchKey,
  type FeedbackDraftStore,
  type ReviewComment,
  type ReviewCommentCategory,
  type UseFeedbackBatchReturn,
} from './hooks/useFeedbackBatch'
import { useKeyboard } from './hooks/useKeyboard'
import { useDiffSearch } from './hooks/useDiffSearch'
import { useDiffRangeBars } from './hooks/useDiffRangeBars'
import {
  dispatchFeedbackBatch,
  formatFeedbackPayload,
  makeDispatchNonce,
  type DispatchEntry,
} from './services/feedbackDispatch'
import {
  setPendingReview,
  type PendingReviewHandle,
} from './services/pendingReviews'
import { writeClipboardText } from '@/lib/clipboard'
import {
  resolveCandidatePanes,
  type PaneCandidate,
  type FeedbackDispatchTarget,
} from './services/activePanePicker'
import {
  isFileAnnotationTarget,
  isSameAnnotationTarget,
  useReviewCommentDraft,
  type AnnotationTarget,
} from './hooks/useReviewCommentDraft'
import { useToolbarState } from './hooks/useToolbarState'
import { useReviewTargetNavigation } from './hooks/useReviewTargetNavigation'
import { useVisualSelection } from './hooks/useVisualSelection'
import { useRequestReview } from './hooks/useRequestReview'
import { Notifier } from './components/Notifier'
import { PanelBody } from './components/PanelBody'
import { DiffSearchButton } from './components/DiffSearchButton'
import { DiffSearchPopup } from './components/DiffSearchPopup'
import { ReviewCommentEditor } from './components/ReviewCommentEditor'
import { ReviewCommentRow } from './components/ReviewCommentRow'
import { ReviewLevelNotes } from './components/ReviewLevelNotes'
import { DIFF_SEARCH_UNSAFE_CSS } from './search/diffSearchDom'
import { DIFF_RANGE_BAR_UNSAFE_CSS } from './rangeBar/diffRangeBars'

// One stable <style> injected into pierre's shadow tree: the search highlight
// plus the persistent range-comment gutter bar (VIM-273). A module constant so
// pierre never force-rebuilds on an unsafeCSS identity change.
const DIFF_UNSAFE_CSS = `${DIFF_SEARCH_UNSAFE_CSS}\n${DIFF_RANGE_BAR_UNSAFE_CSS}`

const DIFF_NATIVE_FOCUS_SELECTOR =
  'button, input, textarea, select, [contenteditable], [role="textbox"]'
const FILES_LIST_STORAGE_KEY = 'vf-diff-files-open'
const FILES_LIST_CLOSE_DELAY_MS = 220

const isDiffNativeFocusTarget = (target: Element): boolean =>
  target.closest(DIFF_NATIVE_FOCUS_SELECTOR) !== null

// A keyboard reveal (`e`) has no mouse-leave to close it, so it self-dismisses
// after this delay — longer than the hover-leave delay since there's no pointer
// motion to signal intent. Wire to Settings later.
const FILES_LIST_KEYBOARD_AUTO_HIDE_MS = 5000

const getFilesListStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

const readFilesListPinnedOpen = (): boolean => {
  const storage = getFilesListStorage()

  if (storage === null) {
    return false
  }

  try {
    return storage.getItem(FILES_LIST_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const writeFilesListPinnedOpen = (open: boolean): void => {
  const storage = getFilesListStorage()

  if (storage === null) {
    return
  }

  try {
    storage.setItem(FILES_LIST_STORAGE_KEY, open ? '1' : '0')
  } catch {
    // Quota exceeded / private mode — the current panel state still works.
  }
}

interface FileCommentAnchorPoint {
  left: number
  top: number
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
type PanelSelectionControl =
  | { selectedFile?: undefined; onSelectedFileChange?: undefined }
  | {
      selectedFile: SelectedDiffFile | null
      onSelectedFileChange: (file: SelectedDiffFile | null) => void
    }

export interface FeedbackRepoRootRef {
  current: string
  repoRootForCwd?: (cwd: string) => string
}

interface PanelBaseProps {
  /** Working directory for git commands */
  cwd?: string
  /** Optional shared git status from a parent-level watcher subscription */
  gitStatus?: UseGitStatusReturn
  /** Optional shared feedback batch from the workspace shell. */
  feedbackBatch?: UseFeedbackBatchReturn
  /** Optional shared open-comment draft from the workspace shell. */
  feedbackDraft?: FeedbackDraftStore
  /** Optional shared repo-root cache for feedback dispatch path resolution. */
  feedbackRepoRootRef?: FeedbackRepoRootRef
  /** Optional feedback dispatch target for inline review comments */
  feedbackDispatch?: FeedbackDispatchTarget
  /** The active feedback owner (sessionId:paneId) — recorded at dispatch so an
   * agent reply routes back to this review even after a pane switch (VIM-249). */
  feedbackOwnerKey?: string
}

export type PanelProps = PanelBaseProps & PanelSelectionControl

// Monotonic id source. A module counter keeps comment ids stable + unique
// without reaching for Date.now()/Math.random() in render.

let feedbackCommentSeq = 0

const nextFeedbackCommentId = (): string =>
  `feedback-comment-${(feedbackCommentSeq += 1)}`

type KeyboardConfirmAction = 'stage-hunk' | 'discard-hunk' | 'discard-file'

const keyboardConfirmCopy = (
  action: KeyboardConfirmAction,
  selectedFileName: string | null,
  staged: boolean
): { title: string; body: string; variant: 'primary' | 'danger' } => {
  const fileLabel = selectedFileName ?? 'this file'

  if (action === 'stage-hunk') {
    return {
      title: staged ? 'Unstage hunk?' : 'Stage hunk?',
      body: staged
        ? `Move the selected hunk in ${fileLabel} out of the index?`
        : `Stage the selected hunk in ${fileLabel}?`,
      variant: 'primary',
    }
  }

  if (action === 'discard-hunk') {
    return {
      title: 'Discard hunk?',
      body: `Discard the selected hunk in ${fileLabel}? This cannot be undone.`,
      variant: 'danger',
    }
  }

  return {
    title: 'Discard file?',
    body: `Discard all changes in ${fileLabel}? This cannot be undone.`,
    variant: 'danger',
  }
}

const commentTargetForLineOrRange = (
  filePath: string,
  staged: boolean,
  lineNumber: number,
  side: AnnotationSide,
  selectedRange: SelectedLineRange | null
): AnnotationTarget => {
  const selectedRangeSide: AnnotationSide = selectedRange?.side ?? 'additions'

  if (
    selectedRange === null ||
    selectedRangeSide !== side ||
    lineNumber < selectedRange.start ||
    lineNumber > selectedRange.end
  ) {
    return { lineNumber, side, filePath, staged }
  }

  return {
    lineNumber: selectedRange.start,
    side: selectedRangeSide,
    filePath,
    staged,
    ...(selectedRange.end === selectedRange.start
      ? {}
      : { rangeEndLine: selectedRange.end }),
  }
}

/**
 * Panel - Real diff viewer that replaces the placeholder
 *
 * Fetches git status and displays changed files + Pierre's <MultiFileDiff>
 * with the chip toolbar above it. Supports controlled mode for cross-
 * component selection coordination.
 */
export const Panel = ({
  cwd = '.',
  gitStatus = undefined,
  selectedFile: controlledSelectedFile,
  onSelectedFileChange,
  feedbackBatch = undefined,
  feedbackDraft = undefined,
  feedbackRepoRootRef = undefined,
  feedbackDispatch = undefined,
  feedbackOwnerKey = undefined,
}: PanelProps): ReactElement => {
  const internalGitStatus = useGitStatus(cwd, {
    watch: true,
    enabled: gitStatus === undefined,
  })

  const {
    files,
    filesCwd,
    revision: statusRevision = 0,
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

  // Reset selection when cwd actually changes (belt-and-suspenders, render
  // guard is primary). Do not fire on initial mount: WorkspaceView owns this
  // value across dock close/reopen, and clearing it on mount loses the user's
  // previously selected changed file before auto-select falls back to row 1.
  const previousSelectionCwdRef = useRef(cwd)
  useEffect(() => {
    if (isControlled) {
      previousSelectionCwdRef.current = cwd

      return
    }

    if (previousSelectionCwdRef.current === cwd) {
      return
    }

    previousSelectionCwdRef.current = cwd
    commitSelection(null)
  }, [cwd, commitSelection, isControlled])

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

  const selectedFileDiffRefreshToken =
    selectedFileEntry === undefined
      ? undefined
      : `${filesCwd ?? ''}:${statusRevision}:${selectedFileEntry.path}:${
          selectedFileEntry.staged ? 'staged' : 'unstaged'
        }`

  const {
    response,
    loading: diffLoading,
    error: diffError,
    latestDiffStatus,
    refetch: refetchDiff,
    acceptLatestDiff,
  } = useFileDiff(
    selectedFilePath,
    selectedFileStaged,
    cwd,
    selectedFileUntracked,
    selectedFileDiffRefreshToken
  )

  const responseMatchesSelection =
    response !== null &&
    selectedFilePath !== null &&
    response.fileDiff.filePath === selectedFilePath

  const activeResponse = responseMatchesSelection ? response : null

  // Notification hook — reused for the "Pierre split differently" and
  // "could not isolate hunk" informational messages.
  const { message: notifyMessage, notifyInfo } = useNotifyInfo()
  const diffRootRef = useRef<HTMLDivElement>(null)
  // Chromium does not dispatch blur/focusout when a focused child unmounts.
  const focusWasInsidePanelRef = useRef(false)
  const diffScrollBodyRef = useRef<HTMLDivElement>(null)

  const filesListHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const [filesListPinnedOpen, setFilesListPinnedOpen] = useState(
    readFilesListPinnedOpen
  )
  const [filesListRevealed, setFilesListRevealed] = useState(false)

  const [fileCommentAnchor, setFileCommentAnchor] =
    useState<HTMLDivElement | null>(null)

  const [fileCommentAnchorPoint, setFileCommentAnchorPoint] =
    useState<FileCommentAnchorPoint | null>(null)

  const clearFilesListHideTimer = useCallback((): void => {
    if (filesListHideTimerRef.current !== null) {
      clearTimeout(filesListHideTimerRef.current)
      filesListHideTimerRef.current = null
    }
  }, [])

  useEffect(() => clearFilesListHideTimer, [clearFilesListHideTimer])

  const revealFilesList = useCallback((): void => {
    clearFilesListHideTimer()
    setFilesListRevealed(true)
  }, [clearFilesListHideTimer])

  // Stable focus owner for handoffs before focused diff/comment nodes unmount.
  const focusDiffRoot = useCallback((): void => {
    diffRootRef.current?.focus({ preventScroll: true })
  }, [])

  const toggleFilesList = useCallback((): void => {
    clearFilesListHideTimer()
    focusDiffRoot()

    if (filesListPinnedOpen) {
      writeFilesListPinnedOpen(false)
      setFilesListPinnedOpen(false)
      setFilesListRevealed(false)

      return
    }

    const willReveal = !filesListRevealed
    setFilesListRevealed(willReveal)

    // Timed self-dismiss for the keyboard reveal; any interaction (hover/focus/
    // pin/file-select) clears this via the shared hide timer.
    if (willReveal) {
      filesListHideTimerRef.current = setTimeout(() => {
        setFilesListRevealed(false)
        filesListHideTimerRef.current = null
      }, FILES_LIST_KEYBOARD_AUTO_HIDE_MS)
    }
  }, [
    clearFilesListHideTimer,
    filesListPinnedOpen,
    filesListRevealed,
    focusDiffRoot,
  ])

  const scheduleHideFilesList = useCallback((): void => {
    clearFilesListHideTimer()

    if (filesListPinnedOpen) {
      return
    }

    filesListHideTimerRef.current = setTimeout(() => {
      setFilesListRevealed(false)
      filesListHideTimerRef.current = null
    }, FILES_LIST_CLOSE_DELAY_MS)
  }, [clearFilesListHideTimer, filesListPinnedOpen])

  const toggleFilesListPinned = useCallback((): void => {
    clearFilesListHideTimer()
    focusDiffRoot()
    setFilesListRevealed(true)

    const next = !filesListPinnedOpen

    writeFilesListPinnedOpen(next)
    setFilesListPinnedOpen(next)
  }, [clearFilesListHideTimer, filesListPinnedOpen, focusDiffRoot])

  const handleDiffRootPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      // DockPanel steals non-interactive pointerdown focus to its section; diff
      // selection prevents the browser default focus handoff from correcting it.
      event.stopPropagation()

      if (
        event.target instanceof Element &&
        !isDiffNativeFocusTarget(event.target)
      ) {
        focusDiffRoot()
      }
    },
    [focusDiffRoot]
  )

  const handleDiffRootFocus = useCallback((): void => {
    focusWasInsidePanelRef.current = true
  }, [])

  const handleDiffRootBlur = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>): void => {
      if (event.relatedTarget !== null) {
        const nextTarget = event.relatedTarget

        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          focusWasInsidePanelRef.current = false
        }

        return
      }

      if (!document.hasFocus()) {
        return
      }

      requestAnimationFrame(() => {
        if (
          focusWasInsidePanelRef.current &&
          document.activeElement === document.body
        ) {
          focusDiffRoot()
        }
      })
    },
    [focusDiffRoot]
  )

  useEffect(() => {
    const clearPanelFocusOnOutsidePointerDown = (event: PointerEvent): void => {
      const root = diffRootRef.current

      if (
        root !== null &&
        event.target instanceof Node &&
        !root.contains(event.target)
      ) {
        focusWasInsidePanelRef.current = false
      }
    }

    document.addEventListener(
      'pointerdown',
      clearPanelFocusOnOutsidePointerDown,
      {
        capture: true,
      }
    )

    return (): void => {
      document.removeEventListener(
        'pointerdown',
        clearPanelFocusOnOutsidePointerDown,
        { capture: true }
      )
    }
  }, [])

  useEffect(() => {
    // No dependency array: focused child removal is caused by render, so every
    // committed render checks for Chromium's silent body-focus handoff.
    if (
      focusWasInsidePanelRef.current &&
      document.activeElement === document.body
    ) {
      focusDiffRoot()
    }
  })

  const localFeedback = useFeedbackBatch()
  const { clearBatch: clearLocalFeedbackBatch } = localFeedback
  const hasParentFeedbackBatch = feedbackBatch !== undefined
  const feedback: UseFeedbackBatchReturn = feedbackBatch ?? localFeedback
  const localRepoRootRef = useRef('') as FeedbackRepoRootRef
  const repoRootRef = feedbackRepoRootRef ?? localRepoRootRef

  // Track cwd transitions that invalidate per-repo derived state. The
  // workspace shell owns feedback-batch clearing when a parent batch is passed;
  // standalone/uncontrolled usage keeps the prior local clear behavior.
  const previousCwdRef = useRef(cwd)

  // Last non-empty git repo root seen for the current cwd. `response.repoRoot`
  // goes transiently null whenever the user selects another file (useFileDiff
  // clears `response` while the next diff loads or if it errors); without this,
  // an in-flight feedback batch sent during that window would fall back to
  // repo-relative paths and mis-resolve for agents in a repo subdirectory.
  // Reset on cwd change below (a new repo invalidates the old root).
  useEffect(() => {
    if (previousCwdRef.current !== cwd) {
      previousCwdRef.current = cwd
      repoRootRef.current = ''
      if (!hasParentFeedbackBatch) {
        clearLocalFeedbackBatch()
      }
    }
  }, [cwd, clearLocalFeedbackBatch, hasParentFeedbackBatch, repoRootRef])

  useEffect(() => {
    if (response?.repoRoot) {
      repoRootRef.current = response.repoRoot
    }
  }, [response, repoRootRef])

  // Real annotations for the currently selected file.
  const annotationsForSelectedFile = feedback.annotationsForFile(
    cwd,
    selectedFilePath ?? '',
    selectedFileStaged
  )

  const realAnnotations = useMemo(
    (): DiffLineAnnotation<ReviewComment>[] =>
      annotationsForSelectedFile.filter(isLineLevelReviewAnnotation),
    [annotationsForSelectedFile]
  )

  const fileCommentsForSelectedFile = useMemo(
    (): DiffLineAnnotation<ReviewComment>[] =>
      selectedFileEntry === undefined
        ? []
        : feedback
            .annotationsForFile(
              cwd,
              selectedFileEntry.path,
              selectedFileEntry.staged
            )
            .filter(isFileLevelReviewAnnotation),
    [cwd, feedback, selectedFileEntry]
  )

  const {
    annotationTarget,
    commentDraftText,
    commentCategory,
    commentDraftIsRecoverable,
    lineAnnotations,
    setAnnotationTarget,
    setCommentDraftText,
    setCommentCategory,
    closeCommentDraft: closeCommentEditor,
  } = useReviewCommentDraft({
    cwd,
    feedbackDraft,
    selectedFilePath,
    selectedFileStaged,
    activeFileDiff: activeResponse?.fileDiff ?? null,
    realAnnotations,
    focusDiffRoot,
  })

  const fileCommentDraftTarget =
    annotationTarget !== null && isFileAnnotationTarget(annotationTarget)
      ? annotationTarget
      : null

  const fileCommentDraftIsVisible =
    fileCommentDraftTarget !== null &&
    selectedFileEntry?.path === fileCommentDraftTarget.filePath &&
    selectedFileEntry.staged === fileCommentDraftTarget.staged

  const recoverableCommentDraftTarget =
    commentDraftIsRecoverable &&
    annotationTarget !== null &&
    !fileCommentDraftIsVisible
      ? annotationTarget
      : null

  // Finish feedback popover open state.
  const [finishOpen, setFinishOpen] = useState(false)
  // The comment being single-sent (VIM-297); scopes the Finish popover +
  // dispatch to exactly that comment. null = whole-batch behavior.
  const [sendNowCommentId, setSendNowCommentId] = useState<string | null>(null)

  const [keyboardConfirmAction, setKeyboardConfirmAction] =
    useState<KeyboardConfirmAction | null>(null)

  const setKeyboardConfirm = useCallback(
    (
      next: SetStateAction<KeyboardConfirmAction | null>,
      focusDiff = true
    ): void => {
      if (focusDiff) {
        focusDiffRoot()
      }

      setKeyboardConfirmAction(next)
    },
    [focusDiffRoot]
  )

  const sendingFeedbackRef = useRef(false)

  const buildFeedbackEntries = useCallback(
    (
      onlyCommentId?: string
    ): {
      entries: DispatchEntry[]
      handles: Map<number, PendingReviewHandle>
    } => {
      // git reports file paths relative to the repo TOPLEVEL, but the target
      // agent runs in the pane's cwd (possibly a repo subdirectory). Join the
      // toplevel (`response.repoRoot`) so the dispatched reference is an
      // absolute path the agent can resolve regardless of its cwd. Falls back to
      // the repo-relative path if the root is unavailable (not in a git repo).
      // Prefer the per-batch cwd root; fall back to the current diff's root, then
      // the last-known root when `response` is transiently null (file-switch
      // loading/error) so an in-flight batch keeps absolute paths.
      const repoRoot = response?.repoRoot ?? repoRootRef.current
      const entries: DispatchEntry[] = []
      // [#n] → the comment it addressed. The path fields are the annotation BATCH
      // KEY (repo-relative), NOT the absolute prompt path, so an agent reply
      // (VIM-249) attaches back onto the same batch the comment lives in.
      const handles = new Map<number, PendingReviewHandle>()
      let handle = 0

      for (const [key, annotations] of feedback.batch) {
        // Only dispatch comments that have not been sent yet; already-dispatched
        // thread anchors stay in the hunk but are never re-sent (VIM-282).
        const pending = annotations
          .filter(isPendingReviewAnnotation)
          // Single-send (VIM-297): scope the whole path to one comment.
          .filter(
            (annotation) =>
              onlyCommentId === undefined ||
              annotation.metadata.id === onlyCommentId
          )
        if (pending.length === 0) {
          continue
        }

        const { cwd: entryCwd, filePath: relPath, staged } = parseBatchKey(key)

        const entryRepoRoot = repoRootRef.repoRootForCwd?.(entryCwd)

        const resolvedRepoRoot =
          entryRepoRoot && entryRepoRoot.length > 0 ? entryRepoRoot : repoRoot

        const filePath = resolvedRepoRoot
          ? `${resolvedRepoRoot}/${relPath}`
          : relPath
        entries.push({ filePath, staged, annotations: pending })

        // Number handles in the SAME nested order formatFeedbackPayload assigns
        // [#n], so handle N maps to the Nth dispatched comment.
        for (const annotation of pending) {
          handle += 1
          handles.set(handle, {
            cwd: entryCwd,
            filePath: relPath,
            staged,
            lineNumber: annotation.lineNumber,
            side: annotation.side,
            target: annotation.metadata.target,
          })
        }
      }

      return { entries, handles }
    },
    [feedback.batch, repoRootRef, response]
  )

  const handleSendFeedback = useCallback(
    (pane: PaneCandidate, onlyCommentId?: string): void => {
      if (sendingFeedbackRef.current) {
        return
      }
      sendingFeedbackRef.current = true
      void (async (): Promise<void> => {
        const { entries, handles } = buildFeedbackEntries(onlyCommentId)
        // Per-dispatch correlation token the agent echoes in its reply block
        // (VIM-249), recorded below so a reply can be matched to this send.
        const nonce = makeDispatchNonce()

        try {
          // The addressed comment can vanish between opening the popover and
          // confirming (edit/delete) — never dispatch an empty payload.
          if (entries.length === 0) {
            setFinishOpen(false)
            setSendNowCommentId(null)

            return
          }
          if (feedbackDispatch) {
            await dispatchFeedbackBatch(
              pane.paneId,
              pane.ptyId,
              entries,
              nonce,
              feedbackDispatch.writePty
            )
            // Record the pending review so an agent-reply for this pty can be
            // correlated back to these comments (VIM-249). Keyed by (pty,
            // nonce) so concurrent dispatches coexist (VIM-297). Only when
            // there's an owner to attach onto.
            if (feedbackOwnerKey !== undefined && handles.size > 0) {
              setPendingReview({
                ptyId: pane.ptyId,
                ownerKey: feedbackOwnerKey,
                nonce,
                dispatchedAt: Date.now(),
                byHandle: handles,
              })
            }
          }
          // Keep the sent comments in the hunk as thread anchors instead of
          // wiping them (VIM-282); they are stamped dispatched so they are not
          // re-sent, counted as pending, or removed by discard.
          feedback.markDispatched(
            Date.now(),
            new Set(
              entries.flatMap((entry) =>
                entry.annotations.map((annotation) => annotation.metadata.id)
              )
            ),
            { clearDraftForWholeBatch: onlyCommentId === undefined }
          )
          setFinishOpen(false)
          setSendNowCommentId(null)
          const focusTerminal = feedbackDispatch?.focusTerminal
          if (focusTerminal !== undefined) {
            setTimeout(focusTerminal, 0)
          }
        } catch {
          notifyInfo('Terminal session ended; feedback not sent.')
        } finally {
          sendingFeedbackRef.current = false
        }
      })()
    },
    [
      buildFeedbackEntries,
      feedback,
      feedbackDispatch,
      feedbackOwnerKey,
      notifyInfo,
    ]
  )

  // Copy the whole review to the clipboard — the escape hatch when no agent is
  // running to send to (comments are otherwise trapped in the batch). It uses
  // the same resolved paths as the send path so pasted feedback works from an
  // agent cwd below the repo root.
  const handleCopyFeedback = useCallback(
    (onlyCommentId?: string): void => {
      const { entries } = buildFeedbackEntries(onlyCommentId)

      if (entries.length === 0) {
        return
      }

      const count = entries.reduce(
        (sum, entry) => sum + entry.annotations.length,
        0
      )
      setFinishOpen(false)
      setSendNowCommentId(null)

      void (async (): Promise<void> => {
        // Clipboard copy has no agent to reply, so the nonce is a throwaway that
        // just satisfies the payload signature.
        const copied = await writeClipboardText(
          formatFeedbackPayload(entries, makeDispatchNonce())
        )
        notifyInfo(
          copied
            ? `Copied ${count} comment${count === 1 ? '' : 's'} to the clipboard.`
            : 'Could not copy comments to the clipboard.'
        )
      })()
    },
    [buildFeedbackEntries, notifyInfo]
  )

  // Request review (VIM-304): the whole "arm a pending request, then dispatch or
  // copy it" flow lives in useRequestReview so this component stays a renderer.
  const review = useRequestReview({
    fileDiff: activeResponse?.fileDiff,
    ownerKey: feedbackOwnerKey,
    cwd,
    staged: selectedFileStaged,
    repoRoot: response?.repoRoot ?? repoRootRef.current,
    writePty: feedbackDispatch?.writePty,
    focusTerminal: feedbackDispatch?.focusTerminal,
    notify: notifyInfo,
  })

  // Single-flight staging flag — drops clicks while an IPC is in flight.
  const [staging, setStaging] = useState(false)

  // PR3: focusedHunkIndex is the 0-based index into activeResponse.fileDiff.hunks.
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

  const hunkCount = activeResponse?.fileDiff.hunks.length ?? 0

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

  const focusedHunk = activeResponse?.fileDiff.hunks[clampedHunkIndex] ?? null

  // Map a hunk to its Pierre line range. Deletion-only hunks (newLines === 0)
  // use old-side coordinates so the highlight lands on the deletions column.
  const hunkToRange = useCallback(
    (
      hunk: NonNullable<typeof activeResponse>['fileDiff']['hunks'][number]
    ): SelectedLineRange => {
      const isDeletionOnly = hunk.newLines === 0
      const lineStart = isDeletionOnly ? hunk.oldStart : hunk.newStart
      const lineCount = isDeletionOnly ? hunk.oldLines : hunk.newLines

      return {
        start: lineStart,
        end: lineStart + Math.max(lineCount - 1, 0),
        side: isDeletionOnly ? 'deletions' : 'additions',
      }
    },
    []
  )

  // Pierre anchors the gutter "+" comment affordance to the active SELECTION
  // whenever one exists (placeUtilityFromSelection in InteractionManager), only
  // falling back to the hovered line otherwise. A PERSISTENT focused-hunk
  // selection would therefore pin the "+" to that hunk and stop it following the
  // mouse. So the focused-hunk selection is surfaced only as a brief FLASH on
  // prev/next navigation (to scroll/highlight the target hunk), then cleared so
  // commenting works on any hovered line.
  const [navSelection, setNavSelection] = useState<SelectedLineRange | null>(
    null
  )
  const navClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearNavSelectionTimer = useCallback((): void => {
    if (navClearTimerRef.current !== null) {
      clearTimeout(navClearTimerRef.current)
      navClearTimerRef.current = null
    }
  }, [])

  const flashHunkSelection = useCallback(
    (
      hunk: NonNullable<typeof activeResponse>['fileDiff']['hunks'][number]
    ): void => {
      setNavSelection(hunkToRange(hunk))
      clearNavSelectionTimer()
      navClearTimerRef.current = setTimeout(() => {
        setNavSelection(null)
        navClearTimerRef.current = null
      }, 1200)
    },
    [hunkToRange, clearNavSelectionTimer]
  )

  useEffect(() => clearNavSelectionTimer, [clearNavSelectionTimer])

  // Drop any pending nav flash when the selected file changes (the hunk ranges
  // belong to the previous file).
  useEffect(() => {
    clearNavSelectionTimer()
    setNavSelection(null)
  }, [selectedFilePath, selectedFileStaged, clearNavSelectionTimer])

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
        activeResponse === null ||
        focusedHunk === null
      ) {
        return
      }

      const rawIndex = findRawDiffHunkIndex(activeResponse, focusedHunk)
      if (rawIndex === -1) {
        notifyInfo(
          `Pierre split this hunk differently than git — cannot ${verb} this region; use Discard All or the file-level chip`
        )

        return
      }

      const hunkPatch = extractHunkPatch(activeResponse.rawDiff, rawIndex)
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
      activeResponse,
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

  const {
    toolbarSettingsProps,
    multiFileDiffOptions,
    renderKey,
    renderSyncError,
    setDiffPaneElement,
    tooNarrow,
    effectiveDiffStyle,
    toggleDiffStyle,
  } = useToolbarState()

  // A syntax-theme or line-diff-style change re-keys the pierre surface and
  // remounts it. The generic post-render restore above only catches focus
  // falling to document.body, but the theme control (a portalled dropdown) can
  // leave focus on its chip and pierre's shadow-DOM remount can strand it on the
  // shadow host, so a theme switch would otherwise lose keyboard focus. Once the
  // remount commits, pull focus back to the diff root — but only when it's lost
  // to the body or already sitting inside the diff pane, never yanking it from
  // another workspace surface. Keyed on renderKey (theme + line-diff style) only;
  // file switches also re-key but must not grab focus.
  const previousRenderKeyRef = useRef(renderKey)
  useEffect(() => {
    const themeOrStyleChanged = previousRenderKeyRef.current !== renderKey
    previousRenderKeyRef.current = renderKey
    if (!themeOrStyleChanged) {
      return
    }

    const root = diffRootRef.current
    const active = document.activeElement

    const activeIsEditable =
      active instanceof Element && isDiffNativeFocusTarget(active)

    if (
      root !== null &&
      !activeIsEditable &&
      (active === document.body || root.contains(active))
    ) {
      focusDiffRoot()
    }
  }, [renderKey, focusDiffRoot])

  // In-file diff search (VIM-252). The identity key drives the hook's reset
  // rules: new key = different file (active match resets), null = nothing
  // searchable (popup closes; also covers the narrow placeholder). Everything
  // merged into pierre options below must stay deep-equal-stable across
  // renders or pierre force-rebuilds its DOM — hence the constant unsafeCSS
  // and the ref-forwarded onPostRender with fixed identity (spec §4).
  const diffSearchFileKey =
    selectedFilePath === null || tooNarrow
      ? null
      : `${cwd}:${selectedFilePath}:${
          selectedFileStaged ? 'staged' : 'unstaged'
        }`

  const diffSearch = useDiffSearch({
    fileKey: diffSearchFileKey,
    paintEnabled: true,
    focusPanel: focusDiffRoot,
    scrollContainerRef: diffScrollBodyRef,
  })

  const diffRangeBars = useDiffRangeBars({
    fileKey: diffSearchFileKey,
    annotations: realAnnotations,
  })

  const diffSearchPostRenderRef = useRef(diffSearch.handlePostRender)
  diffSearchPostRenderRef.current = diffSearch.handlePostRender
  const diffRangeBarsPostRenderRef = useRef(diffRangeBars.handlePostRender)
  diffRangeBarsPostRenderRef.current = diffRangeBars.handlePostRender
  const multiFileDiffOptionsRef = useRef(multiFileDiffOptions)
  multiFileDiffOptionsRef.current = multiFileDiffOptions

  const handleDiffPostRender = useCallback<
    NonNullable<FileDiffOptions<ReviewComment>['onPostRender']>
  >((node, instance) => {
    diffSearchPostRenderRef.current(node)
    diffRangeBarsPostRenderRef.current(node)
    multiFileDiffOptionsRef.current.onPostRender?.(node, instance)
  }, [])

  const diffOptionsWithSearch = useMemo<FileDiffOptions<ReviewComment>>(
    () => ({
      ...multiFileDiffOptions,
      unsafeCSS: DIFF_UNSAFE_CSS,
      onPostRender: handleDiffPostRender,
    }),
    [multiFileDiffOptions, handleDiffPostRender]
  )
  const fileHeaderVisible = !multiFileDiffOptions.disableFileHeader

  const clearTransientSelection = useCallback((): void => {
    clearNavSelectionTimer()
    setNavSelection(null)
  }, [clearNavSelectionTimer])

  const reviewTargetFileKey =
    selectedFilePath === null
      ? ''
      : `${selectedFilePath}:${selectedFileStaged ? 'staged' : 'unstaged'}`

  const {
    targets: reviewTargets,
    currentTarget: reviewTarget,
    activeTarget: activeReviewTarget,
    currentTargetComment: reviewTargetComment,
    activeTargetIndex: reviewTargetIndex,
    activateTarget: activateReviewTarget,
    activateTargetNearViewportCenter,
    deactivateTarget: deactivateReviewTarget,
    handlePointerMove: handleBodyPointerMove,
    moveTargetLine,
    moveTargetSide,
    scrollHunkIntoView,
    scrollTargetIntoView,
    selectedLines: reviewSelectedLines,
    targetIndexFromPointerEvent,
    targetIndexForHunk,
  } = useReviewTargetNavigation({
    annotations: realAnnotations,
    clearTransientSelection,
    diffStyle: effectiveDiffStyle,
    fileDiff: activeResponse?.fileDiff ?? null,
    fileKey: reviewTargetFileKey,
    onHunkIndexChange: setFocusedHunkIndex,
    scrollBodyRef: diffScrollBodyRef,
  })

  const {
    active: visualMode,
    cancel: cancelVisualSelection,
    moveLine: moveVisualSelectionLine,
    moveMouse: moveMouseVisualSelection,
    moveSide: moveVisualSelectionSide,
    selectedLines: visualSelectedLines,
    start: startVisualSelection,
    startMouse: startMouseVisualSelection,
    stopMouse: stopMouseVisualSelection,
    yank: yankVisualSelection,
  } = useVisualSelection({
    activeHunks: activeResponse?.fileDiff.hunks ?? null,
    activeTargetIndex: reviewTargetIndex,
    activateTarget: activateReviewTarget,
    diffStyle: effectiveDiffStyle,
    fileKey: reviewTargetFileKey,
    focusDiffRoot,
    moveTargetLine,
    moveTargetSide,
    notifyInfo,
    onPointerHover: handleBodyPointerMove,
    scrollTargetIntoView,
    shouldIgnorePointerTarget: (target): boolean =>
      target instanceof Element && isDiffNativeFocusTarget(target),
    targetIndexFromPointerEvent,
    targets: reviewTargets,
  })

  const onPrevHunk = useCallback((): void => {
    if (!activeResponse) {
      return
    }

    const hunks = activeResponse.fileDiff.hunks
    if (hunks.length === 0) {
      return
    }

    const next = (clampedHunkIndex + hunks.length - 1) % hunks.length
    deactivateReviewTarget()
    setFocusedHunkIndex(next)
    flashHunkSelection(hunks[next])
  }, [
    activeResponse,
    clampedHunkIndex,
    deactivateReviewTarget,
    flashHunkSelection,
  ])

  const onNextHunk = useCallback((): void => {
    if (!activeResponse) {
      return
    }

    const hunks = activeResponse.fileDiff.hunks
    if (hunks.length === 0) {
      return
    }

    const next = (clampedHunkIndex + 1) % hunks.length
    deactivateReviewTarget()
    setFocusedHunkIndex(next)
    flashHunkSelection(hunks[next])
  }, [
    activeResponse,
    clampedHunkIndex,
    deactivateReviewTarget,
    flashHunkSelection,
  ])

  const selectedLines: SelectedLineRange | null =
    visualSelectedLines ?? reviewSelectedLines ?? navSelection

  // Memoize the Pierre input pair on response identity. Without this,
  // `toPierreInputs(response)` would mint fresh { oldFile, newFile } object
  // references on every parent render, invalidating Pierre's internal
  // `useMemo([oldFile, newFile])` and forcing a re-tokenize on each render —
  // also a suspected contributor to the "theme switches once, then sticks"
  // bug observed during PR1 QA. Declared BEFORE the early returns below so
  // the hook order is stable across renders (rules-of-hooks).
  const pierreInputs = useMemo(
    () => (activeResponse ? toPierreInputs(activeResponse) : null),
    [activeResponse]
  )

  const panelRenderKey =
    pierreInputs === null ? renderKey : `${renderKey}:${pierreInputs.identity}`

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

  const selectDiffFile = useCallback(
    (file: Pick<ChangedFile, 'path' | 'staged'>, focusDiff = true): void => {
      if (focusDiff) {
        focusDiffRoot()
      }

      commitSelection({ path: file.path, staged: file.staged, cwd })
    },
    [commitSelection, cwd, focusDiffRoot]
  )

  const handleSelectDiffFileFromList = useCallback(
    (file: ChangedFile): void => {
      selectDiffFile(file)

      if (!filesListPinnedOpen) {
        clearFilesListHideTimer()
        setFilesListRevealed(false)
      }
    },
    [clearFilesListHideTimer, filesListPinnedOpen, selectDiffFile]
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
      selectDiffFile(file)
    },
    [effectiveFiles, currentFileIndex, selectDiffFile]
  )

  const scrollDiffPage = useCallback(
    (direction: number): void => {
      const node = diffScrollBodyRef.current
      if (node === null) {
        return
      }

      const distance = Math.max(Math.floor(node.clientHeight / 2), 160)
      node.scrollTop = Math.max(0, node.scrollTop + direction * distance)
      activateTargetNearViewportCenter()
      focusDiffRoot()
    },
    [activateTargetNearViewportCenter, focusDiffRoot]
  )

  const moveReviewTargetHunk = useCallback(
    (delta: number): void => {
      if (!activeResponse) {
        return
      }

      const hunks = activeResponse.fileDiff.hunks
      if (hunks.length === 0 || reviewTargets.length === 0) {
        return
      }

      const currentHunkIndex = activeReviewTarget?.hunkIndex ?? clampedHunkIndex

      const next =
        (((currentHunkIndex + delta) % hunks.length) + hunks.length) %
        hunks.length
      const targetIndex = targetIndexForHunk(next)

      if (targetIndex === -1) {
        deactivateReviewTarget()
        setFocusedHunkIndex(next)
        flashHunkSelection(hunks[next])
        focusDiffRoot()

        return
      }

      const target = reviewTargets[targetIndex]

      activateReviewTarget(targetIndex)
      if (!scrollHunkIntoView(next)) {
        scrollTargetIntoView(target, targetIndex, delta)
      }
      focusDiffRoot()
    },
    [
      activateReviewTarget,
      activeResponse,
      activeReviewTarget,
      clampedHunkIndex,
      deactivateReviewTarget,
      flashHunkSelection,
      focusDiffRoot,
      reviewTargets,
      scrollHunkIntoView,
      scrollTargetIntoView,
      targetIndexForHunk,
    ]
  )

  const openSelectedComment = useCallback((): void => {
    const selectedRange = visualSelectedLines

    if (
      selectedFilePath === null ||
      (selectedRange === null && reviewTarget === null)
    ) {
      notifyInfo('No diff line selected for comment.')

      return
    }

    let targetLineNumber: number
    let targetSide: AnnotationSide

    if (selectedRange === null) {
      if (reviewTarget === null) {
        notifyInfo('No diff line selected for comment.')

        return
      }

      targetLineNumber = reviewTarget.lineNumber
      targetSide = reviewTarget.side
      activateReviewTarget(reviewTargetIndex)
    } else {
      targetLineNumber = selectedRange.start
      targetSide = selectedRange.side ?? 'additions'
    }

    const nextTarget = commentTargetForLineOrRange(
      selectedFilePath,
      selectedFileStaged,
      targetLineNumber,
      targetSide,
      selectedRange
    )

    const isNewTarget =
      annotationTarget === null ||
      !isSameAnnotationTarget(annotationTarget, nextTarget)

    if (isNewTarget) {
      setCommentCategory(DEFAULT_REVIEW_COMMENT_CATEGORY)
    }

    setCommentDraftText((current) => (isNewTarget ? '' : current), false)
    setAnnotationTarget(nextTarget)
  }, [
    activateReviewTarget,
    annotationTarget,
    notifyInfo,
    reviewTarget,
    reviewTargetIndex,
    selectedFilePath,
    selectedFileStaged,
    setAnnotationTarget,
    setCommentCategory,
    setCommentDraftText,
    visualSelectedLines,
  ])

  const openFileCommentEditor = useCallback(
    (
      file: Pick<ChangedFile, 'path' | 'staged'>,
      anchor: HTMLElement | null = null
    ): void => {
      if (anchor === null) {
        setFileCommentAnchorPoint(null)
      } else {
        const rect = anchor.getBoundingClientRect()
        setFileCommentAnchorPoint({ left: rect.left, top: rect.bottom })
      }

      const nextTarget: AnnotationTarget = {
        scope: 'file',
        filePath: file.path,
        staged: file.staged,
      }

      const isNewTarget =
        annotationTarget === null ||
        !isSameAnnotationTarget(annotationTarget, nextTarget)

      if (isNewTarget) {
        setCommentCategory(DEFAULT_REVIEW_COMMENT_CATEGORY)
      }

      setCommentDraftText((current) => (isNewTarget ? '' : current), false)
      setAnnotationTarget(nextTarget)
    },
    [
      annotationTarget,
      setAnnotationTarget,
      setCommentCategory,
      setCommentDraftText,
    ]
  )

  const openSelectedFileComment = useCallback((): void => {
    if (selectedFileEntry === undefined) {
      notifyInfo('No file selected.')

      return
    }

    openFileCommentEditor(selectedFileEntry)
  }, [notifyInfo, openFileCommentEditor, selectedFileEntry])

  const handleAddFileComment = useCallback(
    (file: ChangedFile, anchor: HTMLElement): void => {
      selectDiffFile(file)

      if (!filesListPinnedOpen) {
        clearFilesListHideTimer()
        setFilesListRevealed(false)
      }

      openFileCommentEditor(file, anchor)
    },
    [
      clearFilesListHideTimer,
      filesListPinnedOpen,
      openFileCommentEditor,
      selectDiffFile,
    ]
  )

  // Opens the y/n guard for destructive or staging keyboard actions.
  const openKeyboardConfirm = useCallback(
    (action: KeyboardConfirmAction): void => {
      if (selectedFilePath === null) {
        notifyInfo('No file selected.')

        return
      }

      if (action !== 'discard-file' && focusedHunk === null) {
        notifyInfo('No hunk selected.')

        return
      }

      setKeyboardConfirm(action)
    },
    [focusedHunk, notifyInfo, selectedFilePath, setKeyboardConfirm]
  )

  const cancelKeyboardConfirm = useCallback((): void => {
    setKeyboardConfirm(null)
  }, [setKeyboardConfirm])

  const confirmKeyboardAction = useCallback((): void => {
    const action = keyboardConfirmAction
    setKeyboardConfirm(null)

    if (action === 'stage-hunk') {
      void (selectedFileStaged ? handleUnstage() : handleStage())
    } else if (action === 'discard-hunk') {
      void handleDiscard()
    } else if (action === 'discard-file') {
      void handleDiscardAll()
    }
  }, [
    handleDiscard,
    handleDiscardAll,
    handleStage,
    handleUnstage,
    keyboardConfirmAction,
    setKeyboardConfirm,
    selectedFileStaged,
  ])

  const removeFeedbackAnnotation = useCallback(
    (id: string, focusDiff = true): void => {
      if (focusDiff) {
        focusDiffRoot()
      }

      feedback.removeAnnotation(
        cwd,
        selectedFilePath ?? '',
        selectedFileStaged,
        id
      )
    },
    [cwd, feedback, focusDiffRoot, selectedFilePath, selectedFileStaged]
  )

  // Reopens the selected annotation in edit mode.
  const updateSelectedComment = useCallback((): void => {
    if (
      selectedFilePath === null ||
      reviewTarget === null ||
      reviewTargetComment === undefined ||
      !isPendingReviewAnnotation(reviewTargetComment)
    ) {
      notifyInfo('No comment selected.')

      return
    }

    activateReviewTarget(reviewTargetIndex)
    setAnnotationTarget({
      lineNumber: reviewTargetComment.lineNumber,
      side: reviewTargetComment.side,
      filePath: selectedFilePath,
      staged: selectedFileStaged,
      editId: reviewTargetComment.metadata.id,
    })
    setCommentDraftText(reviewTargetComment.metadata.text, false)
    setCommentCategory(reviewCommentCategory(reviewTargetComment.metadata))
  }, [
    activateReviewTarget,
    notifyInfo,
    reviewTarget,
    reviewTargetComment,
    reviewTargetIndex,
    selectedFilePath,
    selectedFileStaged,
    setAnnotationTarget,
    setCommentDraftText,
    setCommentCategory,
  ])

  const updateSelectedFileComment = useCallback((): void => {
    if (selectedFilePath === null || fileCommentsForSelectedFile.length === 0) {
      notifyInfo('No file comment selected.')

      return
    }

    const pendingFileComments = fileCommentsForSelectedFile.filter(
      isPendingReviewAnnotation
    )

    if (pendingFileComments.length === 0) {
      notifyInfo('No file comment selected.')

      return
    }

    const fileCommentToEdit =
      pendingFileComments[pendingFileComments.length - 1]

    setFileCommentAnchorPoint(null)
    setAnnotationTarget({
      scope: 'file',
      filePath: selectedFilePath,
      staged: selectedFileStaged,
      editId: fileCommentToEdit.metadata.id,
    })
    setCommentDraftText(fileCommentToEdit.metadata.text, false)
    setCommentCategory(reviewCommentCategory(fileCommentToEdit.metadata))
  }, [
    fileCommentsForSelectedFile,
    notifyInfo,
    selectedFilePath,
    selectedFileStaged,
    setAnnotationTarget,
    setCommentDraftText,
    setCommentCategory,
  ])

  // Deletes the annotation on the selected review target.
  const deleteSelectedComment = useCallback((): void => {
    if (
      selectedFilePath === null ||
      reviewTarget === null ||
      reviewTargetComment === undefined ||
      !isPendingReviewAnnotation(reviewTargetComment)
    ) {
      notifyInfo('No comment selected.')

      return
    }

    activateReviewTarget(reviewTargetIndex)
    removeFeedbackAnnotation(reviewTargetComment.metadata.id)
  }, [
    activateReviewTarget,
    notifyInfo,
    removeFeedbackAnnotation,
    reviewTarget,
    reviewTargetComment,
    reviewTargetIndex,
    selectedFilePath,
  ])

  const confirmCommentEditor = useCallback(
    (text: string, category: ReviewCommentCategory): void => {
      if (annotationTarget === null) {
        return
      }

      if (isFileAnnotationTarget(annotationTarget)) {
        if (annotationTarget.editId !== undefined) {
          feedback.updateAnnotation(
            cwd,
            annotationTarget.filePath,
            annotationTarget.staged,
            annotationTarget.editId,
            { text, category }
          )
          cancelVisualSelection(false)
          setFileCommentAnchorPoint(null)
          closeCommentEditor()

          return
        }

        const result = feedback.addAnnotation(
          cwd,
          annotationTarget.filePath,
          annotationTarget.staged,
          {
            side: 'additions',
            lineNumber: FILE_COMMENT_LINE_NUMBER,
            metadata: {
              id: nextFeedbackCommentId(),
              text,
              author: 'self',
              category,
              createdAt: Date.now(),
              target: { scope: 'file' },
            },
          }
        )

        if (result === 'cap-reached') {
          notifyInfo(
            'Feedback limit reached (50 comments). Finish or discard before adding more.'
          )
        } else {
          cancelVisualSelection(false)
          setFileCommentAnchorPoint(null)
          closeCommentEditor()
        }

        return
      }

      if (selectedFilePath === null) {
        closeCommentEditor()

        return
      }

      if (
        annotationTarget.filePath !== selectedFilePath ||
        annotationTarget.staged !== selectedFileStaged
      ) {
        closeCommentEditor()

        return
      }

      if (annotationTarget.editId !== undefined) {
        feedback.updateAnnotation(
          cwd,
          selectedFilePath,
          selectedFileStaged,
          annotationTarget.editId,
          { text, category }
        )
        cancelVisualSelection(false)
        closeCommentEditor()
      } else {
        const result = feedback.addAnnotation(
          cwd,
          selectedFilePath,
          selectedFileStaged,
          {
            side: annotationTarget.side,
            // Anchor a range comment at its last line so it renders below the
            // selection; the span stays in metadata.target (VIM-273).
            lineNumber:
              annotationTarget.rangeEndLine ?? annotationTarget.lineNumber,
            metadata: {
              id: nextFeedbackCommentId(),
              text,
              author: 'self',
              category,
              createdAt: Date.now(),
              ...(annotationTarget.rangeEndLine === undefined
                ? {}
                : {
                    target: {
                      scope: 'range' as const,
                      side: annotationTarget.side,
                      startLine: annotationTarget.lineNumber,
                      endLine: annotationTarget.rangeEndLine,
                    },
                  }),
            },
          }
        )
        if (result === 'cap-reached') {
          notifyInfo(
            'Feedback limit reached (50 comments). Finish or discard before adding more.'
          )
        } else {
          cancelVisualSelection(false)
          closeCommentEditor()
        }
      }
    },
    [
      annotationTarget,
      closeCommentEditor,
      cwd,
      feedback,
      notifyInfo,
      selectedFilePath,
      selectedFileStaged,
      cancelVisualSelection,
    ]
  )

  const cancelCommentEditor = useCallback((): void => {
    cancelVisualSelection(false)
    setFileCommentAnchorPoint(null)
    closeCommentEditor()
  }, [cancelVisualSelection, closeCommentEditor])

  useKeyboard({
    enabled: true,
    rootRef: diffRootRef,
    confirming: keyboardConfirmAction !== null,
    onMoveLine: moveVisualSelectionLine,
    onScrollPage: scrollDiffPage,
    onPreviousFile: (): void => goToFile(-1),
    onNextFile: (): void => goToFile(1),
    onToggleFilesList: toggleFilesList,
    onToggleFilesListPinned: toggleFilesListPinned,
    onRefreshDiff: (): void => {
      if (latestDiffStatus === 'ready') {
        acceptLatestDiff()
      }
    },
    searchOpen: diffSearch.isOpen,
    onOpenSearch: diffSearch.open,
    onCloseSearch: diffSearch.close,
    onNextMatch: (): void => diffSearch.step(1),
    onPreviousMatch: (): void => diffSearch.step(-1),
    onPreviousHunk: (): void => moveReviewTargetHunk(-1),
    onNextHunk: (): void => moveReviewTargetHunk(1),
    onComment: openSelectedComment,
    onFileComment: openSelectedFileComment,
    onUpdateComment: updateSelectedComment,
    onUpdateFileComment: updateSelectedFileComment,
    onDeleteComment: deleteSelectedComment,
    onFinishReview: (): void => {
      if (feedback.pendingAnnotations() > 0 && !review.open) {
        setSendNowCommentId(null)
        setFinishOpen(true)
      }
    },
    onRequestReview: (): void => {
      if (!finishOpen) {
        review.openPopover()
      }
    },
    onStageHunk: (): void => openKeyboardConfirm('stage-hunk'),
    onDiscardHunk: (): void => openKeyboardConfirm('discard-hunk'),
    onDiscardFile: (): void => openKeyboardConfirm('discard-file'),
    onToggleView: toggleDiffStyle,
    onMoveLineSide: moveVisualSelectionSide,
    visualMode,
    onStartVisualSelection: startVisualSelection,
    onYankSelection: yankVisualSelection,
    onCancelVisualSelection: cancelVisualSelection,
    onConfirm: confirmKeyboardAction,
    onCancelConfirm: cancelKeyboardConfirm,
  })

  const keyboardConfirm =
    keyboardConfirmAction !== null
      ? keyboardConfirmCopy(
          keyboardConfirmAction,
          selectedFilePath,
          selectedFileStaged
        )
      : null

  const handleBodyAddComment = useCallback(
    (lineNumber: number, side: AnnotationSide): void => {
      if (selectedFilePath === null) {
        return
      }

      deactivateReviewTarget()

      const selectedRange = visualSelectedLines

      const nextTarget = commentTargetForLineOrRange(
        selectedFilePath,
        selectedFileStaged,
        lineNumber,
        side,
        selectedRange
      )

      const isNewTarget =
        annotationTarget === null ||
        !isSameAnnotationTarget(annotationTarget, nextTarget)

      if (isNewTarget) {
        setCommentCategory(DEFAULT_REVIEW_COMMENT_CATEGORY)
      }

      setCommentDraftText((current) => (isNewTarget ? '' : current), false)
      setAnnotationTarget(nextTarget)
    },
    [
      annotationTarget,
      deactivateReviewTarget,
      selectedFilePath,
      selectedFileStaged,
      setCommentCategory,
      setCommentDraftText,
      setAnnotationTarget,
      visualSelectedLines,
    ]
  )

  const handleBodyEditComment = useCallback(
    (annotation: DiffLineAnnotation<ReviewComment>): void => {
      const rangeTarget =
        annotation.metadata.target?.scope === 'range' &&
        annotation.metadata.target.side === annotation.side
          ? annotation.metadata.target
          : null

      setAnnotationTarget({
        lineNumber: rangeTarget?.startLine ?? annotation.lineNumber,
        side: annotation.side,
        filePath: selectedFilePath ?? '',
        staged: selectedFileStaged,
        ...(rangeTarget === null ? {} : { rangeEndLine: rangeTarget.endLine }),
        editId: annotation.metadata.id,
      })
      setCommentDraftText(annotation.metadata.text, false)
      setCommentCategory(reviewCommentCategory(annotation.metadata))
    },
    [
      selectedFilePath,
      selectedFileStaged,
      setCommentDraftText,
      setCommentCategory,
      setAnnotationTarget,
    ]
  )

  const feedbackCount = feedback.pendingAnnotations()
  const feedbackDraftCount = commentDraftText.trim().length > 0 ? 1 : 0
  const pendingFeedbackCount = feedbackCount + feedbackDraftCount

  // Files with at least one pending comment — the "across N files" the Finish
  // popover would actually send (VIM-282). Dispatched-only files are excluded.
  const pendingFileCount = useMemo(
    (): number =>
      [...feedback.batch.values()].filter((list) =>
        list.some(isPendingReviewAnnotation)
      ).length,
    [feedback.batch]
  )

  const onFinishFeedback =
    feedbackCount > 0 && !review.open
      ? (): void => {
          review.closePopover()
          setSendNowCommentId(null)
          setFinishOpen(true)
        }
      : undefined

  const finishFeedback = {
    open: finishOpen || sendNowCommentId !== null,
    result: resolveCandidatePanes({
      allPanes: feedbackDispatch?.candidates ?? [],
      diffCwd: cwd,
    }),
    // Single-send (VIM-297) reuses the popover scoped to one comment.
    commentCount: sendNowCommentId !== null ? 1 : feedbackCount,
    fileCount: sendNowCommentId !== null ? 1 : pendingFileCount,
    onCancel: (): void => {
      setFinishOpen(false)
      setSendNowCommentId(null)
    },
    onSend: (pane: PaneCandidate): void =>
      handleSendFeedback(pane, sendNowCommentId ?? undefined),
    onCopy: (): void => handleCopyFeedback(sendNowCommentId ?? undefined),
  }

  // The "Request review" affordance (VIM-304) — always available when a file
  // diff is loaded, independent of pending comments (unlike Finish).
  const onRequestReview =
    review.canRequest && !finishOpen
      ? (): void => {
          setFinishOpen(false)
          review.openPopover()
        }
      : undefined

  const requestReview = {
    open: review.open,
    result: resolveCandidatePanes({
      allPanes: feedbackDispatch?.candidates ?? [],
      diffCwd: cwd,
    }),
    scopeLabel:
      selectedFilePath !== null
        ? `${selectedFilePath} (${selectedFileStaged ? 'staged' : 'unstaged'})`
        : 'this file',
    onSubmit: review.requestReview,
    onCopy: review.copyReviewRequest,
    onCancel: review.closePopover,
  }

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

  // Empty state (no changes): keep a DORMANT toolbar (only the settings
  // dropdowns stay live — nav arrows, tool-well + actions render disabled /
  // placeholder) above a calm "no changes" panel, so the chrome stays put when
  // a diff appears instead of collapsing + re-expanding.
  if (effectiveFiles.length === 0) {
    return (
      <div
        ref={diffRootRef}
        data-testid="diff-empty-state"
        tabIndex={-1}
        onPointerDown={handleDiffRootPointerDown}
        className="flex h-full w-full min-h-0 flex-col overflow-hidden text-on-surface-variant focus:outline-none"
      >
        <Notifier
          toolbarProps={{
            ...toolbarSettingsProps,
            diffMode: 'unstaged',
            currentFileIndex: -1,
            totalFiles: 0,
            feedbackCount: pendingFeedbackCount,
            onDiscardFeedback: feedback.clearPending,
            onFinishFeedback,
            onRequestReview,
          }}
          finishFeedback={finishFeedback}
          requestReview={requestReview}
          keyboardConfirm={null}
          onCancelKeyboardConfirm={cancelKeyboardConfirm}
          onConfirmKeyboardAction={confirmKeyboardAction}
        />
        <div
          data-testid="diff-empty-panel"
          className="flex min-h-0 flex-1 items-center justify-center p-8"
        >
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-success-muted/10 ring-1 ring-inset ring-success-muted/20">
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[2rem] leading-none text-success-muted"
              >
                check_circle
              </span>
            </div>
            <h2 className="font-display text-lg font-bold text-on-surface">
              No changes to review
            </h2>
            <p className="text-sm leading-relaxed">
              The working tree matches{' '}
              <code className="font-mono text-xs text-primary-dim bg-primary/10 px-1.5 py-0.5 rounded">
                HEAD
              </code>{' '}
              for this selection — nothing to diff or annotate.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Populated state: toolbar + full-width diff body. The changed-files list
  // floats over the body on demand instead of permanently consuming width.
  return (
    <div
      ref={diffRootRef}
      data-testid="diff-populated-state"
      tabIndex={-1}
      onPointerDown={handleDiffRootPointerDown}
      onFocus={handleDiffRootFocus}
      onBlurCapture={handleDiffRootBlur}
      className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus:outline-none"
    >
      <Notifier
        toolbarProps={{
          ...toolbarSettingsProps,
          diffMode: selectedFileStaged ? 'staged' : 'unstaged',
          totalHunks: hunkCount,
          focusedHunkIndex: clampedHunkIndex,
          onPrevHunk,
          onNextHunk,
          onPrevFile: (): void => goToFile(-1),
          onNextFile: (): void => goToFile(1),
          currentFileIndex,
          totalFiles: effectiveFiles.length,
          onStage: handleStage,
          onUnstage: handleUnstage,
          onDiscard: handleDiscard,
          onDiscardAll: handleDiscardAll,
          staging,
          selectedFileName: selectedFilePath ?? undefined,
          feedbackCount: pendingFeedbackCount,
          onDiscardFeedback: feedback.clearPending,
          onFinishFeedback,
          onRequestReview,
          onRefreshActiveFile:
            latestDiffStatus === 'ready' ? acceptLatestDiff : undefined,
        }}
        finishFeedback={finishFeedback}
        requestReview={requestReview}
        keyboardConfirm={keyboardConfirm}
        renderSyncError={renderSyncError}
        notifyMessage={notifyMessage}
        recoverableDraft={
          recoverableCommentDraftTarget === null
            ? null
            : {
                target: recoverableCommentDraftTarget,
                text: commentDraftText,
              }
        }
        onCancelKeyboardConfirm={cancelKeyboardConfirm}
        onConfirmKeyboardAction={confirmKeyboardAction}
      />
      <div
        data-testid="diff-body-region"
        className="relative flex min-h-0 flex-1 overflow-hidden"
      >
        <ChangedFilesListSurface
          files={effectiveFiles}
          selectedFile={
            effectiveSelectedFile !== null
              ? {
                  path: effectiveSelectedFile.path,
                  staged: effectiveSelectedFile.staged,
                }
              : null
          }
          pinned={filesListPinnedOpen}
          revealed={filesListRevealed}
          onReveal={revealFilesList}
          onToggle={toggleFilesList}
          onScheduleHide={scheduleHideFilesList}
          onTogglePinned={toggleFilesListPinned}
          onSelectFile={handleSelectDiffFileFromList}
          onAddFileComment={handleAddFileComment}
        />
        {diffSearchFileKey !== null ? (
          <>
            {!diffSearch.isOpen ? (
              <DiffSearchButton
                fileHeaderVisible={fileHeaderVisible}
                onOpen={diffSearch.open}
              />
            ) : null}
            <DiffSearchPopup
              open={diffSearch.isOpen}
              fileHeaderVisible={fileHeaderVisible}
              query={diffSearch.query}
              matchCount={diffSearch.matchCount}
              activeOrdinal={diffSearch.activeOrdinal}
              confirming={keyboardConfirmAction !== null}
              inputRef={diffSearch.inputRef}
              onQueryChange={diffSearch.setQuery}
              onCommit={diffSearch.commit}
              onStep={diffSearch.step}
              onClose={diffSearch.close}
            />
          </>
        ) : null}
        <div
          ref={setDiffPaneElement}
          data-testid="diff-right-pane"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div
            ref={setFileCommentAnchor}
            data-testid="file-comment-popover-anchor"
            className={
              fileCommentAnchorPoint === null
                ? 'h-0 w-0 shrink-0'
                : 'fixed h-0 w-0'
            }
            style={
              fileCommentAnchorPoint === null
                ? undefined
                : {
                    left: fileCommentAnchorPoint.left,
                    top: fileCommentAnchorPoint.top,
                  }
            }
          />
          <Popover
            anchor={fileCommentAnchor}
            open={fileCommentDraftIsVisible}
            onOpenChange={(open): void => {
              if (!open) {
                cancelCommentEditor()
              }
            }}
            placement="bottom-start"
            width={560}
            middleware={{ ancestorScroll: false }}
            aria-label={
              fileCommentDraftTarget === null
                ? 'Comment on file'
                : `Comment on file ${fileCommentDraftTarget.filePath}`
            }
          >
            <ReviewCommentEditor
              targetLabel={`file ${fileCommentDraftTarget?.filePath ?? ''}`}
              chrome="plain"
              surfaceRole="none"
              value={commentDraftText}
              category={commentCategory}
              onTextChange={(text): void => {
                setCommentDraftText(text, false)
              }}
              onCategoryChange={setCommentCategory}
              onConfirm={confirmCommentEditor}
              onCancel={cancelCommentEditor}
            />
          </Popover>
          {selectedFileEntry !== undefined &&
          fileCommentsForSelectedFile.length > 0 ? (
            <div
              data-testid="file-level-comments-panel"
              className="flex max-h-56 shrink-0 flex-col gap-1 px-4 pb-3 pt-2"
            >
              <div className="px-2 text-xs font-medium text-on-surface-variant">
                Commented on file
              </div>
              <div
                data-testid="file-level-comments-list"
                className="flex min-h-0 flex-col gap-1 overflow-y-auto pr-1"
              >
                {fileCommentsForSelectedFile.map((annotation) => (
                  <ReviewCommentRow
                    key={annotation.metadata.id}
                    comment={annotation.metadata}
                    editShortcut="Shift+U"
                    deleteShortcut={null}
                    onSendNow={(): void => {
                      setFinishOpen(false)
                      setSendNowCommentId(annotation.metadata.id)
                    }}
                    onEdit={(): void => {
                      setFileCommentAnchorPoint(null)
                      setAnnotationTarget({
                        scope: 'file',
                        filePath: selectedFileEntry.path,
                        staged: selectedFileEntry.staged,
                        editId: annotation.metadata.id,
                      })
                      setCommentDraftText(annotation.metadata.text, false)
                      setCommentCategory(
                        reviewCommentCategory(annotation.metadata)
                      )
                    }}
                    onDelete={(): void => {
                      focusDiffRoot()
                      feedback.removeAnnotation(
                        cwd,
                        selectedFileEntry.path,
                        selectedFileEntry.staged,
                        annotation.metadata.id
                      )
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <ReviewLevelNotes ownerKey={feedbackOwnerKey} />
          <PanelBody
            scrollBodyRef={diffScrollBodyRef}
            diffError={diffError}
            diffLoading={diffLoading}
            pierreInputs={pierreInputs}
            tooNarrow={tooNarrow}
            renderKey={panelRenderKey}
            options={diffOptionsWithSearch}
            selectedLines={selectedLines}
            lineAnnotations={lineAnnotations}
            annotationTarget={annotationTarget}
            commentDraftText={commentDraftText}
            commentCategory={commentCategory}
            onPointerDown={startMouseVisualSelection}
            onPointerMove={moveMouseVisualSelection}
            onPointerUp={stopMouseVisualSelection}
            onPointerLeave={stopMouseVisualSelection}
            onAddComment={handleBodyAddComment}
            onEditComment={handleBodyEditComment}
            onDeleteComment={removeFeedbackAnnotation}
            onSendComment={(id: string): void => {
              setFinishOpen(false)
              setSendNowCommentId(id)
            }}
            onCommentTextChange={(text): void => {
              setCommentDraftText(text, false)
            }}
            onCommentCategoryChange={setCommentCategory}
            onConfirmComment={confirmCommentEditor}
            onCancelComment={cancelCommentEditor}
          />
        </div>
      </div>
    </div>
  )
}
