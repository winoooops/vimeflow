/* eslint-disable react/require-default-props */
// cspell:ignore worktree worktrees
import type { ReactElement } from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  useTerminal,
  type RestoreData,
  type NotifyPaneReady,
} from '../../hooks/useTerminal'
import { useTerminalClipboard } from '../../hooks/useTerminalClipboard'
import { type ITerminalService } from '../../services/terminalService'
import type {
  TerminalDisposable,
  TerminalFitController,
  TerminalOutputWriter,
  TerminalParserEvent,
  TerminalRendererHandle,
  TerminalSurface,
} from '../../types'
import {
  terminalCache,
  clearTerminalCache,
  disposeTerminalSession,
} from '../../terminalRegistry'
import { TERMINAL_FOCUS_SCOPE_VALUE } from '../../terminalFocusScope'
import { registerPtySession, unregisterPtySession } from '../../ptySessionMap'
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
import { loadTerminalFonts } from './terminalFont'
import { createTerminalInstance } from './terminalInstance'

const AGENT_CWD_HINT_BUFFER_SIZE = 4096

const shouldPreserveOsc7FileUrlHost = (currentCwd?: string): boolean =>
  Boolean(
    currentCwd &&
    (WINDOWS_DRIVE_PATH.test(currentCwd) ||
      currentCwd.startsWith('\\\\') ||
      (currentCwd.startsWith('//') && !currentCwd.startsWith('///')))
  )

const logAgentCwdDebug = (
  event: string,
  details: Record<string, boolean | string | null>
): void => {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') {
    return
  }

  // eslint-disable-next-line no-console
  console.info(`[vimeflow:terminal-cwd] ${event} ${JSON.stringify(details)}`)
}

const terminalStartupErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return 'Unknown terminal startup error'
}

const isRestoreParserEvent = (event: TerminalParserEvent): boolean =>
  event.output?.phase === 'restore'

export { clearTerminalCache, disposeTerminalSession, terminalCache }

export type BodyMode = 'attach' | 'spawn'

export interface BodyProps {
  /**
   * Rust PTY handle. This is the value Rust IPC calls `sessionId`; in the
   * pane model it flows from `pane.ptyId` and keys terminal cache entries.
   */
  sessionId: string

  /**
   * Current working directory for the shell
   */
  cwd: string

  /**
   * Terminal service used for PTY operations.
   *
   * Round 4, Finding 1 (codex P1): REQUIRED — must be the same instance the
   * `useSessionManager` hook receives. Previously this defaulted to a
   * `useMemo(() => createTerminalService(), ...)` per-pane fallback, which
   * worked under Tauri (singleton) but produced disjoint `MockTerminalService`
   * instances in the browser/Vite/test workflow — sessions spawned by the
   * manager never attached in the pane and close/restart calls talked to a
   * different empty service. Removing the fallback forces callers to share
   * one service via prop drilling (TerminalZone forwards it from
   * WorkspaceView).
   */
  service: ITerminalService

  /**
   * Optional shell path (defaults to system shell)
   * @default undefined
   */
  shell?: string

  /**
   * Optional environment variables
   * @default undefined
   */
  env?: Record<string, string>

  /**
   * Optional restore data for reconnecting to an existing session
   */
  restoredFrom?: RestoreData

  /**
   * Called when the shell reports a working directory change (via OSC 7)
   */
  onCwdChange?: (cwd: string) => void

  /**
   * Bridge to `useSessionManager.notifyPaneReady`. Forwarded to
   * `useTerminal`; called once the pane's live data subscription is attached
   * so the orchestrator can drain its mount-time buffer for this session.
   */
  onPaneReady?: NotifyPaneReady

  /**
   * Explicit lifecycle mode — see {@link BodyMode}.
   * @default 'spawn'
   */
  mode?: BodyMode

  /**
   * Called whenever the underlying PTY hook reports a status transition.
   */
  onPtyStatusChange?: (status: 'idle' | 'running' | 'exited' | 'error') => void

  /**
   * Called when the terminal renderer gains or loses focus.
   */
  onFocusChange?: (focused: boolean) => void

  /**
   * Defer expensive terminal fitting while surrounding layout is actively being
   * dragged. The final size is fitted when this flips back to false.
   */
  deferFit?: boolean
}

export interface BodyHandle {
  focusTerminal: () => void
}

export const Body = forwardRef<BodyHandle, BodyProps>(function Body(
  {
    sessionId,
    cwd,
    service,
    shell = undefined,
    env = undefined,
    restoredFrom = undefined,
    onCwdChange = undefined,
    onPaneReady = undefined,
    mode = 'spawn',
    onPtyStatusChange = undefined,
    onFocusChange = undefined,
    deferFit = false,
  },
  ref
): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)

  const [terminal, setTerminal] = useState<TerminalSurface | null>(null)

  const [terminalOutput, setTerminalOutput] =
    useState<TerminalOutputWriter | null>(null)

  const [terminalStartupError, setTerminalStartupError] = useState<
    string | null
  >(null)

  const fitControllerRef = useRef<TerminalFitController | null>(null)
  const deferFitRef = useRef(deferFit)
  const previousDeferFitRef = useRef(deferFit)
  const cancelScheduledFitRef = useRef<(() => void) | null>(null)
  const flushFitRef = useRef<(() => void) | null>(null)
  const flushFitSessionIdRef = useRef<string | null>(null)
  const pendingDeferredFitFlushRef = useRef(false)
  const pendingDeferredRefreshAfterFitRef = useRef(false)
  const agentCwdOutputBufferRef = useRef('')
  const agentCwdHintContextRef = useRef('')
  const isRestoringOutputRef = useRef(false)
  const cwdPropRef = useRef(cwd)
  const agentCwdRef = useRef(cwd)
  const agentCwdSourceRef = useRef<AgentCwdSource>('prop')
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const terminalStatusRef = useRef<'idle' | 'running' | 'exited' | 'error'>(
    'idle'
  )

  // Store callbacks in refs to avoid terminal recreation when they change
  const onCwdChangeRef = useRef(onCwdChange)
  useEffect(() => {
    onCwdChangeRef.current = onCwdChange
  }, [onCwdChange])

  useEffect(() => {
    const previousCwd = agentCwdRef.current

    cwdPropRef.current = cwd
    if (
      toComparablePath(agentCwdRef.current) !== toComparablePath(cwd) &&
      !isDescendantPath(agentCwdRef.current, cwd)
    ) {
      agentCwdOutputBufferRef.current = ''
      agentCwdHintContextRef.current = ''
      agentCwdRef.current = cwd
      agentCwdSourceRef.current = 'prop'
    }

    logAgentCwdDebug('prop-cwd', {
      sessionId,
      previousCwd,
      propCwd: cwd,
      agentCwd: agentCwdRef.current,
      changed: previousCwd !== agentCwdRef.current,
    })
  }, [cwd, sessionId])

  useEffect(() => {
    agentCwdOutputBufferRef.current = ''
    agentCwdHintContextRef.current = ''
    isRestoringOutputRef.current = false
    agentCwdRef.current = cwdPropRef.current
    agentCwdSourceRef.current = 'prop'
  }, [sessionId])

  const applyAgentCwdHint = useCallback((output: string): void => {
    const previousCwd = agentCwdRef.current
    const visibleOutput = stripCarriageReturnOverwrites(output)
    const outputWithContext = `${agentCwdHintContextRef.current}${visibleOutput}`
    const cwdHint = parseAgentCwdHint(outputWithContext, previousCwd)

    const shouldApplyCwdHint =
      cwdHint !== null && cwdHint !== agentCwdRef.current

    // Carry the last `AGENT_CWD_HINT_BUFFER_SIZE` bytes of output forward
    // so anchor patterns whose path arrives in a later PTY chunk can still
    // match. The raw tail is a strict superset of what
    // `getAgentCwdHintContext` would yield (a filtered subset of the same
    // buffer), so we just persist the tail directly — there's no separate
    // startup-context union to maintain. `isClaudeStartupHomeCwd` sees
    // the same header when the banner is within the trailing 4 KB.
    if (shouldApplyCwdHint) {
      agentCwdHintContextRef.current = ''
    } else {
      agentCwdHintContextRef.current = outputWithContext.slice(
        -AGENT_CWD_HINT_BUFFER_SIZE
      )
    }

    if (cwdHint !== null) {
      logAgentCwdDebug('text-hint', {
        sessionId: sessionIdRef.current,
        previousCwd,
        nextCwd: cwdHint,
        changed: cwdHint !== previousCwd,
      })

      if (shouldApplyCwdHint) {
        agentCwdSourceRef.current = 'text-hint'
        agentCwdRef.current = cwdHint
        onCwdChangeRef.current?.(cwdHint)
      }
    }
  }, [])

  const flushAgentCwdOutputBuffer = useCallback((): void => {
    const pendingOutput = agentCwdOutputBufferRef.current
    if (!pendingOutput) {
      return
    }

    agentCwdOutputBufferRef.current = ''
    applyAgentCwdHint(`${pendingOutput}\r\n`)
  }, [applyAgentCwdHint])

  const handleTerminalOutput = useCallback(
    (data: string): void => {
      const output = `${agentCwdOutputBufferRef.current}${data}`

      const lastLineBreakIndex = output.lastIndexOf('\n')

      if (lastLineBreakIndex === -1) {
        agentCwdOutputBufferRef.current = output.slice(
          -AGENT_CWD_HINT_BUFFER_SIZE
        )

        if (
          terminalStatusRef.current === 'exited' ||
          terminalStatusRef.current === 'error'
        ) {
          flushAgentCwdOutputBuffer()
        }

        return
      }

      const completeOutput = output.slice(0, lastLineBreakIndex + 1)
      agentCwdOutputBufferRef.current = output
        .slice(lastLineBreakIndex + 1)
        .slice(-AGENT_CWD_HINT_BUFFER_SIZE)
      applyAgentCwdHint(completeOutput)

      if (
        terminalStatusRef.current === 'exited' ||
        terminalStatusRef.current === 'error'
      ) {
        flushAgentCwdOutputBuffer()
      }
    },
    [applyAgentCwdHint, flushAgentCwdOutputBuffer]
  )

  const handleTerminalInput = useCallback((): void => {
    if (agentCwdSourceRef.current !== 'text-hint') {
      return
    }

    agentCwdSourceRef.current = 'user-input'
    logAgentCwdDebug('user-input', {
      sessionId,
      agentCwd: agentCwdRef.current,
      unlocked: true,
    })
  }, [sessionId])

  const handleRestoreStart = useCallback((): void => {
    isRestoringOutputRef.current = true
  }, [])

  const handleRestoreEnd = useCallback((): void => {
    isRestoringOutputRef.current = false
  }, [])

  // Use terminal hook for PTY lifecycle management
  const {
    session: ptySession,
    resize,
    status,
  } = useTerminal({
    terminal,
    output: terminalOutput,
    service,
    cwd,
    shell,
    env,
    restoredFrom,
    onPaneReady,
    onOutput: handleTerminalOutput,
    onRestoreStart: handleRestoreStart,
    onRestoreEnd: handleRestoreEnd,
    onInput: handleTerminalInput,
    mode,
  })
  terminalStatusRef.current = status

  // Bridge workspace sessionId ↔ PTY sessionId for agent detection.
  // Use the PTY session's resolved cwd (absolute path from Rust),
  // not the prop cwd which may be "~".
  useEffect(() => {
    if (ptySession?.id) {
      registerPtySession(sessionId, ptySession.id, ptySession.cwd)
    }

    return (): void => {
      unregisterPtySession(sessionId)
    }
  }, [sessionId, ptySession?.id, ptySession?.cwd])

  // P1 Fix: Store resize callback in ref to avoid terminal recreation when it changes
  const resizeRef = useRef(resize)

  // Keep ref up to date
  useEffect(() => {
    resizeRef.current = resize
  }, [resize])

  const onPtyStatusChangeRef = useRef(onPtyStatusChange)
  const onFocusChangeRef = useRef(onFocusChange)

  useEffect(() => {
    onPtyStatusChangeRef.current = onPtyStatusChange
  }, [onPtyStatusChange])

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange
  }, [onFocusChange])

  useEffect(() => {
    onPtyStatusChangeRef.current?.(status)
  }, [status])

  useEffect(() => {
    if (status !== 'exited' && status !== 'error') {
      return
    }

    flushAgentCwdOutputBuffer()
  }, [flushAgentCwdOutputBuffer, status])

  useLayoutEffect(() => {
    const wasDeferred = previousDeferFitRef.current

    deferFitRef.current = deferFit

    if (!wasDeferred && deferFit) {
      cancelScheduledFitRef.current?.()
    } else if (wasDeferred && !deferFit) {
      const flushFit = flushFitRef.current

      if (flushFit && flushFitSessionIdRef.current === sessionId) {
        flushFit()
      } else {
        pendingDeferredFitFlushRef.current = true
      }
    }

    previousDeferFitRef.current = deferFit
  }, [deferFit, sessionId])

  useImperativeHandle(
    ref,
    () => ({
      focusTerminal: (): void => {
        const cached = terminalCache.get(sessionId)
        cached?.terminal.focus()
      },
    }),
    [sessionId]
  )

  // P2 Fix: Send resize when terminal is created AND when session becomes running
  // The initial resize effect runs immediately when terminal is created, but resize()
  // is a no-op until the session is actually spawned and status becomes 'running'.
  // By including status in dependencies, we re-trigger resize when the session transitions.
  useEffect(() => {
    if (terminal && status === 'running') {
      resize(terminal.cols, terminal.rows)
    }
  }, [terminal, resize, status])

  // P2 Fix: Terminal instance management with caching.
  // Terminals persist when switching sessions to avoid killing PTY processes.
  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    // Check if we already have a terminal for this session
    const cached = terminalCache.get(sessionId)
    let newTerminal: TerminalSurface | null = null
    let newTerminalOutput: TerminalOutputWriter | null = null
    let fitController: TerminalFitController | null = null
    let parserEventDisposable: TerminalDisposable | null = null
    let rendererHandle: TerminalRendererHandle | null = null
    let fitFrameId: number | null = null
    let lastFitSize: { width: number; height: number } | null = null
    let resizeDisposable: TerminalDisposable | null = null
    let resizeObserver: ResizeObserver | null = null
    let removeFocusListeners: (() => void) | null = null
    let removeVisibilityListeners: (() => void) | null = null
    let disposed = false

    const cancelScheduledFit = (): void => {
      if (fitFrameId !== null) {
        window.cancelAnimationFrame(fitFrameId)
        fitFrameId = null
      }
    }

    const fitIfNeeded = (
      targetFitController: TerminalFitController,
      force = false
    ): boolean => {
      const width = node.offsetWidth
      const height = node.offsetHeight

      if (width <= 0) {
        return false
      }

      if (
        !force &&
        lastFitSize !== null &&
        lastFitSize.width === width &&
        lastFitSize.height === height
      ) {
        return false
      }

      lastFitSize = { width, height }
      targetFitController.fit()

      return true
    }

    const scheduleFit = (targetFitController: TerminalFitController): void => {
      if (deferFitRef.current) {
        return
      }

      if (fitFrameId !== null) {
        return
      }

      fitFrameId = window.requestAnimationFrame(() => {
        fitFrameId = null
        if (deferFitRef.current) {
          return
        }
        fitIfNeeded(targetFitController)
      })
    }

    const flushFit = (
      targetFitController: TerminalFitController,
      options: { force?: boolean; afterFit?: () => void } = {}
    ): void => {
      cancelScheduledFit()

      const flushWithRetry = (): void => {
        fitFrameId = window.requestAnimationFrame(() => {
          fitFrameId = null
          if (deferFitRef.current) {
            return
          }
          const width = node.offsetWidth

          const didFit = fitIfNeeded(
            targetFitController,
            options.force ?? false
          )

          if (!didFit && width <= 0 && options.afterFit) {
            flushWithRetry()

            return
          }
          if (didFit) {
            options.afterFit?.()
          }
        })
      }

      flushWithRetry()
    }

    const fitInitialWhenReady = (
      targetFitController: TerminalFitController
    ): boolean => {
      if (deferFitRef.current) {
        return false
      }

      return fitIfNeeded(targetFitController, true)
    }

    const startTerminal = async (): Promise<void> => {
      setTerminalStartupError(null)

      try {
        let didInitialFit = false

        if (cached) {
          // Reuse existing terminal from cache
          newTerminal = cached.terminal
          newTerminalOutput = cached.output
          fitController = cached.fitController
          fitControllerRef.current = fitController

          // Re-open terminal in the new container
          newTerminal.open(node)

          // Re-fit to new container — guard against hidden (display:none) containers
          // where offsetWidth is 0. Fitting at zero width tells the renderer cols≈1,
          // which causes the PTY to re-wrap scrollback into a narrow column.
          didInitialFit = fitInitialWhenReady(fitController)
        } else {
          const created = await createTerminalInstance()

          if (disposed) {
            created.terminal.dispose()

            return
          }

          newTerminal = created.terminal
          newTerminalOutput = created.output
          fitController = created.fitController
          fitControllerRef.current = fitController

          // Open terminal in container before adapter-specific renderer addons
          // attach to DOM/canvas elements.
          newTerminal.open(node)

          rendererHandle = created.attachRenderer()

          // Fit terminal to container — guard against hidden (display:none) containers
          didInitialFit = fitInitialWhenReady(fitController)

          // Subscribe to parser events for cwd tracking. Shell prompts and
          // agent/tool output both arrive through the renderer parser, so this
          // stays pane-local while remaining adapter-neutral.
          parserEventDisposable = created.parser.onEvent((event) => {
            const previousCwd = agentCwdRef.current

            const path = parseOsc7Cwd(event.uri, {
              preserveFileUrlHost: shouldPreserveOsc7FileUrlHost(previousCwd),
            })

            const shouldSuppressRestoreOsc7 =
              isRestoreParserEvent(event) || isRestoringOutputRef.current

            const shouldIgnore =
              path !== null &&
              !shouldSuppressRestoreOsc7 &&
              shouldIgnoreStaleOsc7Cwd(
                agentCwdRef.current,
                path,
                agentCwdSourceRef.current
              )

            logAgentCwdDebug('osc7', {
              sessionId,
              raw: event.uri,
              previousCwd,
              nextCwd: path,
              changed: path !== null && path !== previousCwd,
              ignored: shouldIgnore || shouldSuppressRestoreOsc7,
            })

            if (shouldSuppressRestoreOsc7) {
              return
            }

            if (path && path === agentCwdRef.current) {
              agentCwdSourceRef.current = 'osc7'
            } else if (path && !shouldIgnore) {
              agentCwdOutputBufferRef.current = ''
              agentCwdHintContextRef.current = ''
              agentCwdRef.current = path
              agentCwdSourceRef.current = 'osc7'
              onCwdChangeRef.current?.(path)
            }
          })

          // Cache the terminal instance for this session
          terminalCache.set(sessionId, {
            terminal: newTerminal,
            output: newTerminalOutput,
            fitController,
            viewportReader: created.viewportReader,
          })
        }

        const terminalForSetup = newTerminal
        const fitControllerForSetup = fitController

        const refreshAfterFontFit = (): void => {
          terminalForSetup.refresh(0, Math.max(terminalForSetup.rows - 1, 0))
        }

        const clearPendingDeferredFit = (): void => {
          pendingDeferredFitFlushRef.current = false
          pendingDeferredRefreshAfterFitRef.current = false
        }

        const refitAfterTerminalFontsSettle = (): void => {
          if (disposed) {
            return
          }

          lastFitSize = null

          if (deferFitRef.current) {
            pendingDeferredFitFlushRef.current = true
            pendingDeferredRefreshAfterFitRef.current = true

            return
          }

          pendingDeferredRefreshAfterFitRef.current = true
          flushFit(fitControllerForSetup, {
            force: true,
            afterFit: (): void => {
              clearPendingDeferredFit()
              refreshAfterFontFit()
            },
          })
        }

        const refitWhenTerminalFontsSettle = async (): Promise<void> => {
          const terminalFontsLoaded = loadTerminalFonts()

          if (!terminalFontsLoaded) {
            return
          }

          try {
            await terminalFontsLoaded
          } catch {
            // Fall back to the available system stack, then remeasure whatever loaded.
          }

          refitAfterTerminalFontsSettle()
        }

        if (!cached) {
          void refitWhenTerminalFontsSettle()
        }

        const flushDeferredFit = (): void => {
          if (pendingDeferredRefreshAfterFitRef.current) {
            pendingDeferredFitFlushRef.current = false
            flushFit(fitControllerForSetup, {
              force: true,
              afterFit: (): void => {
                clearPendingDeferredFit()
                refreshAfterFontFit()
              },
            })

            return
          }

          pendingDeferredFitFlushRef.current = false
          flushFit(fitControllerForSetup)
        }

        const refreshAfterPendingInitialFit = (): void => {
          if (!pendingDeferredRefreshAfterFitRef.current) {
            pendingDeferredFitFlushRef.current = false

            return
          }

          clearPendingDeferredFit()
          refreshAfterFontFit()
        }

        cancelScheduledFitRef.current = cancelScheduledFit
        flushFitRef.current = flushDeferredFit
        flushFitSessionIdRef.current = sessionId

        if (
          (pendingDeferredFitFlushRef.current ||
            pendingDeferredRefreshAfterFitRef.current) &&
          !deferFitRef.current
        ) {
          if (!didInitialFit) {
            flushDeferredFit()
          } else {
            refreshAfterPendingInitialFit()
          }
        }

        // Send initial terminal size to PTY (avoids default 80×24 when terminal is actually larger)
        // This will be a no-op on first render but ensures PTY gets correct size on subsequent recreations
        resizeRef.current(terminalForSetup.cols, terminalForSetup.rows)

        // Handle resize events - notify PTY of terminal size changes.
        // The cols/rows from the terminal's onResize event are already correct because
        // fitController.fit() (the trigger upstream) has already computed and applied
        // them. Calling fit() again here would re-measure the container — pure
        // overhead during rapid sidebar drag / window resize. Just forward to PTY.
        let lastForwardedResize: { cols: number; rows: number } | null = null

        resizeDisposable = terminalForSetup.onResize(({ cols, rows }) => {
          // Guard: don't forward resize when container is hidden (display:none).
          // Otherwise the PTY receives cols≈1 and re-wraps scrollback.
          const width = containerRef.current?.offsetWidth ?? 0
          if (width <= 0) {
            return
          }

          if (
            lastForwardedResize?.cols === cols &&
            lastForwardedResize.rows === rows
          ) {
            return
          }

          lastForwardedResize = { cols, rows }

          // Notify PTY service of size change using ref (stable across renders)
          resizeRef.current(cols, rows)
        })

        const handleFocusIn = (): void => {
          onFocusChangeRef.current?.(true)
        }

        const handleFocusOut = (): void => {
          onFocusChangeRef.current?.(false)
        }

        node.addEventListener('focusin', handleFocusIn)
        node.addEventListener('focusout', handleFocusOut)
        removeFocusListeners = (): void => {
          node.removeEventListener('focusin', handleFocusIn)
          node.removeEventListener('focusout', handleFocusOut)
        }

        // Root cause B (Claude + Codex consensus): the terminal renders on a debounced
        // animation-frame loop and never forces a repaint when the OS window
        // regains focus or visibility. The browser throttles that loop while the
        // window is covered or unfocused, so rows that streamed in while we were
        // away stay stale until something forces a repaint (the buffer is correct
        // — a text selection fixes only the pixels). Repaint on focus/visibility
        // recovery to flush them.
        const repaintOnWindowVisible = (): void => {
          if (document.visibilityState !== 'visible') {
            return
          }

          terminalForSetup.refresh(0, Math.max(terminalForSetup.rows - 1, 0))
        }

        window.addEventListener('focus', repaintOnWindowVisible)
        document.addEventListener('visibilitychange', repaintOnWindowVisible)
        removeVisibilityListeners = (): void => {
          window.removeEventListener('focus', repaintOnWindowVisible)
          document.removeEventListener(
            'visibilitychange',
            repaintOnWindowVisible
          )
        }

        // P2 Fix: Add ResizeObserver to detect container size changes
        // When the container resizes (e.g., window resize, panel collapse),
        // fit the terminal which will trigger the onResize event above.
        // Guard: skip fit when container is hidden (display:none → width=0)
        // to avoid PTY scrollback re-wrapping at a narrow column count.
        resizeObserver = new ResizeObserver(() => {
          scheduleFit(fitControllerForSetup)
        })
        resizeObserver.observe(node)

        // Store terminal in state to trigger useTerminal hook
        setTerminal(terminalForSetup)
        setTerminalOutput(newTerminalOutput)
      } catch (error) {
        if (disposed) {
          return
        }

        parserEventDisposable?.dispose()
        parserEventDisposable = null

        rendererHandle?.dispose()
        rendererHandle = null

        const entry = terminalCache.get(sessionId)
        if (entry?.terminal === newTerminal) {
          entry.terminal.dispose()
          terminalCache.delete(sessionId)
        } else {
          newTerminal?.dispose()
        }

        newTerminal = null
        newTerminalOutput = null
        fitController = null
        fitControllerRef.current = null
        setTerminal(null)
        setTerminalOutput(null)
        setTerminalStartupError(terminalStartupErrorMessage(error))
      }
    }

    void startTerminal()

    // Cleanup: disconnect observers and dispose terminal from cache
    // When Body unmounts, the session is closed — free resources
    return (): void => {
      disposed = true
      pendingDeferredFitFlushRef.current = false
      pendingDeferredRefreshAfterFitRef.current = false
      cancelScheduledFit()
      if (flushFitSessionIdRef.current === sessionId) {
        cancelScheduledFitRef.current = null
        flushFitRef.current = null
        flushFitSessionIdRef.current = null
      }
      resizeObserver?.disconnect()
      resizeObserver = null
      resizeDisposable?.dispose()
      resizeDisposable = null
      removeFocusListeners?.()
      removeFocusListeners = null
      removeVisibilityListeners?.()
      removeVisibilityListeners = null
      parserEventDisposable?.dispose()
      parserEventDisposable = null
      // Renderer addons must dispose before the terminal itself; the handle
      // owns that adapter-specific ordering.
      rendererHandle?.dispose()
      rendererHandle = null
      const entry = terminalCache.get(sessionId)
      if (entry) {
        entry.terminal.dispose()
        terminalCache.delete(sessionId)
      } else {
        newTerminal?.dispose()
      }
      newTerminal = null
      newTerminalOutput = null
      fitController = null
      setTerminal(null)
      setTerminalOutput(null)
      fitControllerRef.current = null
    }
  }, [sessionId])

  const clipboard = useTerminalClipboard({
    terminal,
    // TODO: surface clipboard failures via a visible status/error channel.
    onCopyError: (): void => undefined,
    onPasteError: (): void => undefined,
  })

  return (
    <div
      data-testid="terminal-pane-body-wrapper"
      className="terminal-pane-body relative h-full w-full overflow-hidden"
    >
      <div
        ref={containerRef}
        data-testid="terminal-pane"
        data-pty-id={sessionId}
        data-terminal-focus-scope={TERMINAL_FOCUS_SCOPE_VALUE}
        className="h-full w-full"
      />
      {terminalStartupError ? (
        <div
          role="alert"
          data-testid="terminal-startup-error"
          className="absolute inset-0 grid place-items-center bg-surface-container-lowest/85 px-6 text-center"
        >
          <div className="max-w-[34rem] rounded-[8px] bg-surface-container/90 px-4 py-3 shadow-[0_16px_44px_color-mix(in_srgb,var(--color-scrim)_35%,transparent)]">
            <p className="text-[12px] font-medium text-error">
              Terminal failed to start
            </p>
            <p className="mt-1 break-words font-mono text-[11px] text-on-surface-muted">
              {terminalStartupError}
            </p>
          </div>
        </div>
      ) : null}
      <TerminalContextMenu
        isOpen={clipboard.isOpen}
        position={clipboard.openAt}
        onClose={clipboard.close}
        onCopy={(): void => {
          void clipboard.copy()
        }}
        onPaste={(): void => {
          void clipboard.paste()
        }}
        canCopy={clipboard.hasSelection}
      />
    </div>
  )
})
