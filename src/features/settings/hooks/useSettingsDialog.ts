import { useCallback, useEffect, useRef, useState } from 'react'
import { isMacPlatform } from '../../../lib/formatShortcut'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { UseSettingsDialogReturn } from '../types'

export const useSettingsDialog = (): UseSettingsDialogReturn => {
  const [isOpen, setIsOpen] = useState(false)

  const openNativeWindow = useCallback((): boolean => {
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
    if (openNativeWindow()) {
      return
    }

    setIsOpen((prev) => !prev)
  }, [openNativeWindow])

  const isOpenRef = useRef(isOpen)
  const handlersRef = useRef({ close, toggle })

  isOpenRef.current = isOpen
  handlersRef.current = { close, toggle }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isKeymapCaptureTarget(event.target)) {
        return
      }

      const isMac = isMacPlatform()

      const isSuper = isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey

      if (isSuper && event.key === ',' && !event.altKey && !event.shiftKey) {
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
