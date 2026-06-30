import {
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
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
import { useTheme } from '../../../theme'
import { pierreThemeForKind } from '../pierreTheme'
import type { ChangedFile, FileDiff, SelectedDiffFile } from '../types'
import {
  useFeedbackBatch,
  parseBatchKey,
  DRAFT_ID,
  type ReviewComment,
  type UseFeedbackBatchReturn,
} from '../hooks/useFeedbackBatch'
import { ReviewCommentEditor } from './ReviewCommentEditor'
import { ReviewCommentRow } from './ReviewCommentRow'
import { FinishFeedbackPopover } from './FinishFeedbackPopover'
import { useDiffKeyboard } from '../hooks/useDiffKeyboard'
import { IconButton } from '@/components/IconButton'
import { Button } from '@/components/Button'
import { Popover } from '@/components/Popover'
import {
  dispatchFeedbackBatch,
  type DispatchEntry,
} from '../services/feedbackDispatch'
import {
  resolveCandidatePanes,
  type PaneCandidate,
  type FeedbackDispatchTarget,
} from '../services/activePanePicker'

// Pierre option subtypes — derived from `BaseDiffOptions` (rather than typed as
// the raw enum literals) so a Pierre version bump that widens or renames any
// of these surfaces as a type error rather than a silent string-typed
// regression.
type DiffStyle = NonNullable<BaseDiffOptions['diffStyle']>
type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>
type Overflow = NonNullable<BaseDiffOptions['overflow']>
type LineDiffType = NonNullable<BaseDiffOptions['lineDiffType']>

const DIFF_NATIVE_FOCUS_SELECTOR =
  'button, input, textarea, select, [contenteditable], [role="textbox"]'

const PIERRE_DIFF_CONTAINER_SELECTOR = 'diffs-container'
const STICKY_HEADER_SCROLL_GAP_PX = 4

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

export interface FeedbackRepoRootRef {
  current: string
  repoRootForCwd?: (cwd: string) => string
}

interface DiffPanelContentBaseProps {
  /** Working directory for git commands */
  cwd?: string
  /** Optional shared git status from a parent-level watcher subscription */
  gitStatus?: UseGitStatusReturn
  /** Optional shared feedback batch from the workspace shell. */
  feedbackBatch?: UseFeedbackBatchReturn
  /** Optional shared repo-root cache for feedback dispatch path resolution. */
  feedbackRepoRootRef?: FeedbackRepoRootRef
  /** Optional feedback dispatch target for inline review comments */
  feedbackDispatch?: FeedbackDispatchTarget
}

export type DiffPanelContentProps = DiffPanelContentBaseProps &
  DiffPanelSelectionControl

// Monotonic id source. A module counter keeps comment ids stable + unique
// without reaching for Date.now()/Math.random() in render.

let feedbackCommentSeq = 0

const nextFeedbackCommentId = (): string =>
  `feedback-comment-${(feedbackCommentSeq += 1)}`

interface AnnotationTarget {
  lineNumber: number
  side: AnnotationSide
  filePath: string
  staged: boolean
  editId?: string
}

interface KeyboardLineTarget {
  lineNumber: number
  side: AnnotationSide
  hunkIndex: number
  splitRowIndex: number
  changed: boolean
}

type KeyboardConfirmAction = 'stage-hunk' | 'discard-hunk' | 'discard-file'

const annotationTargetKey = (target: AnnotationTarget): string =>
  `${target.filePath}:${target.staged}:${target.side}:${target.lineNumber}:${
    target.editId ?? 'draft'
  }`

const diffContainsAnnotationTarget = (
  fileDiff: FileDiff,
  target: AnnotationTarget
): boolean => {
  for (const hunk of fileDiff.hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart

    for (const line of hunk.lines) {
      const oldLineNumber =
        line.oldLineNumber ?? (line.type === 'added' ? undefined : oldLine)

      const newLineNumber =
        line.newLineNumber ?? (line.type === 'removed' ? undefined : newLine)

      if (
        target.side === 'deletions' &&
        line.type !== 'added' &&
        oldLineNumber === target.lineNumber
      ) {
        return true
      }

      if (
        target.side === 'additions' &&
        line.type !== 'removed' &&
        newLineNumber === target.lineNumber
      ) {
        return true
      }

      if (line.type !== 'added') {
        oldLine += 1
      }

      if (line.type !== 'removed') {
        newLine += 1
      }
    }
  }

  return false
}

const keyboardLineTargetsForDiff = (
  fileDiff: FileDiff
): KeyboardLineTarget[] => {
  const targets: KeyboardLineTarget[] = []

  fileDiff.hunks.forEach((hunk, hunkIndex) => {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    let splitRowIndex = 0
    let pendingDeletions: KeyboardLineTarget[] = []
    let pendingAdditions: KeyboardLineTarget[] = []

    const flushChangedRows = (): void => {
      const rowCount = Math.max(
        pendingDeletions.length,
        pendingAdditions.length
      )

      for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
        const rowIndex = splitRowIndex + rowOffset
        if (rowOffset < pendingDeletions.length) {
          const deletion = pendingDeletions[rowOffset]
          targets.push({ ...deletion, splitRowIndex: rowIndex })
        }

        if (rowOffset < pendingAdditions.length) {
          const addition = pendingAdditions[rowOffset]
          targets.push({ ...addition, splitRowIndex: rowIndex })
        }
      }

      splitRowIndex += rowCount
      pendingDeletions = []
      pendingAdditions = []
    }

    if (hunk.lines.length === 0) {
      targets.push({
        lineNumber: hunk.newLines === 0 ? hunk.oldStart : hunk.newStart,
        side: hunk.newLines === 0 ? 'deletions' : 'additions',
        hunkIndex,
        splitRowIndex,
        changed: true,
      })

      return
    }

    for (const line of hunk.lines) {
      const oldLineNumber =
        line.oldLineNumber ?? (line.type === 'added' ? undefined : oldLine)

      const newLineNumber =
        line.newLineNumber ?? (line.type === 'removed' ? undefined : newLine)

      if (line.type === 'removed') {
        if (oldLineNumber !== undefined) {
          pendingDeletions.push({
            lineNumber: oldLineNumber,
            side: 'deletions',
            hunkIndex,
            splitRowIndex,
            changed: true,
          })
        }
      } else if (line.type === 'added') {
        if (newLineNumber !== undefined) {
          pendingAdditions.push({
            lineNumber: newLineNumber,
            side: 'additions',
            hunkIndex,
            splitRowIndex,
            changed: true,
          })
        }
      } else {
        flushChangedRows()

        if (newLineNumber !== undefined) {
          targets.push({
            lineNumber: newLineNumber,
            side: 'additions',
            hunkIndex,
            splitRowIndex,
            changed: false,
          })
        }

        splitRowIndex += 1
      }

      if (line.type !== 'added') {
        oldLine += 1
      }

      if (line.type !== 'removed') {
        newLine += 1
      }
    }

    flushChangedRows()
  })

  return targets
}

const sameKeyboardRow = (
  left: KeyboardLineTarget,
  right: KeyboardLineTarget
): boolean =>
  left.hunkIndex === right.hunkIndex &&
  left.splitRowIndex === right.splitRowIndex

const keyboardRowIndexForTarget = (
  targets: KeyboardLineTarget[],
  targetIndex: number
): number => {
  let rowIndex = 0

  for (let index = 1; index <= targetIndex; index += 1) {
    if (!sameKeyboardRow(targets[index - 1], targets[index])) {
      rowIndex += 1
    }
  }

  return rowIndex
}

const keyboardRowCountForTargets = (targets: KeyboardLineTarget[]): number =>
  targets.length === 0
    ? 0
    : keyboardRowIndexForTarget(targets, targets.length - 1) + 1

// Matches Pierre's rendered rows/gutters for the current keyboard target.
const lineSelectorForKeyboardTarget = (target: KeyboardLineTarget): string => {
  const lineNumber = target.lineNumber

  if (target.side === 'deletions') {
    return (
      `[data-line-type="change-deletion"][data-line="${lineNumber}"], ` +
      `[data-line-type="change-deletion"][data-column-number="${lineNumber}"], ` +
      `[data-line-type="removed"][data-line="${lineNumber}"], ` +
      `[data-line-type="removed"][data-column-number="${lineNumber}"]`
    )
  }

  return (
    `[data-line-type="change-addition"][data-line="${lineNumber}"], ` +
    `[data-line-type="change-addition"][data-column-number="${lineNumber}"], ` +
    `[data-line-type="context"][data-line="${lineNumber}"], ` +
    `[data-line-type="context"][data-column-number="${lineNumber}"], ` +
    `[data-line-type="added"][data-line="${lineNumber}"], ` +
    `[data-line-type="added"][data-column-number="${lineNumber}"]`
  )
}

const fallbackLineSelectorForKeyboardTarget = (
  target: KeyboardLineTarget
): string => {
  const lineNumber = target.lineNumber

  return `[data-line="${lineNumber}"], [data-column-number="${lineNumber}"]`
}

const scopedDiffRootForKeyboardTarget = (
  shadowRoot: ShadowRoot,
  target: KeyboardLineTarget
): ParentNode => {
  const sideRoot = shadowRoot.querySelector<HTMLElement>(
    target.side === 'deletions' ? '[data-deletions]' : '[data-additions]'
  )

  return (
    sideRoot ??
    shadowRoot.querySelector<HTMLElement>('[data-unified]') ??
    shadowRoot
  )
}

const findKeyboardTargetLineElement = (
  root: HTMLElement,
  target: KeyboardLineTarget
): HTMLElement | null => {
  const selector = lineSelectorForKeyboardTarget(target)
  const fallbackSelector = fallbackLineSelectorForKeyboardTarget(target)

  const localLine =
    root.querySelector<HTMLElement>(selector) ??
    root.querySelector<HTMLElement>(fallbackSelector)

  if (localLine !== null) {
    return localLine
  }

  for (const container of root.querySelectorAll<HTMLElement>(
    PIERRE_DIFF_CONTAINER_SELECTOR
  )) {
    const shadowRoot = container.shadowRoot
    if (shadowRoot === null) {
      continue
    }

    const scopedRoot = scopedDiffRootForKeyboardTarget(shadowRoot, target)

    const line =
      scopedRoot.querySelector<HTMLElement>(selector) ??
      scopedRoot.querySelector<HTMLElement>(fallbackSelector)

    if (line !== null) {
      return line
    }
  }

  return null
}

const lineRangeFitsContainer = (
  container: HTMLElement,
  firstLine: HTMLElement,
  lastLine: HTMLElement
): boolean => {
  if (container.clientHeight <= 0) {
    return true
  }

  const firstRect = firstLine.getBoundingClientRect()
  const lastRect = lastLine.getBoundingClientRect()
  const top = Math.min(firstRect.top, lastRect.top)
  const bottom = Math.max(firstRect.bottom, lastRect.bottom)

  return bottom - top <= container.clientHeight
}

const stickyHeaderOffsetForDiffRoot = (root: HTMLElement): number => {
  const headers = [
    ...root.querySelectorAll<HTMLElement>('[data-diffs-header][data-sticky]'),
  ]

  for (const container of root.querySelectorAll<HTMLElement>(
    PIERRE_DIFF_CONTAINER_SELECTOR
  )) {
    if (container.shadowRoot !== null) {
      headers.push(
        ...container.shadowRoot.querySelectorAll<HTMLElement>(
          '[data-diffs-header][data-sticky]'
        )
      )
    }
  }

  const height = Math.max(
    0,
    ...headers.map((header) => header.getBoundingClientRect().height)
  )

  return height === 0 ? 0 : height + STICKY_HEADER_SCROLL_GAP_PX
}

const revealLineBelowStickyHeader = (
  container: HTMLElement,
  line: HTMLElement,
  reservePreviousRow: boolean
): void => {
  const stickyOffset = stickyHeaderOffsetForDiffRoot(container)
  if (stickyOffset === 0) {
    return
  }

  const containerTop = container.getBoundingClientRect().top
  const lineRect = line.getBoundingClientRect()
  const rowOffset = reservePreviousRow ? lineRect.height : 0
  const overlap = containerTop + stickyOffset + rowOffset - lineRect.top

  if (overlap > 0) {
    container.scrollTop = Math.max(0, container.scrollTop - Math.ceil(overlap))
  }
}

const scrollLineElementIntoView = (
  container: HTMLElement,
  line: HTMLElement,
  targetIndex: number,
  targetCount: number,
  delta: number
): void => {
  if (delta === 0) {
    line.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    revealLineBelowStickyHeader(container, line, false)

    return
  }

  if (targetCount === 1) {
    line.scrollIntoView({
      block: delta > 0 ? 'end' : 'start',
      inline: 'nearest',
    })
    revealLineBelowStickyHeader(container, line, delta < 0)

    return
  }

  if (targetIndex === 0) {
    line.scrollIntoView({ block: 'start', inline: 'nearest' })
    revealLineBelowStickyHeader(container, line, delta < 0)

    return
  }

  if (targetIndex === targetCount - 1) {
    line.scrollIntoView({ block: 'end', inline: 'nearest' })
    revealLineBelowStickyHeader(container, line, false)

    return
  }

  line.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  revealLineBelowStickyHeader(container, line, delta < 0)
}

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
  feedbackBatch = undefined,
  feedbackRepoRootRef = undefined,
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

  // Reset selection when cwd actually changes (belt-and-suspenders, render
  // guard is primary). Do not fire on initial mount: WorkspaceView owns this
  // value across dock close/reopen, and clearing it on mount loses the user's
  // previously selected changed file before auto-select falls back to row 1.
  const previousSelectionCwdRef = useRef(cwd)
  useEffect(() => {
    if (previousSelectionCwdRef.current === cwd) {
      return
    }

    previousSelectionCwdRef.current = cwd
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

  const responseMatchesSelection =
    response !== null &&
    selectedFilePath !== null &&
    response.fileDiff.filePath === selectedFilePath

  const activeResponse =
    !diffLoading && responseMatchesSelection ? response : null

  // Notification hook — reused for the "Pierre split differently" and
  // "could not isolate hunk" informational messages.
  const { message: notifyMessage, notifyInfo } = useNotifyInfo()
  const diffRootRef = useRef<HTMLDivElement>(null)
  const diffScrollBodyRef = useRef<HTMLDivElement>(null)

  // Stable focus owner for handoffs before focused diff/comment nodes unmount.
  const focusDiffRoot = useCallback((): void => {
    diffRootRef.current?.focus({ preventScroll: true })
  }, [])

  const handleDiffRootPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (
        event.target instanceof Element &&
        event.target.closest(DIFF_NATIVE_FOCUS_SELECTOR) === null
      ) {
        focusDiffRoot()
      }
    },
    [focusDiffRoot]
  )

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

  // Comment editor target state: which line currently has an open comment editor.
  // `editId` set => editing an existing comment in place; absent => a new
  // draft on that line.
  const [annotationTarget, setAnnotationTargetState] =
    useState<AnnotationTarget | null>(null)
  const [commentDraftText, setCommentDraftTextState] = useState('')

  // Finish feedback popover open state.
  const [finishOpen, setFinishOpen] = useState(false)

  const [keyboardConfirmAction, setKeyboardConfirmAction] =
    useState<KeyboardConfirmAction | null>(null)

  const setAnnotationTarget = useCallback(
    (next: SetStateAction<AnnotationTarget | null>, focusDiff = true): void => {
      if (focusDiff) {
        focusDiffRoot()
      }

      setAnnotationTargetState(next)
    },
    [focusDiffRoot]
  )

  const setCommentDraftText = useCallback(
    (next: SetStateAction<string>, focusDiff = true): void => {
      if (focusDiff) {
        focusDiffRoot()
      }

      setCommentDraftTextState(next)
    },
    [focusDiffRoot]
  )

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

  // Real annotations for the currently selected file.
  const realAnnotations = feedback.annotationsForFile(
    cwd,
    selectedFilePath ?? '',
    selectedFileStaged
  )

  const annotationTargetIsCurrentFile =
    annotationTarget !== null &&
    annotationTarget.filePath === selectedFilePath &&
    annotationTarget.staged === selectedFileStaged

  const annotationTargetLineExists = useMemo((): boolean => {
    if (
      annotationTarget === null ||
      !annotationTargetIsCurrentFile ||
      activeResponse === null
    ) {
      return false
    }

    return diffContainsAnnotationTarget(
      activeResponse.fileDiff,
      annotationTarget
    )
  }, [activeResponse, annotationTarget, annotationTargetIsCurrentFile])

  const commentDraftIsRecoverable =
    annotationTarget !== null &&
    commentDraftText.trim().length > 0 &&
    activeResponse !== null &&
    (!annotationTargetIsCurrentFile || !annotationTargetLineExists)

  // Merge a transient draft annotation in only while composing a NEW comment,
  // so the comment editor renders inline below the target line. Editing reuses the
  // existing annotation's slot, so no draft is added there. When idle we pass
  // `realAnnotations` straight through to keep its identity stable (avoids
  // Pierre re-tokenizing on every render).
  const lineAnnotations = useMemo((): DiffLineAnnotation<ReviewComment>[] => {
    if (
      annotationTarget !== null &&
      annotationTarget.editId === undefined &&
      annotationTargetIsCurrentFile &&
      (activeResponse === null || annotationTargetLineExists)
    ) {
      const draft: DiffLineAnnotation<ReviewComment> = {
        side: annotationTarget.side,
        lineNumber: annotationTarget.lineNumber,
        metadata: { id: DRAFT_ID, text: '', author: 'self', createdAt: 0 },
      }

      return [...realAnnotations, draft]
    }

    return realAnnotations
  }, [
    realAnnotations,
    annotationTarget,
    annotationTargetIsCurrentFile,
    annotationTargetLineExists,
    activeResponse,
  ])

  const closeCommentEditor = useCallback(
    (focusDiff = true): void => {
      setAnnotationTarget(null, focusDiff)
      setCommentDraftText('', false)
    },
    [setCommentDraftText, setAnnotationTarget]
  )

  const confirmCommentEditor = useCallback(
    (text: string): void => {
      if (annotationTarget === null) {
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
          { text }
        )
        closeCommentEditor()
      } else {
        const result = feedback.addAnnotation(
          cwd,
          selectedFilePath,
          selectedFileStaged,
          {
            side: annotationTarget.side,
            lineNumber: annotationTarget.lineNumber,
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
          closeCommentEditor()
        }
      }
    },
    [
      closeCommentEditor,
      annotationTarget,
      selectedFilePath,
      selectedFileStaged,
      feedback,
      cwd,
      notifyInfo,
    ]
  )

  const sendingFeedbackRef = useRef(false)

  const handleSendFeedback = useCallback(
    (pane: PaneCandidate): void => {
      if (sendingFeedbackRef.current) {
        return
      }
      sendingFeedbackRef.current = true
      void (async (): Promise<void> => {
        // git reports file paths relative to the repo TOPLEVEL, but the target
        // agent runs in the pane's cwd (possibly a repo subdirectory). Join the
        // toplevel (`response.repoRoot`) so the dispatched reference is an
        // absolute path the agent can resolve regardless of its cwd. All batch
        // entries share one repo (the batch is cleared on cwd change), so the
        // current diff's repoRoot applies to every file. Falls back to the
        // repo-relative path if the root is unavailable (not in a git repo).
        // Prefer the current diff's root; fall back to the last-known root when
        // `response` is transiently null (file-switch loading/error) so an
        // in-flight batch keeps absolute paths. The empty-string (non-repo)
        // case needs no fallback — the ref is empty there too — so `??` (null/
        // undefined only) is exactly right.
        const repoRoot = response?.repoRoot ?? repoRootRef.current
        const entries: DispatchEntry[] = []
        // parseBatchKey is the single source of truth for the key format (it
        // lives next to makeBatchKey in useFeedbackBatch). The staged flag rides
        // into the payload so an `MM` file (staged + unstaged both commented)
        // stays disambiguated.
        for (const [key, annotations] of feedback.batch) {
          const {
            cwd: entryCwd,
            filePath: relPath,
            staged,
          } = parseBatchKey(key)

          const entryRepoRoot =
            'repoRootForCwd' in repoRootRef
              ? repoRootRef.repoRootForCwd?.(entryCwd)
              : undefined

          const resolvedRepoRoot =
            entryRepoRoot && entryRepoRoot.length > 0 ? entryRepoRoot : repoRoot

          const filePath = resolvedRepoRoot
            ? `${resolvedRepoRoot}/${relPath}`
            : relPath
          entries.push({ filePath, staged, annotations })
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
    [feedback, feedbackDispatch, notifyInfo, repoRootRef, response]
  )

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

  // Clear the comment editor on file changes so a draft opened on one file is
  // not accidentally submitted against another.
  useEffect(() => {
    setAnnotationTarget(null, false)
    setCommentDraftText('', false)
  }, [
    selectedFilePath,
    selectedFileStaged,
    setCommentDraftText,
    setAnnotationTarget,
  ])

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

  const keyboardLineTargets = useMemo(
    (): KeyboardLineTarget[] =>
      activeResponse === null
        ? []
        : keyboardLineTargetsForDiff(activeResponse.fileDiff),
    [activeResponse]
  )

  const [keyboardLineIndex, setKeyboardLineIndex] = useState(0)
  const [keyboardLineActive, setKeyboardLineActive] = useState(false)

  useEffect(() => {
    setKeyboardLineIndex(0)
    setKeyboardLineActive(false)
  }, [selectedFilePath, selectedFileStaged])

  useEffect(() => {
    if (keyboardLineTargets.length === 0) {
      setKeyboardLineIndex(0)
      setKeyboardLineActive(false)

      return
    }

    setKeyboardLineIndex((prev) =>
      Math.min(prev, keyboardLineTargets.length - 1)
    )
  }, [keyboardLineTargets.length])

  const keyboardLineTarget: KeyboardLineTarget | null =
    keyboardLineTargets.length > 0
      ? keyboardLineTargets[
          Math.min(keyboardLineIndex, keyboardLineTargets.length - 1)
        ]
      : null

  const keyboardSelectedLines: SelectedLineRange | null =
    keyboardLineActive && keyboardLineTarget !== null
      ? {
          start: keyboardLineTarget.lineNumber,
          end: keyboardLineTarget.lineNumber,
          side: keyboardLineTarget.side,
        }
      : null

  const keyboardLineComment = useMemo(():
    | DiffLineAnnotation<ReviewComment>
    | undefined => {
    if (keyboardLineTarget === null) {
      return undefined
    }

    return realAnnotations.find(
      (annotation) =>
        annotation.lineNumber === keyboardLineTarget.lineNumber &&
        annotation.side === keyboardLineTarget.side
    )
  }, [keyboardLineTarget, realAnnotations])

  const onPrevHunk = useCallback((): void => {
    if (!activeResponse) {
      return
    }

    const hunks = activeResponse.fileDiff.hunks
    if (hunks.length === 0) {
      return
    }

    const next = (clampedHunkIndex + hunks.length - 1) % hunks.length
    setKeyboardLineActive(false)
    setFocusedHunkIndex(next)
    flashHunkSelection(hunks[next])
  }, [activeResponse, clampedHunkIndex, flashHunkSelection])

  const onNextHunk = useCallback((): void => {
    if (!activeResponse) {
      return
    }

    const hunks = activeResponse.fileDiff.hunks
    if (hunks.length === 0) {
      return
    }

    const next = (clampedHunkIndex + 1) % hunks.length
    setKeyboardLineActive(false)
    setFocusedHunkIndex(next)
    flashHunkSelection(hunks[next])
  }, [activeResponse, clampedHunkIndex, flashHunkSelection])

  const selectedLines: SelectedLineRange | null =
    keyboardSelectedLines ?? navSelection

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

  // Pierre option state — every option here is a controlled-component value
  // surfaced upward from DiffChipToolbar. Most values drive <MultiFileDiff>
  // on the next render. `theme` and `lineDiffType` are special: the worker
  // pool owns them (see the render-options sync effect below), so they flow
  // through `syncedRenderOptions` and the diff remount waits for the pool to
  // accept the new value first.
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')

  const workspaceTheme = useTheme()

  const [theme, setTheme] = useState<DiffsThemeNames>(() =>
    pierreThemeForKind(workspaceTheme.kind)
  )

  // Workspace theme switch resets the diff theme to the mapped default,
  // overriding any session-level dropdown choice (spec §5).
  useEffect(() => {
    setTheme(pierreThemeForKind(workspaceTheme.kind))
  }, [workspaceTheme.kind])

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

  const selectDiffFile = useCallback(
    (file: Pick<ChangedFile, 'path' | 'staged'>, focusDiff = true): void => {
      if (focusDiff) {
        focusDiffRoot()
      }

      commitSelection({ path: file.path, staged: file.staged, cwd })
    },
    [commitSelection, cwd, focusDiffRoot]
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

  // Toolbar shell ref for anchoring the FinishFeedbackPopover.
  const toolbarShellRef = useRef<HTMLDivElement>(null)

  const scrollDiffPage = useCallback(
    (direction: number): void => {
      const node = diffScrollBodyRef.current
      if (node === null) {
        return
      }

      const distance = Math.max(Math.floor(node.clientHeight / 2), 160)
      node.scrollTop = Math.max(0, node.scrollTop + direction * distance)
      focusDiffRoot()
    },
    [focusDiffRoot]
  )

  // Keeps j/k line navigation visible without changing the selected target.
  const scrollKeyboardTargetIntoView = useCallback(
    (target: KeyboardLineTarget, targetIndex: number, delta: number): void => {
      const node = diffScrollBodyRef.current
      if (node === null) {
        return
      }

      const line = findKeyboardTargetLineElement(node, target)
      if (line === null) {
        return
      }

      scrollLineElementIntoView(
        node,
        line,
        effectiveDiffStyle === 'split'
          ? keyboardRowIndexForTarget(keyboardLineTargets, targetIndex)
          : targetIndex,
        effectiveDiffStyle === 'split'
          ? keyboardRowCountForTargets(keyboardLineTargets)
          : keyboardLineTargets.length,
        delta
      )
    },
    [effectiveDiffStyle, keyboardLineTargets]
  )

  // Hunk jumps reveal the hunk top, then include the end only when it fits.
  const scrollHunkIntoView = useCallback(
    (hunkIndex: number): boolean => {
      const node = diffScrollBodyRef.current
      if (node === null) {
        return false
      }

      const hunkTargets = keyboardLineTargets.filter(
        (target) => target.hunkIndex === hunkIndex
      )
      if (hunkTargets.length === 0) {
        return false
      }

      const firstTarget = hunkTargets[0]
      const lastTarget = hunkTargets[hunkTargets.length - 1]
      const firstLine = findKeyboardTargetLineElement(node, firstTarget)
      const lastLine = findKeyboardTargetLineElement(node, lastTarget)
      if (firstLine === null || lastLine === null) {
        return false
      }

      firstLine.scrollIntoView({ block: 'start', inline: 'nearest' })

      if (
        firstLine === lastLine ||
        !lineRangeFitsContainer(node, firstLine, lastLine)
      ) {
        return true
      }

      lastLine.scrollIntoView({ block: 'nearest', inline: 'nearest' })

      return true
    },
    [keyboardLineTargets]
  )

  // Moves the keyboard comment target one rendered diff line at a time.
  const moveKeyboardLine = useCallback(
    (delta: number): void => {
      if (keyboardLineTargets.length === 0) {
        return
      }

      clearNavSelectionTimer()
      setNavSelection(null)
      setKeyboardLineActive(true)
      setKeyboardLineIndex((prev) => {
        const currentIndex = Math.min(prev, keyboardLineTargets.length - 1)
        const currentTarget = keyboardLineTargets[currentIndex]
        let rowTargetIndex = currentIndex + delta

        if (
          rowTargetIndex < 0 ||
          rowTargetIndex >= keyboardLineTargets.length
        ) {
          return currentIndex
        }

        if (effectiveDiffStyle === 'split') {
          rowTargetIndex = currentIndex

          while (
            rowTargetIndex + delta >= 0 &&
            rowTargetIndex + delta < keyboardLineTargets.length
          ) {
            rowTargetIndex += delta

            const rowTarget = keyboardLineTargets[rowTargetIndex]
            if (
              rowTarget.hunkIndex !== currentTarget.hunkIndex ||
              rowTarget.splitRowIndex !== currentTarget.splitRowIndex
            ) {
              break
            }
          }
        }

        const rowTarget = keyboardLineTargets[rowTargetIndex]

        const sameSideIndex = keyboardLineTargets.findIndex(
          (target) =>
            target.hunkIndex === rowTarget.hunkIndex &&
            target.splitRowIndex === rowTarget.splitRowIndex &&
            target.side === currentTarget.side
        )

        const next =
          effectiveDiffStyle === 'split' && sameSideIndex !== -1
            ? sameSideIndex
            : rowTargetIndex
        if (next === currentIndex) {
          return currentIndex
        }

        const nextTarget = keyboardLineTargets[next]
        setFocusedHunkIndex(nextTarget.hunkIndex)
        scrollKeyboardTargetIntoView(nextTarget, next, delta)

        return next
      })
      focusDiffRoot()
    },
    [
      clearNavSelectionTimer,
      effectiveDiffStyle,
      focusDiffRoot,
      keyboardLineTargets,
      scrollKeyboardTargetIntoView,
    ]
  )

  // Moves the keyboard comment target to the first changed line in another hunk.
  const moveKeyboardHunk = useCallback(
    (delta: number): void => {
      if (!activeResponse) {
        return
      }

      const hunks = activeResponse.fileDiff.hunks
      if (hunks.length === 0 || keyboardLineTargets.length === 0) {
        return
      }

      const next =
        (((clampedHunkIndex + delta) % hunks.length) + hunks.length) %
        hunks.length

      const changedTargetIndex = keyboardLineTargets.findIndex(
        (target) => target.hunkIndex === next && target.changed
      )

      const targetIndex =
        changedTargetIndex === -1
          ? keyboardLineTargets.findIndex((target) => target.hunkIndex === next)
          : changedTargetIndex

      if (targetIndex === -1) {
        setKeyboardLineActive(false)
        setFocusedHunkIndex(next)
        flashHunkSelection(hunks[next])
        focusDiffRoot()

        return
      }

      const target = keyboardLineTargets[targetIndex]

      clearNavSelectionTimer()
      setNavSelection(null)
      setKeyboardLineActive(true)
      setKeyboardLineIndex(targetIndex)
      setFocusedHunkIndex(next)
      if (!scrollHunkIntoView(next)) {
        scrollKeyboardTargetIntoView(target, targetIndex, delta)
      }
      focusDiffRoot()
    },
    [
      activeResponse,
      clampedHunkIndex,
      clearNavSelectionTimer,
      flashHunkSelection,
      focusDiffRoot,
      keyboardLineTargets,
      scrollHunkIntoView,
      scrollKeyboardTargetIntoView,
    ]
  )

  // Starts a new inline annotation from the current keyboard-selected line.
  const openKeyboardComment = useCallback((): void => {
    if (selectedFilePath === null || keyboardLineTarget === null) {
      notifyInfo('No diff line selected for comment.')

      return
    }

    const nextTarget: AnnotationTarget = {
      lineNumber: keyboardLineTarget.lineNumber,
      side: keyboardLineTarget.side,
      filePath: selectedFilePath,
      staged: selectedFileStaged,
    }

    clearNavSelectionTimer()
    setNavSelection(null)
    setKeyboardLineActive(true)
    setFocusedHunkIndex(keyboardLineTarget.hunkIndex)
    setCommentDraftText((current) => {
      if (annotationTarget === null) {
        return ''
      }

      const sameTarget =
        annotationTargetKey(annotationTarget) ===
        annotationTargetKey(nextTarget)

      return sameTarget ? current : ''
    }, false)
    setAnnotationTarget(nextTarget)
  }, [
    clearNavSelectionTimer,
    annotationTarget,
    keyboardLineTarget,
    notifyInfo,
    selectedFilePath,
    selectedFileStaged,
    setCommentDraftText,
    setAnnotationTarget,
  ])

  const toggleDiffStyle = useCallback((): void => {
    handleDiffStyleChange(diffStyle === 'split' ? 'unified' : 'split')
  }, [diffStyle, handleDiffStyleChange])

  const moveKeyboardLineSide = useCallback(
    (side: AnnotationSide): void => {
      if (effectiveDiffStyle !== 'split' || keyboardLineTarget === null) {
        return
      }

      const nextIndex = keyboardLineTargets.findIndex(
        (target) =>
          target.hunkIndex === keyboardLineTarget.hunkIndex &&
          target.splitRowIndex === keyboardLineTarget.splitRowIndex &&
          target.side === side
      )

      if (nextIndex === -1 || nextIndex === keyboardLineIndex) {
        return
      }

      const nextTarget = keyboardLineTargets[nextIndex]
      clearNavSelectionTimer()
      setNavSelection(null)
      setKeyboardLineActive(true)
      setKeyboardLineIndex(nextIndex)
      setFocusedHunkIndex(nextTarget.hunkIndex)
      scrollKeyboardTargetIntoView(nextTarget, nextIndex, 0)
      focusDiffRoot()
    },
    [
      clearNavSelectionTimer,
      effectiveDiffStyle,
      focusDiffRoot,
      keyboardLineIndex,
      keyboardLineTarget,
      keyboardLineTargets,
      scrollKeyboardTargetIntoView,
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
  const updateKeyboardComment = useCallback((): void => {
    if (
      selectedFilePath === null ||
      keyboardLineTarget === null ||
      keyboardLineComment === undefined
    ) {
      notifyInfo('No comment selected.')

      return
    }

    clearNavSelectionTimer()
    setNavSelection(null)
    setKeyboardLineActive(true)
    setFocusedHunkIndex(keyboardLineTarget.hunkIndex)
    setAnnotationTarget({
      lineNumber: keyboardLineComment.lineNumber,
      side: keyboardLineComment.side,
      filePath: selectedFilePath,
      staged: selectedFileStaged,
      editId: keyboardLineComment.metadata.id,
    })
    setCommentDraftText(keyboardLineComment.metadata.text, false)
  }, [
    clearNavSelectionTimer,
    keyboardLineComment,
    keyboardLineTarget,
    notifyInfo,
    selectedFilePath,
    selectedFileStaged,
    setCommentDraftText,
    setAnnotationTarget,
  ])

  // Deletes the annotation on the current keyboard-selected line.
  const deleteKeyboardComment = useCallback((): void => {
    if (
      selectedFilePath === null ||
      keyboardLineTarget === null ||
      keyboardLineComment === undefined
    ) {
      notifyInfo('No comment selected.')

      return
    }

    clearNavSelectionTimer()
    setNavSelection(null)
    setKeyboardLineActive(true)
    setFocusedHunkIndex(keyboardLineTarget.hunkIndex)
    removeFeedbackAnnotation(keyboardLineComment.metadata.id)
  }, [
    clearNavSelectionTimer,
    keyboardLineComment,
    keyboardLineTarget,
    notifyInfo,
    removeFeedbackAnnotation,
    selectedFilePath,
  ])

  useDiffKeyboard({
    enabled: true,
    rootRef: diffRootRef,
    confirming: keyboardConfirmAction !== null,
    onMoveLine: moveKeyboardLine,
    onScrollPage: scrollDiffPage,
    onPreviousFile: (): void => goToFile(-1),
    onNextFile: (): void => goToFile(1),
    onPreviousHunk: (): void => moveKeyboardHunk(-1),
    onNextHunk: (): void => moveKeyboardHunk(1),
    onComment: openKeyboardComment,
    onUpdateComment: updateKeyboardComment,
    onDeleteComment: deleteKeyboardComment,
    onFinishReview: (): void => {
      if (feedback.totalAnnotations() > 0) {
        setFinishOpen(true)
      }
    },
    onStageHunk: (): void => openKeyboardConfirm('stage-hunk'),
    onDiscardHunk: (): void => openKeyboardConfirm('discard-hunk'),
    onDiscardFile: (): void => openKeyboardConfirm('discard-file'),
    onToggleView: toggleDiffStyle,
    onMoveLineSide: moveKeyboardLineSide,
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

  // Toolbar prop bundle shared by the populated state AND the dormant empty
  // state below. The settings dropdowns stay live in both; the file / hunk /
  // staging / feedback props differ per branch.
  const toolbarSettingsProps = {
    diffStyle: effectiveDiffStyle,
    onDiffStyleChange: handleDiffStyleChange,
    theme,
    onThemeChange: setTheme,
    lineDiffType,
    onLineDiffTypeChange: setLineDiffType,
    diffIndicators,
    onDiffIndicatorsChange: setDiffIndicators,
    overflow: overflowOpt,
    onOverflowChange: setOverflowOpt,
    disableLineNumbers,
    onDisableLineNumbersChange: setDisableLineNumbers,
    disableBackground,
    onDisableBackgroundChange: setDisableBackground,
    disableFileHeader,
    onDisableFileHeaderChange: setDisableFileHeader,
    stickyHeader,
    onStickyHeaderChange: setStickyHeader,
  }

  const finishFeedbackPopover: ReactElement | null =
    finishOpen && toolbarShellRef.current !== null ? (
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
    ) : null

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
        onPointerDownCapture={handleDiffRootPointerDown}
        className="flex h-full w-full min-h-0 flex-col overflow-hidden text-on-surface-variant focus:outline-none"
      >
        <div
          ref={toolbarShellRef}
          data-testid="diff-toolbar-shell"
          className="shrink-0"
        >
          <DiffChipToolbar
            {...toolbarSettingsProps}
            diffMode="unstaged"
            currentFileIndex={-1}
            totalFiles={0}
            feedbackCount={feedback.totalAnnotations()}
            onDiscardFeedback={feedback.clearBatch}
            onFinishFeedback={(): void => setFinishOpen(true)}
          />
          {finishFeedbackPopover}
        </div>
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

  // Populated state (horizontal split: file list + toolbar + Pierre diff)
  return (
    <div
      ref={diffRootRef}
      data-testid="diff-populated-state"
      tabIndex={-1}
      onPointerDownCapture={handleDiffRootPointerDown}
      className="flex h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden focus:outline-none"
    >
      {/* Left: Changed files list (~240px fixed) */}
      <div className="w-60 shrink-0 border-r border-wash-subtle overflow-y-auto">
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
            selectDiffFile(file)
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
            {...toolbarSettingsProps}
            diffMode={selectedFileStaged ? 'staged' : 'unstaged'}
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
              className="px-3 pb-2 text-[11px] leading-4 text-vcs-deleted"
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
          {commentDraftIsRecoverable ? (
            <div
              role="status"
              data-testid="diff-draft-recovery"
              className="mx-3 mb-2 rounded-md bg-surface-container-high/70 px-3 py-2 text-[11px] leading-4 text-on-surface-variant"
            >
              Draft preserved for line{' '}
              {annotationTarget.side === 'deletions' ? 'L' : 'R'}
              {annotationTarget.lineNumber}:{' '}
              <span className="font-medium text-on-surface">
                {commentDraftText}
              </span>
            </div>
          ) : null}
          {finishFeedbackPopover}
          {keyboardConfirm !== null && toolbarShellRef.current !== null ? (
            <Popover
              anchor={toolbarShellRef.current}
              open
              onOpenChange={(open): void => {
                if (!open) {
                  cancelKeyboardConfirm()
                }
              }}
              placement="bottom-end"
              width={320}
              aria-label={keyboardConfirm.title}
            >
              <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-medium text-on-surface">
                    {keyboardConfirm.title}
                  </h2>
                  <p className="text-xs leading-5 text-on-surface-variant">
                    {keyboardConfirm.body}
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-keyshortcuts="n"
                    onClick={cancelKeyboardConfirm}
                  >
                    No (n)
                  </Button>
                  <Button
                    size="sm"
                    variant={keyboardConfirm.variant}
                    aria-keyshortcuts="y"
                    onClick={confirmKeyboardAction}
                  >
                    Yes (y)
                  </Button>
                </div>
              </div>
            </Popover>
          ) : null}
        </div>
        <div
          ref={diffScrollBodyRef}
          data-testid="diff-scroll-body"
          className="min-h-0 flex-1 overflow-auto"
          onPointerMove={(): void => {
            if (keyboardLineActive) {
              setKeyboardLineActive(false)
            }
          }}
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
                  // Pierre wraps this button in a center-aligned slot pinned to
                  // the gutter's right edge, so by default the "+" lands on top of
                  // the line number. translate-x-3/4 nudges it into the gutter
                  // gap next to the code (GitHub-style); the percentage is of the
                  // button's own width, so it adapts to any line-number column.
                  <IconButton
                    icon="add"
                    label="Add comment on this line"
                    size="sm"
                    shortcut="i"
                    className="h-5 w-5 translate-x-3/4 rounded-full bg-primary text-on-primary shadow-md hover:bg-primary/90"
                    onClick={(): void => {
                      const hovered = getHoveredLine()
                      if (hovered && selectedFilePath !== null) {
                        setKeyboardLineActive(false)

                        const nextTarget: AnnotationTarget = {
                          lineNumber: hovered.lineNumber,
                          side: hovered.side,
                          filePath: selectedFilePath,
                          staged: selectedFileStaged,
                        }

                        setCommentDraftText((current) => {
                          if (annotationTarget === null) {
                            return ''
                          }

                          const sameTarget =
                            annotationTargetKey(annotationTarget) ===
                            annotationTargetKey(nextTarget)

                          return sameTarget ? current : ''
                        }, false)
                        setAnnotationTarget(nextTarget)
                      }
                    }}
                  />
                )}
                renderAnnotation={(
                  annotation: DiffLineAnnotation<ReviewComment>
                ): ReactElement => {
                  const isDraft = annotation.metadata.id === DRAFT_ID

                  const isEditing =
                    annotationTarget?.editId !== undefined &&
                    annotationTarget.editId === annotation.metadata.id

                  if (isDraft || isEditing) {
                    return (
                      <ReviewCommentEditor
                        // Key by target identity so switching the gutter `+` to
                        // another line (the draft stays at the same annotation
                        // index, so React would otherwise reuse this instance
                        // and carry the old textarea text to the new line)
                        // forces a remount with fresh state.
                        key={`${annotation.lineNumber}:${annotation.side}:${
                          isEditing ? annotation.metadata.id : 'draft'
                        }`}
                        lineNumber={annotation.lineNumber}
                        side={annotation.side}
                        value={commentDraftText}
                        onTextChange={(text): void => {
                          setCommentDraftText(text, false)
                        }}
                        onConfirm={confirmCommentEditor}
                        onCancel={closeCommentEditor}
                      />
                    )
                  }

                  return (
                    <ReviewCommentRow
                      comment={annotation.metadata}
                      onEdit={(): void => {
                        setAnnotationTarget({
                          lineNumber: annotation.lineNumber,
                          side: annotation.side,
                          filePath: selectedFilePath ?? '',
                          staged: selectedFileStaged,
                          editId: annotation.metadata.id,
                        })
                        setCommentDraftText(annotation.metadata.text, false)
                      }}
                      onDelete={(): void => {
                        removeFeedbackAnnotation(annotation.metadata.id)
                      }}
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
