import { useEffect, useRef, useState } from 'react'
import type { TerminalSurface } from '../types'

export type ClipboardModifier = 'meta' | 'ctrl'

export interface UseTerminalClipboardOptions {
  terminal: TerminalSurface | null
  preferModifier?: ClipboardModifier
  onCopyError?: (error: unknown) => void
  onPasteError?: (error: unknown) => void
}

export interface UseTerminalClipboardResult {
  hasSelection: boolean
  isOpen: boolean
  openAt: { x: number; y: number } | null
  close: () => void
  copy: () => Promise<void>
  paste: () => Promise<void>
  selectAll: () => void
  clear: () => void
}

const detectModifier = (): ClipboardModifier => {
  const platform = window.navigator.platform.toLowerCase()

  return platform.includes('mac') ? 'meta' : 'ctrl'
}

const writeViaTextarea = (text: string): boolean => {
  const execCommand = (
    document as unknown as {
      execCommand?: (command: string) => boolean
    }
  ).execCommand
  if (typeof execCommand !== 'function') {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return execCommand.call(document, 'copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

const noopAsync = (): Promise<void> => Promise.resolve()

export const useTerminalClipboard = ({
  terminal,
  preferModifier: preferredModifier = undefined,
  onCopyError = undefined,
  onPasteError = undefined,
}: UseTerminalClipboardOptions): UseTerminalClipboardResult => {
  const preferModifier = preferredModifier ?? detectModifier()

  const [hasSelection, setHasSelection] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [openAt, setOpenAt] = useState<{ x: number; y: number } | null>(null)

  const onCopyErrorRef = useRef(onCopyError)
  const onPasteErrorRef = useRef(onPasteError)
  const copyRef = useRef<() => Promise<void>>(noopAsync)
  const pasteRef = useRef<() => Promise<void>>(noopAsync)

  onCopyErrorRef.current = onCopyError
  onPasteErrorRef.current = onPasteError

  const copy = async (): Promise<void> => {
    if (!terminal?.hasSelection()) {
      return
    }

    const text = terminal.getSelection()
    if (text === '') {
      return
    }

    try {
      await window.navigator.clipboard.writeText(text)

      return
    } catch (writeError: unknown) {
      const fallbackOk = writeViaTextarea(text)
      if (fallbackOk) {
        return
      }

      const finalError =
        writeError instanceof Error
          ? writeError
          : new Error('Clipboard write failed')
      onCopyErrorRef.current?.(finalError)
    }
  }

  const paste = async (): Promise<void> => {
    if (!terminal) {
      return
    }

    const clipboard = window.navigator.clipboard as
      | { readText?: () => Promise<string> }
      | undefined

    if (clipboard?.readText === undefined) {
      onPasteErrorRef.current?.(new Error('Clipboard read API unavailable'))

      return
    }

    try {
      const text = await clipboard.readText()
      if (text === '') {
        return
      }
      terminal.paste(text)
    } catch (error: unknown) {
      onPasteErrorRef.current?.(error)
    }
  }

  const selectAll = (): void => {
    terminal?.selectAll()
  }

  const clear = (): void => {
    terminal?.clear()
  }

  const close = (): void => {
    setIsOpen(false)
    setOpenAt(null)
  }

  copyRef.current = copy
  pasteRef.current = paste

  useEffect(() => {
    if (!terminal) {
      return
    }

    const element = terminal.element
    if (!element) {
      return
    }

    let isDragging = false
    let pendingSelection = false

    const handleMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0) {
        return
      }
      isDragging = true
      pendingSelection = false
    }

    const selectionDisposable = terminal.onSelectionChange(() => {
      const nextHasSelection = terminal.hasSelection()
      setHasSelection(nextHasSelection)
      if (isDragging && nextHasSelection) {
        pendingSelection = true
      }
    })

    const handleMouseUp = (): void => {
      if (!isDragging) {
        return
      }

      isDragging = false
      if (!pendingSelection || !terminal.hasSelection()) {
        return
      }

      pendingSelection = false
      queueMicrotask(() => {
        if (terminal.hasSelection()) {
          void copyRef.current()
        }
      })
    }

    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      setIsOpen(true)
      setOpenAt({ x: event.clientX, y: event.clientY })
    }

    const isMac = preferModifier === 'meta'

    const handleKey = (event: KeyboardEvent): boolean => {
      if (event.type !== 'keydown') {
        return true
      }

      if (event.code === 'KeyC') {
        if (isMac) {
          const commandOnly =
            event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey

          if (commandOnly) {
            if (!terminal.hasSelection()) {
              return true
            }

            event.preventDefault()
            void copyRef.current()

            return false
          }
        } else {
          const ctrlShift =
            event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey

          if (ctrlShift) {
            event.preventDefault()
            if (terminal.hasSelection()) {
              void copyRef.current()
            }

            return false
          }
        }
      }

      if (event.code === 'KeyV') {
        const matched = isMac
          ? event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey
          : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey

        if (matched) {
          event.preventDefault()
          void pasteRef.current()

          return false
        }
      }

      return true
    }

    try {
      terminal.attachKeyEventHandler(handleKey)
    } catch {
      /* terminal not ready; retrying is left to the next terminal identity */
    }

    element.addEventListener('mousedown', handleMouseDown, { passive: true })
    element.addEventListener('mouseup', handleMouseUp, { passive: true })
    element.addEventListener('contextmenu', handleContextMenu, {
      capture: true,
    })

    return (): void => {
      try {
        selectionDisposable.dispose()
      } catch {
        /* terminal already disposed */
      }

      try {
        terminal.attachKeyEventHandler((): boolean => true)
      } catch {
        /* terminal already disposed */
      }

      element.removeEventListener('mousedown', handleMouseDown)
      element.removeEventListener('mouseup', handleMouseUp)
      element.removeEventListener('contextmenu', handleContextMenu, {
        capture: true,
      })
      setIsOpen(false)
      setOpenAt(null)
      setHasSelection(false)
    }
  }, [terminal, preferModifier])

  return {
    hasSelection,
    isOpen,
    openAt,
    close,
    copy,
    paste,
    selectAll,
    clear,
  }
}
