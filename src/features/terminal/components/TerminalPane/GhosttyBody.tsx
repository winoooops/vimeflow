// cspell:ignore Ghostty ghostty
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { listen } from '../../../../lib/backend'
import type { NotifyPaneReady, RestoreData } from '../../hooks/useTerminal'
import { registerPtySession, unregisterPtySession } from '../../ptySessionMap'
import type { ITerminalService } from '../../services/terminalService'
import {
  attachNativeGhosttyOutput,
  destroyNativeGhostty,
  focusNativeGhostty,
  sendNativeGhosttyData,
  updateNativeGhostty,
  type NativeGhosttyShortcutContext,
} from '../../nativeGhosttyClient'
import { TerminalContextMenu } from '../TerminalContextMenu'
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
  onUnavailable?: () => void
}

interface GhosttyNativeInputEvent {
  sessionId: string
  paneId: string
  data: string
}

interface GhosttyNativeContextMenuEvent {
  sessionId: string
  paneId: string
  x: number
  y: number
}

interface GhosttyNativeFocusEvent {
  sessionId: string
  paneId: string
}

const TERMINAL_INPUT_CONTROL_SEQUENCE_PATTERN =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

const AGENT_CWD_HINT_BUFFER_SIZE = 4096
const NATIVE_CONTEXT_CAN_COPY = false
const NATIVE_CONTEXT_CAN_PASTE_IMAGE = false
const NATIVE_CONTEXT_SHOW_PASTE_IMAGE = false
const OSC7_SEQUENCE_PATTERN = /\u001b\]7;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g

const clampContextMenuPosition = (position: {
  x: number
  y: number
}): { x: number; y: number } => ({
  x: Math.min(Math.max(0, position.x), Math.max(0, window.innerWidth - 1)),
  y: Math.min(Math.max(0, position.y), Math.max(0, window.innerHeight - 1)),
})

const stripTerminalInputControlSequences = (data: string): string =>
  data.replace(TERMINAL_INPUT_CONTROL_SEQUENCE_PATTERN, '')

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
  onUnavailable = undefined,
}: GhosttyBodyProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const frameIdRef = useRef<number | null>(null)
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

  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number
    y: number
  } | null>(null)

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

  const closeContextMenu = useCallback((): void => {
    setContextMenuPosition(null)
  }, [])

  const pasteClipboard = useCallback(async (): Promise<void> => {
    const clipboard = window.navigator.clipboard as
      | { readText?: () => Promise<string> }
      | undefined
    let text = ''
    try {
      text = (await clipboard?.readText?.()) ?? ''
    } catch {
      return
    }

    if (!text) {
      return
    }

    await service.write({ sessionId: ptyId, data: text })
    trackNativeInput(text)
  }, [ptyId, service, trackNativeInput])

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
        ...(shortcutContext ? { shortcutContext } : {}),
      })

      if (!enabled) {
        onUnavailable?.()
      }
    } catch {
      onUnavailable?.()
    }
  }, [cwd, onUnavailable, paneRef, shortcutContext])

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

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | null = null

    const attachContextMenuListener = async (): Promise<void> => {
      const cleanup = await listen<GhosttyNativeContextMenuEvent>(
        'ghostty-native-context-menu',
        (payload) => {
          if (
            payload.sessionId === paneRef.sessionId &&
            payload.paneId === paneRef.paneId
          ) {
            setContextMenuPosition(clampContextMenuPosition(payload))
          }
        }
      )

      if (cancelled) {
        cleanup()

        return
      }

      unlisten = cleanup
    }

    void attachContextMenuListener()

    return (): void => {
      cancelled = true
      unlisten?.()
    }
  }, [paneRef])

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
    <>
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
        style={{ background: 'var(--color-surface)' }}
      />
      <TerminalContextMenu
        isOpen={contextMenuPosition !== null}
        position={contextMenuPosition}
        onClose={closeContextMenu}
        onCopy={(): void => undefined}
        onPaste={(): void => {
          void pasteClipboard()
        }}
        onPasteImage={(): void => undefined}
        canCopy={NATIVE_CONTEXT_CAN_COPY}
        canPasteImage={NATIVE_CONTEXT_CAN_PASTE_IMAGE}
        showPasteImage={NATIVE_CONTEXT_SHOW_PASTE_IMAGE}
      />
    </>
  )
}
