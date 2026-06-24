import { useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'

export type ClipboardModifier = 'meta' | 'ctrl'

export interface UseTerminalClipboardOptions {
  terminal: Terminal | null
  preferModifier?: ClipboardModifier
  enableImagePaste?: boolean
  onCopyError?: (error: unknown) => void
  onPasteError?: (error: unknown) => void
}

export interface UseTerminalClipboardResult {
  hasSelection: boolean
  canPasteImage: boolean
  isOpen: boolean
  openAt: { x: number; y: number } | null
  close: () => void
  copy: () => Promise<void>
  paste: () => Promise<void>
  pasteImage: () => Promise<void>
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

const MAX_PASTE_IMAGE_BYTES = 512 * 1024
const IMAGE_CLIPBOARD_OPEN_DELAY_MS = 50

interface ClipboardImageItem {
  types: readonly string[]
  getType: (type: string) => Promise<Blob>
}

const readClipboardItems = (): Promise<ClipboardImageItem[]> | null => {
  const clipboard = window.navigator.clipboard as
    | { read?: () => Promise<ClipboardImageItem[]> }
    | undefined

  if (clipboard?.read === undefined) {
    return null
  }

  return clipboard.read()
}

const firstClipboardItem = (
  items: readonly ClipboardImageItem[]
): ClipboardImageItem | null => (items.length === 0 ? null : items[0])

const imageTypeOfTopClipboardItem = (
  items: readonly ClipboardImageItem[]
): string | null => {
  const topItem = firstClipboardItem(items)
  if (topItem === null) {
    return null
  }

  const imageType = topItem.types.find((type) => type.startsWith('image/'))

  return imageType ?? null
}

const readTopClipboardImage = async (): Promise<Blob | null> => {
  const items = await readClipboardItems()
  if (items === null) {
    return null
  }

  const topItem = firstClipboardItem(items)
  if (topItem === null) {
    return null
  }

  const imageType = imageTypeOfTopClipboardItem(items)

  return imageType === null ? null : topItem.getType(imageType)
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (): void => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)

        return
      }

      reject(new Error('Clipboard image read failed'))
    }

    reader.onerror = (): void => {
      reject(reader.error ?? new Error('Clipboard image read failed'))
    }

    reader.readAsDataURL(blob)
  })

export const useTerminalClipboard = ({
  terminal,
  preferModifier: preferredModifier = undefined,
  enableImagePaste = false,
  onCopyError = undefined,
  onPasteError = undefined,
}: UseTerminalClipboardOptions): UseTerminalClipboardResult => {
  const preferModifier = preferredModifier ?? detectModifier()

  const [hasSelection, setHasSelection] = useState(false)
  const [canPasteImage, setCanPasteImage] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [openAt, setOpenAt] = useState<{ x: number; y: number } | null>(null)

  const onCopyErrorRef = useRef(onCopyError)
  const onPasteErrorRef = useRef(onPasteError)
  const copyRef = useRef<() => Promise<void>>(noopAsync)
  const pasteRef = useRef<() => Promise<void>>(noopAsync)

  const pasteImageIfAvailableRef = useRef<() => Promise<boolean>>(() =>
    Promise.resolve(false)
  )

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

  const pasteImage = async (): Promise<void> => {
    await pasteImageIfAvailable()
  }

  const pasteImageIfAvailable = async (): Promise<boolean> => {
    if (!terminal || !enableImagePaste) {
      return false
    }

    try {
      const image = await readTopClipboardImage()
      if (image === null) {
        setCanPasteImage(false)

        return false
      }

      if (image.size > MAX_PASTE_IMAGE_BYTES) {
        setCanPasteImage(false)
        onPasteErrorRef.current?.(
          new Error('Clipboard image is too large to paste')
        )

        return false
      }

      terminal.paste(await blobToDataUrl(image))

      return true
    } catch (error: unknown) {
      onPasteErrorRef.current?.(error)

      return false
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
  pasteImageIfAvailableRef.current = pasteImageIfAvailable

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
    let disposed = false
    const pendingOpenTimers = new Set<number>()

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
      setCanPasteImage(false)

      const openMenu = (): void => {
        if (disposed) {
          return
        }

        setIsOpen(true)
        setOpenAt({ x: event.clientX, y: event.clientY })
      }

      if (!enableImagePaste) {
        openMenu()

        return
      }

      const itemsPromise = readClipboardItems()
      if (itemsPromise === null) {
        openMenu()

        return
      }

      const fallbackOpenTimer = window.setTimeout(() => {
        pendingOpenTimers.delete(fallbackOpenTimer)
        openMenu()
      }, IMAGE_CLIPBOARD_OPEN_DELAY_MS)

      pendingOpenTimers.add(fallbackOpenTimer)

      void (async (): Promise<void> => {
        try {
          setCanPasteImage(
            imageTypeOfTopClipboardItem(await itemsPromise) !== null
          )
        } catch {
          setCanPasteImage(false)
        } finally {
          const timerPending = pendingOpenTimers.delete(fallbackOpenTimer)
          window.clearTimeout(fallbackOpenTimer)

          if (timerPending) {
            openMenu()
          }
        }
      })()
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
        const imagePasteShortcut = isMac
          ? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
          : event.ctrlKey && !event.shiftKey && !event.metaKey && !event.altKey

        if (enableImagePaste && imagePasteShortcut) {
          event.preventDefault()

          void (async (): Promise<void> => {
            const pasted = await pasteImageIfAvailableRef.current()
            if (!pasted) {
              await pasteRef.current()
            }
          })()

          return false
        }

        const matched = isMac
          ? event.metaKey && !event.ctrlKey && !event.altKey
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
      terminal.attachCustomKeyEventHandler(handleKey)
    } catch {
      /* terminal not ready; retrying is left to the next terminal identity */
    }

    element.addEventListener('mousedown', handleMouseDown, { passive: true })
    element.addEventListener('mouseup', handleMouseUp, { passive: true })
    element.addEventListener('contextmenu', handleContextMenu, {
      capture: true,
    })

    return (): void => {
      disposed = true
      pendingOpenTimers.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      pendingOpenTimers.clear()

      try {
        selectionDisposable.dispose()
      } catch {
        /* terminal already disposed */
      }

      try {
        terminal.attachCustomKeyEventHandler((): boolean => true)
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
      setCanPasteImage(false)
    }
  }, [terminal, preferModifier, enableImagePaste])

  return {
    hasSelection,
    canPasteImage,
    isOpen,
    openAt,
    close,
    copy,
    paste,
    pasteImage,
    selectAll,
    clear,
  }
}
