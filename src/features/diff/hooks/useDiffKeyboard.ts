import { useEffect, type RefObject } from 'react'
import {
  DIALOG_SELECTOR,
  TERMINAL_CONTAINER_ID,
} from '../../workspace/containerIds'

export interface UseDiffKeyboardOptions {
  enabled: boolean
  rootRef: RefObject<HTMLElement | null>
  confirming: boolean
  onMoveLine: (delta: number) => void
  onScrollPage: (direction: number) => void
  onPreviousFile: () => void
  onNextFile: () => void
  onPreviousHunk: () => void
  onNextHunk: () => void
  onComment: () => void
  onUpdateComment: () => void
  onDeleteComment: () => void
  onFinishReview: () => void
  onStageHunk: () => void
  onDiscardHunk: () => void
  onDiscardFile: () => void
  onToggleView: () => void
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
export const useDiffKeyboard = (options: UseDiffKeyboardOptions): void => {
  const {
    enabled,
    rootRef,
    confirming,
    onMoveLine,
    onScrollPage,
    onPreviousFile,
    onNextFile,
    onPreviousHunk,
    onNextHunk,
    onComment,
    onUpdateComment,
    onDeleteComment,
    onFinishReview,
    onStageHunk,
    onDiscardHunk,
    onDiscardFile,
    onToggleView,
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

      const handlers: Partial<Record<string, () => void>> = {
        j: () => onMoveLine(1),
        k: () => onMoveLine(-1),
        n: onNextFile,
        p: onPreviousFile,
        '[': onPreviousHunk,
        ']': onNextHunk,
        i: onComment,
        u: onUpdateComment,
        x: onDeleteComment,
        Y: onFinishReview,
        s: onStageHunk,
        d: onDiscardHunk,
        D: onDiscardFile,
        t: onToggleView,
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
    onPreviousHunk,
    onNextHunk,
    onComment,
    onUpdateComment,
    onDeleteComment,
    onFinishReview,
    onStageHunk,
    onDiscardHunk,
    onDiscardFile,
    onToggleView,
    onConfirm,
    onCancelConfirm,
  ])
}
