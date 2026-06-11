import { useCallback, useEffect, useRef, useState } from 'react'
import type { UseSettingsDialogReturn } from '../types'

export const useSettingsDialog = (): UseSettingsDialogReturn => {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])

  const isOpenRef = useRef(isOpen)
  const handlersRef = useRef({ close, toggle })

  isOpenRef.current = isOpen
  handlersRef.current = { close, toggle }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
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
