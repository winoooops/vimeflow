// cspell:ignore Ghostty ghostty
import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import {
  attachNativeGhosttyOutput,
  destroyNativeGhostty,
  focusNativeGhostty,
  sendNativeGhosttyData,
  updateNativeGhostty,
} from '../../nativeGhosttyClient'

interface NativeGhosttyBodyProps {
  paneId: string
  ptyId: string
  cwd: string
  active: boolean
  service: ITerminalService
  onPaneReady?: NotifyPaneReady
}

export const NativeGhosttyBody = ({
  paneId,
  ptyId,
  cwd,
  active,
  service,
  onPaneReady = undefined,
}: NativeGhosttyBodyProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const frameIdRef = useRef<number | null>(null)
  const paneRef = useMemo(() => ({ sessionId: ptyId, paneId }), [paneId, ptyId])

  useEffect(() => {
    const node = containerRef.current
    if (!node || !active) {
      return
    }

    const update = async (): Promise<void> => {
      const rect = node.getBoundingClientRect()
      await updateNativeGhostty({
        ...paneRef,
        cwd,
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        visible: active,
      })
    }

    const scheduleUpdate = (): void => {
      if (frameIdRef.current !== null) {
        return
      }

      frameIdRef.current = window.requestAnimationFrame(() => {
        frameIdRef.current = null
        void update()
      })
    }

    const updateAndFocus = async (): Promise<void> => {
      await update()
      await focusNativeGhostty(paneRef)
    }

    void updateAndFocus()
    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(node)
    window.addEventListener('resize', scheduleUpdate)

    return (): void => {
      if (frameIdRef.current !== null) {
        window.cancelAnimationFrame(frameIdRef.current)
        frameIdRef.current = null
      }
      observer.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [active, cwd, paneId, paneRef, ptyId])

  useEffect(() => {
    if (!active) {
      void destroyNativeGhostty(paneRef)

      return
    }

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
  }, [active, onPaneReady, paneId, paneRef, ptyId, service])

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
