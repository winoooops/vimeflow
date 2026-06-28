// cspell:ignore Ghostty ghostty
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from 'react'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import {
  attachNativeGhosttyOutput,
  destroyNativeGhostty,
  focusNativeGhostty,
  sendNativeGhosttyData,
  updateNativeGhostty,
} from '../../nativeGhosttyClient'

interface GhosttyBodyProps {
  paneId: string
  ptyId: string
  cwd: string
  active: boolean
  service: ITerminalService
  onPaneReady?: NotifyPaneReady
  onUnavailable?: () => void
}

export const GhosttyBody = ({
  paneId,
  ptyId,
  cwd,
  active,
  service,
  onPaneReady = undefined,
  onUnavailable = undefined,
}: GhosttyBodyProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const frameIdRef = useRef<number | null>(null)
  const paneRef = useMemo(() => ({ sessionId: ptyId, paneId }), [paneId, ptyId])

  const updateNativeFrame = useCallback(async (): Promise<void> => {
    const node = containerRef.current
    if (!node) {
      return
    }

    const rect = node.getBoundingClientRect()
    try {
      const enabled = await updateNativeGhostty({
        ...paneRef,
        cwd,
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        visible: true,
      })

      if (!enabled) {
        onUnavailable?.()
      }
    } catch {
      onUnavailable?.()
    }
  }, [cwd, onUnavailable, paneRef])

  const scheduleNativeFrameUpdate = useCallback((): void => {
    if (frameIdRef.current !== null) {
      return
    }

    frameIdRef.current = window.requestAnimationFrame(() => {
      frameIdRef.current = null
      void updateNativeFrame()
    })
  }, [updateNativeFrame])

  // Keep the parented NSView aligned; resize events only schedule rAF updates.
  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    void updateNativeFrame()
    const observer = new ResizeObserver(scheduleNativeFrameUpdate)
    observer.observe(node)
    window.addEventListener('resize', scheduleNativeFrameUpdate)

    return (): void => {
      if (frameIdRef.current !== null) {
        window.cancelAnimationFrame(frameIdRef.current)
        frameIdRef.current = null
      }
      observer.disconnect()
      window.removeEventListener('resize', scheduleNativeFrameUpdate)
    }
  }, [scheduleNativeFrameUpdate, updateNativeFrame])

  // Focus follows the active pane, but focus no longer owns surface lifetime.
  useEffect(() => {
    if (active) {
      void focusNativeGhostty(paneRef)
    }
  }, [active, paneRef])

  // Keep output attached while mounted so inactive split panes keep rendering.
  useEffect(() => {
    let releasePaneReady: (() => void) | null = null
    let unsubscribeOutput: (() => void) | null = null
    let cancelled = false

    const drainBufferedOutput = (data: string): void => {
      void sendNativeGhosttyData({ ...paneRef, data })
    }

    const attachOutput = async (): Promise<void> => {
      const unsubscribe = await attachNativeGhosttyOutput(service, paneRef)

      if (cancelled) {
        unsubscribe()

        return
      }

      unsubscribeOutput = unsubscribe
      releasePaneReady = onPaneReady?.(ptyId, drainBufferedOutput) ?? null
    }

    void attachOutput()

    return (): void => {
      cancelled = true
      releasePaneReady?.()
      unsubscribeOutput?.()
      void destroyNativeGhostty(paneRef)
    }
  }, [onPaneReady, paneRef, ptyId, service])

  return (
    <div
      ref={containerRef}
      data-testid="native-ghostty-pane"
      className="h-full w-full"
      onFocus={(): void => {
        void focusNativeGhostty(paneRef)
      }}
      onMouseDown={(): void => {
        void focusNativeGhostty(paneRef)
      }}
      role="presentation"
      style={{ background: 'var(--color-surface)' }}
    />
  )
}
