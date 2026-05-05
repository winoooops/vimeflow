import { useState, useRef, useEffect, useCallback } from 'react'

export interface UseNotifyInfoReturn {
  message: string | null
  notifyInfo: (msg: string) => void
  dismiss: () => void
}

// 5s auto-dismiss; successive notifyInfo calls collapse to the latest message.
export const useNotifyInfo = (): UseNotifyInfoReturn => {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  const dismiss = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setMessage(null)
  }, [])

  const notifyInfo = useCallback((msg: string): void => {
    // Clear existing timer if any
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }

    // Set new message
    setMessage(msg)

    // Set new 5s timer
    timerRef.current = window.setTimeout(() => {
      setMessage(null)
      timerRef.current = null
    }, 5000)
  }, [])

  // Cleanup on unmount
  useEffect(
    () => (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    },
    []
  )

  return {
    message,
    notifyInfo,
    dismiss,
  }
}
