import { useCallback, useEffect, useRef, useState } from 'react'
import { isMacPlatform } from '../../../lib/formatShortcut'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { UseSettingsDialogReturn } from '../types'

export const useSettingsDialog = (): UseSettingsDialogReturn => {
  const [isOpen, setIsOpen] = useState(false)
  const isOpenRef = useRef(isOpen)

  const openNativeWindow = useCallback((): boolean => {
    if (import.meta.env.VITE_E2E) {
      return false
    }

    const openWindow =
      typeof window !== 'undefined'
        ? window.vimeflow?.settings?.openWindow
        : undefined

    if (openWindow === undefined) {
      return false
    }

    void (async (): Promise<void> => {
      try {
        await openWindow()
      } catch {
        setIsOpen(true)
      }
    })()

    return true
  }, [])

  const open = useCallback(() => {
    if (openNativeWindow()) {
      return
    }

    setIsOpen(true)
  }, [openNativeWindow])

  const close = useCallback(() => setIsOpen(false), [])

  const toggle = useCallback(() => {
    if (!isOpenRef.current && openNativeWindow()) {
      return
    }

    setIsOpen((prev) => !prev)
  }, [openNativeWindow])

  const handlersRef = useRef({ close, toggle })

  isOpenRef.current = isOpen
  handlersRef.current = { close, toggle }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        isKeymapCaptureTarget(event.target) ||
        (event.target instanceof Element &&
          event.target.closest('[data-dialog-layer="true"]') !== null)
      ) {
        return
      }

      const isMac = isMacPlatform()

      const isSettingsModifier = isMac
        ? event.metaKey !== event.ctrlKey
        : event.ctrlKey && !event.metaKey

      if (
        isSettingsModifier &&
        event.key === ',' &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault()
        handlersRef.current.toggle()

        return
      }

      if (event.key === 'Escape' && isOpenRef.current) {
        event.preventDefault()
        handlersRef.current.close()
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [])

  return { isOpen, open, close, toggle }
}
