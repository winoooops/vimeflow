import { useCallback, useEffect, useRef, useState } from 'react'
import { isMacPlatform } from '../../../lib/formatShortcut'
import { isKeymapCaptureTarget } from '../../keymap/capture'
import type { SettingsTargetId, UseSettingsDialogReturn } from '../types'

const SETTINGS_OPEN_REQUEST = 'vimeflow:settings-open-request'

export const requestSettingsOpen = (targetId?: SettingsTargetId): void => {
  if (typeof document === 'undefined') {
    return
  }

  document.dispatchEvent(
    new CustomEvent(SETTINGS_OPEN_REQUEST, { detail: targetId })
  )
}

export const useSettingsDialog = (): UseSettingsDialogReturn => {
  const [isOpen, setIsOpen] = useState(false)
  const [targetId, setTargetId] = useState<SettingsTargetId | null>(null)
  const isOpenRef = useRef(isOpen)

  const openNativeWindow = useCallback(
    (nextTargetId?: SettingsTargetId): boolean => {
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
          await openWindow(nextTargetId)
        } catch {
          setIsOpen(true)
        }
      })()

      return true
    },
    []
  )

  const open = useCallback(
    (nextTargetId?: SettingsTargetId): void => {
      setTargetId(nextTargetId ?? null)
      if (openNativeWindow(nextTargetId)) {
        return
      }

      setIsOpen(true)
    },
    [openNativeWindow]
  )

  const close = useCallback(() => setIsOpen(false), [])

  const toggle = useCallback((): void => {
    if (!isOpenRef.current) {
      setTargetId(null)
      if (openNativeWindow()) {
        return
      }
    }

    setIsOpen((prev) => !prev)
  }, [openNativeWindow])

  const handlersRef = useRef({ close, open, toggle })

  isOpenRef.current = isOpen
  handlersRef.current = { close, open, toggle }

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

  useEffect(() => {
    const handleRequest = (event: Event): void => {
      handlersRef.current.open(
        event instanceof CustomEvent && typeof event.detail === 'string'
          ? event.detail
          : undefined
      )
    }

    document.addEventListener(SETTINGS_OPEN_REQUEST, handleRequest)

    return (): void => {
      document.removeEventListener(SETTINGS_OPEN_REQUEST, handleRequest)
    }
  }, [])

  return { isOpen, targetId, open, close, toggle }
}
