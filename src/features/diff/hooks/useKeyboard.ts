import { useEffect, type RefObject } from 'react'
import {
  DIALOG_SELECTOR,
  TERMINAL_CONTAINER_ID,
} from '../../workspace/containerIds'
import { DIFF_COMMANDS, type DiffCommandId } from '../../keymap/catalog'
import { useKeybindings } from '../../keymap/useKeybindings'

export interface UseKeyboardOptions {
  enabled: boolean
  rootRef: RefObject<HTMLElement | null>
  confirming: boolean
  onMoveLine: (delta: number) => void
  onScrollPage: (direction: number) => void
  onPreviousFile: () => void
  onNextFile: () => void
  onToggleFilesList: () => void
  onToggleFilesListPinned: () => void
  onRefreshDiff: () => void
  searchOpen: boolean
  onOpenSearch: () => void
  onCloseSearch: () => void
  onNextMatch: () => void
  onPreviousMatch: () => void
  onPreviousHunk: () => void
  onNextHunk: () => void
  onComment: () => void
  onFileComment: () => void
  onUpdateComment: () => void
  onUpdateFileComment: () => void
  onDeleteComment: () => void
  onFinishReview: () => void
  onRequestReview: () => void
  onStageHunk: () => void
  onDiscardHunk: () => void
  onDiscardFile: () => void
  onToggleView: () => void
  onMoveLineSide: (side: 'deletions' | 'additions') => void
  visualMode: boolean
  onStartVisualSelection: () => void
  onYankSelection: () => void
  onCancelVisualSelection: () => void
  onConfirm: () => void
  onCancelConfirm: () => void
}

const isTextEntry = (target: Element): boolean =>
  !!target.closest('input, textarea, [contenteditable], [role="textbox"]')

const isDiffScopeActive = (
  root: HTMLElement,
  target: Element,
  activeElement: Element
): boolean => {
  const diffPanel = root.closest('[data-testid="diff-panel"]')

  if (diffPanel) {
    return diffPanel.contains(target) || diffPanel.contains(activeElement)
  }

  return root.contains(target) || root.contains(activeElement)
}

/** Focus-scoped keyboard shortcuts for the git diff viewer. */
export const useKeyboard = (options: UseKeyboardOptions): void => {
  const { matches } = useKeybindings()

  const {
    enabled,
    rootRef,
    confirming,
    onMoveLine,
    onScrollPage,
    onPreviousFile,
    onNextFile,
    onToggleFilesList,
    onToggleFilesListPinned,
    onRefreshDiff,
    searchOpen,
    onOpenSearch,
    onCloseSearch,
    onNextMatch,
    onPreviousMatch,
    onPreviousHunk,
    onNextHunk,
    onComment,
    onFileComment,
    onUpdateComment,
    onUpdateFileComment,
    onDeleteComment,
    onFinishReview,
    onRequestReview,
    onStageHunk,
    onDiscardHunk,
    onDiscardFile,
    onToggleView,
    onMoveLineSide,
    visualMode,
    onStartVisualSelection,
    onYankSelection,
    onCancelVisualSelection,
    onConfirm,
    onCancelConfirm,
  } = options

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!enabled) {
        return
      }

      const root = rootRef.current
      if (!root) {
        return
      }

      const target =
        event.target instanceof Element
          ? event.target
          : document.activeElement instanceof Element
            ? document.activeElement
            : document.body

      const activeElement =
        document.activeElement instanceof Element
          ? document.activeElement
          : target

      if (confirming) {
        const handler = matches(event, 'diff-confirm-accept')
          ? onConfirm
          : matches(event, 'diff-confirm-cancel')
            ? onCancelConfirm
            : null

        if (handler !== null) {
          event.preventDefault()
          event.stopPropagation()
          handler()
        }

        return
      }

      if (document.querySelector(DIALOG_SELECTOR)) {
        return
      }

      if (
        !isDiffScopeActive(root, target, activeElement) ||
        isTextEntry(target) ||
        isTextEntry(activeElement) ||
        !!target.closest(`[data-container-id="${TERMINAL_CONTAINER_ID}"]`) ||
        !!target.closest('.cm-editor')
      ) {
        return
      }

      const handlers: Partial<Record<DiffCommandId, () => void>> = {
        'diff-line-next': () => onMoveLine(1),
        'diff-line-previous': () => onMoveLine(-1),
        'diff-scroll-page-down': () => onScrollPage(1),
        'diff-scroll-page-up': () => onScrollPage(-1),
        'diff-file-next': searchOpen ? onNextMatch : onNextFile,
        'diff-file-previous': searchOpen ? onPreviousMatch : onPreviousFile,
        'diff-search-open': onOpenSearch,
        'diff-search-or-visual-cancel': searchOpen
          ? onCloseSearch
          : visualMode
            ? onCancelVisualSelection
            : undefined,
        'diff-files-toggle': onToggleFilesList,
        'diff-files-pin': onToggleFilesListPinned,
        'diff-refresh': onRefreshDiff,
        'diff-hunk-previous': onPreviousHunk,
        'diff-hunk-next': onNextHunk,
        'diff-comment-line': onComment,
        'diff-comment-file': onFileComment,
        'diff-comment-update': onUpdateComment,
        'diff-file-comment-update': onUpdateFileComment,
        'diff-comment-delete': onDeleteComment,
        'diff-review-finish': onFinishReview,
        'diff-review-request': onRequestReview,
        'diff-hunk-stage': onStageHunk,
        'diff-hunk-discard': onDiscardHunk,
        'diff-file-discard': onDiscardFile,
        'diff-view-toggle': onToggleView,
        'diff-side-deletions': () => onMoveLineSide('deletions'),
        'diff-side-additions': () => onMoveLineSide('additions'),
        'diff-visual-start': onStartVisualSelection,
        'diff-visual-yank': onYankSelection,
      }

      const command = DIFF_COMMANDS.find(
        ({ id }) => handlers[id] !== undefined && matches(event, id)
      )
      const handler = command === undefined ? undefined : handlers[command.id]

      if (handler) {
        event.preventDefault()
        event.stopPropagation()
        handler()
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [
    enabled,
    rootRef,
    confirming,
    onMoveLine,
    onScrollPage,
    onPreviousFile,
    onNextFile,
    onToggleFilesList,
    onToggleFilesListPinned,
    onRefreshDiff,
    searchOpen,
    onOpenSearch,
    onCloseSearch,
    onNextMatch,
    onPreviousMatch,
    onPreviousHunk,
    onNextHunk,
    onComment,
    onFileComment,
    onUpdateComment,
    onUpdateFileComment,
    onDeleteComment,
    onFinishReview,
    onRequestReview,
    onStageHunk,
    onDiscardHunk,
    onDiscardFile,
    onToggleView,
    onMoveLineSide,
    visualMode,
    onStartVisualSelection,
    onYankSelection,
    onCancelVisualSelection,
    onConfirm,
    onCancelConfirm,
    matches,
  ])
}
