// cspell:ignore Ghostty ghostty
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from 'react'
import { listen } from '../../../../lib/backend'
import type { NotifyPaneReady, RestoreData } from '../../hooks/useTerminal'
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
  restoredFrom?: RestoreData
  onPaneReady?: NotifyPaneReady
  onCommandSubmit?: (ptyId: string, command: string) => void
  onUnavailable?: () => void
}

interface GhosttyNativeInputEvent {
  sessionId: string
  paneId: string
  data: string
}

const TERMINAL_INPUT_CONTROL_SEQUENCE_PATTERN =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

const stripTerminalInputControlSequences = (data: string): string =>
  data.replace(TERMINAL_INPUT_CONTROL_SEQUENCE_PATTERN, '')

export const GhosttyBody = ({
  paneId,
  ptyId,
  cwd,
  active,
  service,
  restoredFrom = undefined,
  onPaneReady = undefined,
  onCommandSubmit = undefined,
  onUnavailable = undefined,
}: GhosttyBodyProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const frameIdRef = useRef<number | null>(null)
  const submittedInputLineRef = useRef('')
  const paneRef = useMemo(() => ({ sessionId: ptyId, paneId }), [paneId, ptyId])
  const onCommandSubmitRef = useRef(onCommandSubmit)

  useEffect(() => {
    onCommandSubmitRef.current = onCommandSubmit
  }, [onCommandSubmit])

  const trackNativeInput = useCallback(
    (data: string): void => {
      for (const char of stripTerminalInputControlSequences(data)) {
        if (char === '\r' || char === '\n') {
          const submitted = submittedInputLineRef.current.trim()
          submittedInputLineRef.current = ''
          if (submitted.length > 0) {
            onCommandSubmitRef.current?.(ptyId, submitted)
          }

          continue
        }

        if (char === '\b' || char === '\x7f') {
          submittedInputLineRef.current = submittedInputLineRef.current.slice(
            0,
            -1
          )

          continue
        }

        if (char === '\u0003' || char === '\u0015') {
          submittedInputLineRef.current = ''

          continue
        }

        if (char < ' ' || char === '\u001b') {
          continue
        }

        submittedInputLineRef.current += char
      }
    },
    [ptyId]
  )

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

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    const attachInputListener = async (): Promise<void> => {
      const cleanup = await listen<GhosttyNativeInputEvent>(
        'ghostty-native-input',
        (payload) => {
          if (
            payload.sessionId === paneRef.sessionId &&
            payload.paneId === paneRef.paneId
          ) {
            trackNativeInput(payload.data)
          }
        }
      )

      if (cancelled) {
        cleanup()

        return
      }

      unlisten = cleanup
    }

    void attachInputListener()

    return (): void => {
      cancelled = true
      unlisten?.()
    }
  }, [paneRef, trackNativeInput])

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
      if (restoredFrom?.replayData) {
        await sendNativeGhosttyData({
          ...paneRef,
          data: restoredFrom.replayData,
        })
      }
      for (const event of restoredFrom?.bufferedEvents ?? []) {
        await sendNativeGhosttyData({ ...paneRef, data: event.data })
      }
      releasePaneReady = onPaneReady?.(ptyId, drainBufferedOutput) ?? null
    }

    void attachOutput()

    return (): void => {
      cancelled = true
      releasePaneReady?.()
      unsubscribeOutput?.()
      void destroyNativeGhostty(paneRef)
    }
  }, [onPaneReady, paneRef, ptyId, restoredFrom, service])

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
