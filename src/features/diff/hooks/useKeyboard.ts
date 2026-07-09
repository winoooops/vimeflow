import { useEffect, type RefObject } from 'react'
import {
  DIALOG_SELECTOR,
  TERMINAL_CONTAINER_ID,
} from '../../workspace/containerIds'

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
        const key = event.key.toLowerCase()

        const handler =
          key === 'y' ? onConfirm : key === 'n' ? onCancelConfirm : null

        if (
          handler !== null &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
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

      if (event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase()
        const direction = key === 'd' ? 1 : key === 'u' ? -1 : 0

        if (direction !== 0) {
          event.preventDefault()
          event.stopPropagation()
          onScrollPage(direction)
        }

        return
      }

      if (event.metaKey || event.altKey || event.ctrlKey) {
        return
      }

      if (event.key === 'Escape') {
        if (searchOpen) {
          event.preventDefault()
          event.stopPropagation()
          onCloseSearch()

          return
        }

        if (visualMode) {
          event.preventDefault()
          event.stopPropagation()
          onCancelVisualSelection()

          return
        }
      }

      const handlers: Partial<Record<string, () => void>> = {
        j: () => onMoveLine(1),
        k: () => onMoveLine(-1),
        n: searchOpen ? onNextMatch : onNextFile,
        p: searchOpen ? onPreviousMatch : onPreviousFile,
        '/': onOpenSearch,
        e: onToggleFilesList,
        E: onToggleFilesListPinned,
        r: onRefreshDiff,
        '[': onPreviousHunk,
        ']': onNextHunk,
        i: onComment,
        I: onFileComment,
        u: onUpdateComment,
        U: onUpdateFileComment,
        x: onDeleteComment,
        Y: onFinishReview,
        '@': onRequestReview,
        s: onStageHunk,
        d: onDiscardHunk,
        D: onDiscardFile,
        t: onToggleView,
        h: () => onMoveLineSide('deletions'),
        l: () => onMoveLineSide('additions'),
        v: onStartVisualSelection,
        y: onYankSelection,
      }

      const handler = handlers[event.key]
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
  ])
}
