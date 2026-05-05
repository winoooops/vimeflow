import { useState, useRef, useEffect, useCallback } from 'react'

export interface UseNotifyInfoReturn {
  message: string | null
  notifyInfo: (msg: string) => void
  dismiss: () => void
}

/**
 * Workspace-level transient-message channel for the command palette.
 *
 * Returns `notifyInfo(msg)` which `WorkspaceView` passes down to
 * `buildWorkspaceCommands` as the failure / info notification surface
 * (e.g. "No active tab to close", "Usage: :rename <name>", split-pane
 * stubs). The displayed `message` auto-dismisses after 5 seconds and
 * can be cleared manually via `dismiss()`.
 *
 * Successive `notifyInfo` calls collapse: the previous timer is cleared
 * and the latest message takes over, so rapid commands don't queue up
 * stale banners. The 5s timer is canceled on unmount to prevent state
 * updates after the host component is gone.
 *
 * Companion to the `<InfoBanner />` component in this directory; the
 * banner reads `message` and renders a non-blocking `role="status"`
 * surface at the top of the workspace's main column.
 */
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
