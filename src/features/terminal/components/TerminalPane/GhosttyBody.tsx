// cspell:ignore Ghostty ghostty
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactElement,
} from 'react'
import { listen } from '../../../../lib/backend'
import { useTheme } from '../../../../theme'
import type { NotifyPaneReady, RestoreData } from '../../hooks/useTerminal'
import { registerPtySession, unregisterPtySession } from '../../ptySessionMap'
import type { ITerminalService } from '../../services/terminalService'
import {
  attachNativeGhosttyOutput,
  destroyNativeGhostty,
  focusNativeGhostty,
  sendNativeGhosttyData,
  updateNativeGhostty,
  type NativeGhosttyBounds,
  type NativeGhosttyShortcutContext,
} from '../../nativeGhosttyClient'
import {
  type AgentCwdSource,
  isDescendantPath,
  shouldIgnoreStaleOsc7Cwd,
  stripCarriageReturnOverwrites,
  toComparablePath,
} from './agentCwdGuard'
import { parseAgentCwdHint } from './agentCwdHint'
import { parseOsc7Cwd, WINDOWS_DRIVE_PATH } from './osc7'

interface GhosttyBodyProps {
  paneId: string
  ptyId: string
  cwd: string
  active: boolean
  service: ITerminalService
  restoredFrom?: RestoreData
  onCwdChange?: (cwd: string) => void
  onPaneReady?: NotifyPaneReady
  onCommandSubmit?: (ptyId: string, command: string) => void
  onRequestActive?: () => void
  onRequestFocus?: () => void
  shortcutContext?: NativeGhosttyShortcutContext
  bottomCornerRadius?: number
  onUnavailable?: () => void
}

interface GhosttyNativeInputEvent {
  sessionId: string
  paneId: string
  data: string
}

interface GhosttyNativeFocusEvent {
  sessionId: string
  paneId: string
}

const TERMINAL_INPUT_CONTROL_SEQUENCE_PATTERN =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

const AGENT_CWD_HINT_BUFFER_SIZE = 4096
const OSC7_SEQUENCE_PATTERN = /\u001b\]7;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g
// ponytail: rAF resize-tracking loop; revert to one-shot scheduling if manual Ghostty testing shows IPC churn/jitter.
const NATIVE_RESIZE_TRACKING_QUIET_MS = 120

const stripTerminalInputControlSequences = (data: string): string =>
  data.replace(TERMINAL_INPUT_CONTROL_SEQUENCE_PATTERN, '')

interface NativeGhosttyViewportMetrics {
  innerWidth: number
  innerHeight: number
  outerWidth: number
  outerHeight: number
}

interface NativeGhosttyFrameSnapshot {
  key: string
  request: Parameters<typeof updateNativeGhostty>[0]
}

const nativePointScale = (outerSize: number, innerSize: number): number =>
  Number.isFinite(outerSize) &&
  Number.isFinite(innerSize) &&
  outerSize > 0 &&
  innerSize > 0
    ? outerSize / innerSize
    : 1

export const nativeGhosttyBoundsFromRect = (
  rect: DOMRect,
  viewport: NativeGhosttyViewportMetrics = window
): NativeGhosttyBounds => {
  // getBoundingClientRect() is CSS pixels; the native NSView frame is in
  // Electron/AppKit window points. Page zoom or display scaling can make those
  // spaces differ, and unconverted x offsets drift farther in later split panes.
  const scaleX = nativePointScale(viewport.outerWidth, viewport.innerWidth)
  const scaleY = nativePointScale(viewport.outerHeight, viewport.innerHeight)

  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  }
}

export const nativeGhosttyCornerRadiusFromCssPixels = (
  radius: number,
  viewport: NativeGhosttyViewportMetrics = window
): number => radius * nativePointScale(viewport.outerWidth, viewport.innerWidth)

// Main rounds native frames before calling AppKit. Dedupe on that rounded shape
// so tiny DOM float churn does not become repeated native resize IPC.
const nativeGhosttyFrameKey = ({
  backgroundColor,
  bottomCornerRadius,
  bounds,
  parentHeight,
  shortcutContext,
  visible,
}: {
  backgroundColor: string
  bottomCornerRadius: number
  bounds: NativeGhosttyBounds
  parentHeight: number
  shortcutContext?: NativeGhosttyShortcutContext
  visible: boolean
}): string => {
  const roundedWidth = Math.round(bounds.width)
  const roundedHeight = Math.round(bounds.height)
  const frameVisible = visible && roundedWidth > 0 && roundedHeight > 0

  return [
    Math.round(bounds.x),
    Math.round(bounds.y),
    frameVisible ? roundedWidth : 0,
    frameVisible ? roundedHeight : 0,
    Math.round(parentHeight),
    frameVisible ? Math.max(0, Math.round(bottomCornerRadius)) : 0,
    frameVisible ? '1' : '0',
    backgroundColor,
    shortcutContext?.activePaneId ?? '',
    ...(shortcutContext?.paneIds ?? []),
  ].join(':')
}

const shouldPreserveOsc7FileUrlHost = (currentCwd?: string): boolean =>
  Boolean(
    currentCwd &&
    (WINDOWS_DRIVE_PATH.test(currentCwd) ||
      currentCwd.startsWith('\\\\') ||
      (currentCwd.startsWith('//') && !currentCwd.startsWith('///')))
  )

export const GhosttyBody = ({
  paneId,
  ptyId,
  cwd,
  active,
  service,
  restoredFrom = undefined,
  onCwdChange = undefined,
  onPaneReady = undefined,
  onCommandSubmit = undefined,
  onRequestActive = undefined,
  onRequestFocus = undefined,
  shortcutContext = undefined,
  bottomCornerRadius = 0,
  onUnavailable = undefined,
}: GhosttyBodyProps): ReactElement => {
  const theme = useTheme()
  const backgroundColor = theme.terminal.background
  const containerRef = useRef<HTMLDivElement | null>(null)
  const frameIdRef = useRef<number | null>(null)
  const inFlightNativeFrameRef = useRef<Promise<void> | null>(null)
  const lastSentNativeFrameKeyRef = useRef<string | null>(null)

  const queuedNativeFrameSnapshotRef =
    useRef<NativeGhosttyFrameSnapshot | null>(null)
  const resizeTrackingUntilRef = useRef(0)
  const submittedInputLineRef = useRef('')
  const agentCwdOutputBufferRef = useRef('')
  const agentCwdHintContextRef = useRef('')
  const cursorRef = useRef(restoredFrom?.replayEndOffset ?? 0)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd
  const agentCwdRef = useRef(cwd)
  const agentCwdSourceRef = useRef<AgentCwdSource>('prop')
  const paneRef = useMemo(() => ({ sessionId: ptyId, paneId }), [paneId, ptyId])
  const onCommandSubmitRef = useRef(onCommandSubmit)
  const onCwdChangeRef = useRef(onCwdChange)

  useEffect(() => {
    onCommandSubmitRef.current = onCommandSubmit
  }, [onCommandSubmit])

  useEffect(() => {
    onCwdChangeRef.current = onCwdChange
  }, [onCwdChange])

  useEffect(() => {
    registerPtySession(ptyId, ptyId, cwd)

    return (): void => unregisterPtySession(ptyId)
  }, [cwd, ptyId])

  useEffect(() => {
    if (
      toComparablePath(agentCwdRef.current) !== toComparablePath(cwd) &&
      !isDescendantPath(agentCwdRef.current, cwd)
    ) {
      agentCwdOutputBufferRef.current = ''
      agentCwdHintContextRef.current = ''
      agentCwdRef.current = cwd
      agentCwdSourceRef.current = 'prop'
    }
  }, [cwd])

  useEffect(() => {
    agentCwdOutputBufferRef.current = ''
    agentCwdHintContextRef.current = ''
    agentCwdRef.current = cwdRef.current
    agentCwdSourceRef.current = 'prop'
    cursorRef.current = restoredFrom?.replayEndOffset ?? 0
  }, [ptyId, restoredFrom?.replayEndOffset])

  const applyOsc7Cwd = useCallback((payload: string): void => {
    const previousCwd = agentCwdRef.current

    const path = parseOsc7Cwd(payload, {
      preserveFileUrlHost: shouldPreserveOsc7FileUrlHost(previousCwd),
    })

    const shouldIgnore =
      path !== null &&
      shouldIgnoreStaleOsc7Cwd(
        agentCwdRef.current,
        path,
        agentCwdSourceRef.current
      )

    if (path && path === agentCwdRef.current) {
      agentCwdSourceRef.current = 'osc7'
    } else if (path && !shouldIgnore) {
      agentCwdOutputBufferRef.current = ''
      agentCwdHintContextRef.current = ''
      agentCwdRef.current = path
      agentCwdSourceRef.current = 'osc7'
      onCwdChangeRef.current?.(path)
    }
  }, [])

  const applyAgentCwdHint = useCallback((output: string): void => {
    const visibleOutput = stripCarriageReturnOverwrites(output)
    const outputWithContext = `${agentCwdHintContextRef.current}${visibleOutput}`
    const cwdHint = parseAgentCwdHint(outputWithContext, agentCwdRef.current)

    const shouldApplyCwdHint =
      cwdHint !== null && cwdHint !== agentCwdRef.current

    agentCwdHintContextRef.current = shouldApplyCwdHint
      ? ''
      : outputWithContext.slice(-AGENT_CWD_HINT_BUFFER_SIZE)

    if (shouldApplyCwdHint) {
      agentCwdSourceRef.current = 'text-hint'
      agentCwdRef.current = cwdHint
      onCwdChangeRef.current?.(cwdHint)
    }
  }, [])

  const handleNativeOutput = useCallback(
    (data: string): void => {
      for (const match of data.matchAll(OSC7_SEQUENCE_PATTERN)) {
        applyOsc7Cwd(match[1])
      }

      const output = `${agentCwdOutputBufferRef.current}${data.replace(
        OSC7_SEQUENCE_PATTERN,
        ''
      )}`
      const lastLineBreakIndex = output.lastIndexOf('\n')

      if (lastLineBreakIndex === -1) {
        agentCwdOutputBufferRef.current = output.slice(
          -AGENT_CWD_HINT_BUFFER_SIZE
        )

        return
      }

      const completeOutput = output.slice(0, lastLineBreakIndex + 1)
      agentCwdOutputBufferRef.current = output
        .slice(lastLineBreakIndex + 1)
        .slice(-AGENT_CWD_HINT_BUFFER_SIZE)
      applyAgentCwdHint(completeOutput)
    },
    [applyAgentCwdHint, applyOsc7Cwd]
  )

  const trackNativeInput = useCallback(
    (data: string): void => {
      if (agentCwdSourceRef.current === 'text-hint') {
        agentCwdSourceRef.current = 'user-input'
      }

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

  const sendOutputToNative = useCallback(
    async (data: string): Promise<void> => {
      try {
        const enabled = await sendNativeGhosttyData({ ...paneRef, data })
        if (!enabled) {
          onUnavailable?.()
        }
      } catch {
        onUnavailable?.()
      }
    },
    [onUnavailable, paneRef]
  )

  const focusNativeSurface = useCallback(async (): Promise<void> => {
    try {
      const enabled = await focusNativeGhostty(paneRef)
      if (!enabled) {
        onUnavailable?.()
      }
    } catch {
      onUnavailable?.()
    }
  }, [onUnavailable, paneRef])

  const forwardNativeOutput = useCallback(
    (
      data: string,
      offsetStart: number,
      byteLen: number,
      sendToNative: boolean
    ): boolean => {
      if (offsetStart < cursorRef.current) {
        return false
      }

      handleNativeOutput(data)
      if (sendToNative) {
        void sendOutputToNative(data)
      }

      const writtenEnd = offsetStart + byteLen
      if (writtenEnd > cursorRef.current) {
        cursorRef.current = writtenEnd
      }

      return true
    },
    [handleNativeOutput, sendOutputToNative]
  )

  // Keep only one IPC in flight. Resize can fire faster than native can apply
  // frames, so newer snapshots replace the queued one instead of stacking calls.
  const flushQueuedNativeFrame = useCallback((): void => {
    if (inFlightNativeFrameRef.current !== null) {
      return
    }

    const snapshot = queuedNativeFrameSnapshotRef.current
    if (!snapshot) {
      return
    }

    queuedNativeFrameSnapshotRef.current = null
    lastSentNativeFrameKeyRef.current = snapshot.key

    const inFlight = (async (): Promise<void> => {
      try {
        const enabled = await updateNativeGhostty(snapshot.request)

        if (!enabled) {
          onUnavailable?.()
        }
      } catch {
        onUnavailable?.()
      }
    })()
    inFlightNativeFrameRef.current = inFlight

    void (async (): Promise<void> => {
      await inFlight
      if (inFlightNativeFrameRef.current === inFlight) {
        inFlightNativeFrameRef.current = null
      }
      flushQueuedNativeFrame()
    })()
  }, [onUnavailable])

  const updateNativeFrame = useCallback((): void => {
    const node = containerRef.current
    if (!node) {
      return
    }

    const viewport = {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
    }

    const bounds = nativeGhosttyBoundsFromRect(
      node.getBoundingClientRect(),
      viewport
    )

    const nativeBottomCornerRadius = nativeGhosttyCornerRadiusFromCssPixels(
      bottomCornerRadius,
      viewport
    )

    // AppKit flips y from the parent view height. Send the renderer's
    // same-window snapshot so top-edge live resize cannot mix old pane bounds
    // with a new height.
    const parentHeight =
      Number.isFinite(viewport.outerHeight) && viewport.outerHeight > 0
        ? viewport.outerHeight
        : viewport.innerHeight
    const visible = true

    const snapshot = {
      key: nativeGhosttyFrameKey({
        backgroundColor,
        bottomCornerRadius: nativeBottomCornerRadius,
        bounds,
        parentHeight,
        shortcutContext,
        visible,
      }),
      request: {
        ...paneRef,
        cwd,
        bounds,
        backgroundColor,
        bottomCornerRadius: nativeBottomCornerRadius,
        parentHeight,
        visible,
        ...(shortcutContext ? { shortcutContext } : {}),
      },
    }

    if (lastSentNativeFrameKeyRef.current === snapshot.key) {
      queuedNativeFrameSnapshotRef.current = null

      return
    }

    queuedNativeFrameSnapshotRef.current = snapshot
    flushQueuedNativeFrame()
  }, [
    backgroundColor,
    bottomCornerRadius,
    cwd,
    flushQueuedNativeFrame,
    paneRef,
    shortcutContext,
  ])

  const scheduleNativeFrameUpdate = useCallback((): void => {
    resizeTrackingUntilRef.current =
      Date.now() + NATIVE_RESIZE_TRACKING_QUIET_MS

    if (frameIdRef.current !== null) {
      return
    }

    const runFrameUpdate = (): void => {
      frameIdRef.current = null
      updateNativeFrame()

      if (Date.now() >= resizeTrackingUntilRef.current) {
        return
      }

      frameIdRef.current = window.requestAnimationFrame(runFrameUpdate)
    }

    frameIdRef.current = window.requestAnimationFrame(runFrameUpdate)
  }, [updateNativeFrame])

  // Keep the parented NSView aligned with the React pane:
  // 1. ResizeObserver/window resize sends one frame update immediately.
  // 2. The same signal extends a short "keep sampling" deadline.
  // 3. One rAF loop samples again until resize has been quiet long enough.
  // 4. Cleanup cancels that loop, drops the queued frame, and unregisters both
  //    the observer and window listener.
  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    const syncAndTrackNativeFrame = (): void => {
      updateNativeFrame()
      scheduleNativeFrameUpdate()
    }

    updateNativeFrame()
    const observer = new ResizeObserver(syncAndTrackNativeFrame)
    observer.observe(node)
    window.addEventListener('resize', syncAndTrackNativeFrame)

    return (): void => {
      if (frameIdRef.current !== null) {
        window.cancelAnimationFrame(frameIdRef.current)
        frameIdRef.current = null
      }
      resizeTrackingUntilRef.current = 0
      queuedNativeFrameSnapshotRef.current = null
      observer.disconnect()
      window.removeEventListener('resize', syncAndTrackNativeFrame)
    }
  }, [scheduleNativeFrameUpdate, updateNativeFrame])

  // Focus follows the active pane, but focus no longer owns surface lifetime.
  useEffect(() => {
    if (active) {
      void focusNativeSurface()
    }
  }, [active, focusNativeSurface])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    const attachFocusListener = async (): Promise<void> => {
      const cleanup = await listen<GhosttyNativeFocusEvent>(
        'ghostty-native-focus',
        (payload) => {
          if (
            payload.sessionId === paneRef.sessionId &&
            payload.paneId === paneRef.paneId
          ) {
            onRequestFocus?.()
            onRequestActive?.()
          }
        }
      )

      if (cancelled) {
        cleanup()

        return
      }

      unlisten = cleanup
    }

    void attachFocusListener()

    return (): void => {
      cancelled = true
      unlisten?.()
    }
  }, [onRequestActive, onRequestFocus, paneRef])

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

    const drainBufferedOutput = (
      data: string,
      offsetStart: number,
      byteLen: number
    ): void => {
      forwardNativeOutput(data, offsetStart, byteLen, true)
    }
    const isCancelled = (): boolean => cancelled

    const attachOutput = async (): Promise<void> => {
      const unsubscribe = await attachNativeGhosttyOutput(service, paneRef, {
        onOutput: (data, offsetStart, byteLen) =>
          forwardNativeOutput(data, offsetStart, byteLen, false),
        onUnavailable,
      })

      if (isCancelled()) {
        unsubscribe()

        return
      }

      unsubscribeOutput = unsubscribe
      if (restoredFrom?.replayData) {
        handleNativeOutput(restoredFrom.replayData)
        await sendOutputToNative(restoredFrom.replayData)
        if (isCancelled()) {
          return
        }
      }
      if (isCancelled()) {
        return
      }
      for (const event of restoredFrom?.bufferedEvents ?? []) {
        forwardNativeOutput(event.data, event.offsetStart, event.byteLen, true)
      }
      if (isCancelled()) {
        return
      }
      releasePaneReady = onPaneReady?.(ptyId, drainBufferedOutput) ?? null
    }

    void attachOutput()

    return (): void => {
      cancelled = true
      releasePaneReady?.()
      unsubscribeOutput?.()
      void (async (): Promise<void> => {
        try {
          await destroyNativeGhostty(paneRef)
        } catch {
          // Best-effort cleanup can race with Electron handler disposal.
        }
      })()
    }
  }, [
    forwardNativeOutput,
    handleNativeOutput,
    onPaneReady,
    onUnavailable,
    paneRef,
    ptyId,
    restoredFrom,
    sendOutputToNative,
    service,
  ])

  return (
    <div
      ref={containerRef}
      data-testid="native-ghostty-pane"
      className="h-full w-full"
      onFocus={(): void => {
        void focusNativeSurface()
      }}
      onMouseDown={(): void => {
        void focusNativeSurface()
      }}
      role="presentation"
      style={{ backgroundColor }}
    />
  )
}
