import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface UseFocusedPaneOptions {
  containerRef: RefObject<HTMLElement | null>
  initial?: boolean
}

export interface UseFocusedPaneReturn {
  isFocused: boolean
  setFocused: (next: boolean) => void
  onTerminalFocusChange: (focused: boolean) => void
}

export const useFocusedPane = ({
  containerRef,
  initial = false,
}: UseFocusedPaneOptions): UseFocusedPaneReturn => {
  const [isFocused, setIsFocused] = useState(initial)

  const onTerminalFocusChange = useCallback((focused: boolean): void => {
    setIsFocused(focused)
  }, [])

  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      const node = containerRef.current
      if (!node) {
        return
      }
      if (node.offsetWidth === 0) {
        return
      }

      const target = event.target as Node | null
      if (target && !node.contains(target)) {
        setIsFocused(false)
      }
    }

    document.addEventListener('mousedown', onMouseDown)

    return (): void => {
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [containerRef])

  return {
    isFocused,
    setFocused: setIsFocused,
    onTerminalFocusChange,
  }
}
