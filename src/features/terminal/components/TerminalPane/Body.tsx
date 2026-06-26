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
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
// WebGL→Canvas2D→DOM renderer chain keeps customGlyphs active for block-element glyphs (see PR #228).
import '@wterm/dom/css'
import { themeService } from '../../../../theme'
import { toXtermTheme } from '../../theme/toXtermTheme'
import {
  useTerminal,
  type RestoreData,
  type NotifyPaneReady,
  type TerminalIo,
} from '../../hooks/useTerminal'
import { useTerminalClipboard } from '../../hooks/useTerminalClipboard'
import { type ITerminalService } from '../../services/terminalService'
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
import {
  createOsc7CwdExtractor,
  parseOsc7Cwd,
  WINDOWS_DRIVE_PATH,
} from './osc7'
import {
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  loadTerminalFonts,
} from './terminalFont'
import {
  resolveDefaultTerminalRendererMode,
  type TerminalRendererMode,
} from './terminalRendererMode'
import {
  createWtermGhosttyTerminal,
  type WtermGhosttyTerminal,
} from './wtermGhosttyTerminal'
import '@xterm/xterm/css/xterm.css'

const AGENT_CWD_HINT_BUFFER_SIZE = 4096

const TERMINAL_INPUT_CONTROL_SEQUENCE_PATTERN =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

const stripTerminalInputControlSequences = (data: string): string =>
  data.replace(TERMINAL_INPUT_CONTROL_SEQUENCE_PATTERN, '')

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

// Module-level cache of terminal instances per sessionId.
//
// HISTORICAL NOTE (corrected 2026-05-09): the original comment claimed
// this cache "allows terminals to persist when switching between
// sessions". That's not what makes tab switching work today —
// `TerminalZone` always-renders inactive panes and hides them via
// CSS `display: none` rather than unmount/remount, so Body never
// unmounts on a tab switch and the cache hit/miss branch in the mount
// effect is not the persistence mechanism. Body's stable mount is.
//
// What the cache actually serves:
//   - the imperative `focusTerminal()` handle, which reads
//     `terminalCache.get(sessionId)?.terminal.focus()` to focus xterm
//     without reaching into Body's internals;
//   - tests + the existing public `clearTerminalCache` /
//     `disposeTerminalSession` API surface (preserved per the step-4
//     migration spec — external imports would break otherwise).
//
// New internal code should NOT add to the cache for "tab persistence"
// reasons; xterm lifetime is scoped to Body's mount.
export const terminalCache = new Map<
  string,
  { terminal: Terminal; fitAddon: FitAddon }
>()

export const wtermTerminalCache = new Map<
  string,
  { terminal: WtermGhosttyTerminal }
>()

/**
 * Clear terminal cache (for testing only)
 */
export const clearTerminalCache = (): void => {
  terminalCache.forEach(({ terminal }) => terminal.dispose())
  terminalCache.clear()
  wtermTerminalCache.forEach(({ terminal }) => terminal.destroy())
  wtermTerminalCache.clear()
}

/**
 * Dispose and remove a single session's terminal from cache.
 * Call when a session is permanently closed (not just hidden).
 */
export const disposeTerminalSession = (sessionId: string): void => {
  const cached = terminalCache.get(sessionId)
  if (cached) {
    cached.terminal.dispose()
    terminalCache.delete(sessionId)
  }
  const cachedWterm = wtermTerminalCache.get(sessionId)
  if (cachedWterm) {
    cachedWterm.terminal.destroy()
    wtermTerminalCache.delete(sessionId)
  }
}

export type BodyMode = 'attach' | 'spawn'

export interface BodyProps {
  /**
   * Rust PTY handle. This is the value Rust IPC calls `sessionId`; in the
   * pane model it flows from `pane.ptyId` and keys xterm cache entries.
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
   * Called when the user submits a full terminal command line.
   */
  onCommandSubmit?: (ptyId: string, command: string) => void

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
   * Called when xterm gains or loses focus.
   */
  onFocusChange?: (focused: boolean) => void

  /**
   * Defer expensive xterm fitting while surrounding layout is actively being
   * dragged. The final size is fitted when this flips back to false.
   */
  deferFit?: boolean

  /**
   * Enables coding-agent-only clipboard image paste controls.
   */
  enableImagePaste?: boolean

  /**
   * Renderer selection override, mainly for tests and emergency fallback.
   */
  rendererMode?: TerminalRendererMode
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
    onCommandSubmit = undefined,
    mode = 'spawn',
    onPtyStatusChange = undefined,
    onFocusChange = undefined,
    deferFit = false,
    enableImagePaste = false,
    rendererMode = undefined,
  },
  ref
): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)

  const initialRendererModeRef = useRef<TerminalRendererMode>(
    rendererMode ?? resolveDefaultTerminalRendererMode()
  )

  const [activeRendererMode, setActiveRendererMode] =
    useState<TerminalRendererMode>(initialRendererModeRef.current)
  const [terminal, setTerminal] = useState<TerminalIo | null>(null)
  const [xtermTerminal, setXtermTerminal] = useState<Terminal | null>(null)
  const osc7CwdExtractorRef = useRef(createOsc7CwdExtractor())
  const fitAddonRef = useRef<FitAddon | null>(null)
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
  const submittedInputLineRef = useRef('')
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

  const onCommandSubmitRef = useRef(onCommandSubmit)
  useEffect(() => {
    onCommandSubmitRef.current = onCommandSubmit
  }, [onCommandSubmit])

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

  const applyOsc7Cwd = useCallback((raw: string): void => {
    const previousCwd = agentCwdRef.current

    const path = parseOsc7Cwd(raw, {
      preserveFileUrlHost: shouldPreserveOsc7FileUrlHost(previousCwd),
    })

    const shouldSuppressRestoreOsc7 = isRestoringOutputRef.current

    const shouldIgnore =
      path !== null &&
      !shouldSuppressRestoreOsc7 &&
      shouldIgnoreStaleOsc7Cwd(
        agentCwdRef.current,
        path,
        agentCwdSourceRef.current
      )

    logAgentCwdDebug('osc7', {
      sessionId: sessionIdRef.current,
      raw,
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
  }, [])

  const handleTerminalOutput = useCallback(
    (data: string): void => {
      if (activeRendererMode !== 'xterm') {
        osc7CwdExtractorRef.current.push(data).forEach(applyOsc7Cwd)
      }

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
    [
      activeRendererMode,
      applyAgentCwdHint,
      applyOsc7Cwd,
      flushAgentCwdOutputBuffer,
    ]
  )

  const handleTerminalInput = useCallback(
    (data: string): void => {
      if (agentCwdSourceRef.current !== 'text-hint') {
        // Continue below; command submission still needs to be tracked even when
        // the cwd hint guard has nothing to unlock.
      } else {
        agentCwdSourceRef.current = 'user-input'
        logAgentCwdDebug('user-input', {
          sessionId,
          agentCwd: agentCwdRef.current,
          unlocked: true,
        })
      }

      for (const char of stripTerminalInputControlSequences(data)) {
        if (char === '\r' || char === '\n') {
          const submitted = submittedInputLineRef.current.trim()
          submittedInputLineRef.current = ''
          if (submitted.length > 0) {
            onCommandSubmitRef.current?.(sessionIdRef.current, submitted)
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
    [sessionId]
  )

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
        if (cached) {
          cached.terminal.focus()

          return
        }

        wtermTerminalCache.get(sessionId)?.terminal.focus()
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

  useEffect(() => {
    setActiveRendererMode(rendererMode ?? resolveDefaultTerminalRendererMode())
  }, [rendererMode])

  useEffect(() => {
    osc7CwdExtractorRef.current.reset()
  }, [activeRendererMode, sessionId])

  useEffect(() => {
    service.setRawDataConsumer?.(
      sessionId,
      activeRendererMode === 'ghostty-wasm'
    )

    return (): void => {
      service.setRawDataConsumer?.(sessionId, false)
    }
  }, [activeRendererMode, service, sessionId])

  // P2 Fix: Terminal instance management with caching.
  // Terminals persist when switching sessions to avoid killing PTY processes.
  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    if (activeRendererMode === 'ghostty-wasm') {
      let disposed = false
      let lastAutoResize: { cols: number; rows: number } | null = null

      const handleFocusIn = (): void => {
        onFocusChangeRef.current?.(true)
      }

      const handleFocusOut = (): void => {
        onFocusChangeRef.current?.(false)
      }

      node.addEventListener('focusin', handleFocusIn)
      node.addEventListener('focusout', handleFocusOut)

      const initializeWasmTerminal = async (): Promise<void> => {
        try {
          const newTerminal = await createWtermGhosttyTerminal({
            element: node,
            cols: 80,
            rows: 24,
            theme: themeService.current().terminal,
            onResize: (cols, rows): void => {
              if (node.offsetWidth <= 0 || node.offsetHeight <= 0) {
                return
              }

              if (
                lastAutoResize?.cols === cols &&
                lastAutoResize.rows === rows
              ) {
                return
              }

              lastAutoResize = { cols, rows }
              resizeRef.current(cols, rows)
            },
          })

          if (disposed) {
            newTerminal.destroy()

            return
          }

          wtermTerminalCache.set(sessionId, { terminal: newTerminal })
          setXtermTerminal(null)
          setTerminal(newTerminal)
        } catch {
          if (!disposed) {
            setActiveRendererMode('xterm')
          }
        }
      }

      void initializeWasmTerminal()

      return (): void => {
        disposed = true
        node.removeEventListener('focusin', handleFocusIn)
        node.removeEventListener('focusout', handleFocusOut)
        wtermTerminalCache.get(sessionId)?.terminal.destroy()
        wtermTerminalCache.delete(sessionId)
        setTerminal(null)
      }
    }

    // Check if we already have a terminal for this session
    const cached = terminalCache.get(sessionId)
    let newTerminal: Terminal
    let fitAddon: FitAddon
    // Renderer addons (at most one non-null) — kept in closure so cleanup disposes them before the terminal.
    let webglAddon: WebglAddon | null = null
    let webglContextLossDisposable: { dispose: () => void } | null = null
    let canvasAddon: CanvasAddon | null = null
    let fitFrameId: number | null = null
    let lastFitSize: { width: number; height: number } | null = null
    let disposed = false

    const cancelScheduledFit = (): void => {
      if (fitFrameId !== null) {
        window.cancelAnimationFrame(fitFrameId)
        fitFrameId = null
      }
    }

    const fitIfNeeded = (targetFitAddon: FitAddon, force = false): boolean => {
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
      targetFitAddon.fit()

      return true
    }

    const scheduleFit = (targetFitAddon: FitAddon): void => {
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
        fitIfNeeded(targetFitAddon)
      })
    }

    const flushFit = (
      targetFitAddon: FitAddon,
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
          const didFit = fitIfNeeded(targetFitAddon, options.force ?? false)
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

    const fitInitialWhenReady = (targetFitAddon: FitAddon): boolean => {
      if (deferFitRef.current) {
        return false
      }

      return fitIfNeeded(targetFitAddon, true)
    }

    let didInitialFit = false

    if (cached) {
      // Reuse existing terminal from cache
      newTerminal = cached.terminal
      fitAddon = cached.fitAddon
      fitAddonRef.current = fitAddon

      // Re-open terminal in the new container
      newTerminal.open(node)

      // Re-fit to new container — guard against hidden (display:none) containers
      // where offsetWidth is 0. Fitting at zero width tells xterm cols≈1,
      // which causes the PTY to re-wrap scrollback into a narrow column.
      didInitialFit = fitInitialWhenReady(fitAddon)
    } else {
      // Create new terminal instance
      newTerminal = new Terminal({
        cursorBlink: true,
        fontSize: TERMINAL_FONT_SIZE,
        fontFamily: TERMINAL_FONT_FAMILY,
        theme: toXtermTheme(themeService.current().terminal),
        scrollback: 10000,
        allowProposedApi: true,
        macOptionClickForcesSelection: true,
      })

      // Create and load fit addon
      fitAddon = new FitAddon()
      newTerminal.loadAddon(fitAddon)
      fitAddonRef.current = fitAddon

      // Open terminal in container — WebglAddon requires open() to have been
      // called first (it needs the canvas elements xterm creates in open()).
      newTerminal.open(node)

      // Try WebGL first (fastest); fall back to Canvas2D if WebGL is
      // unavailable. Both renderers honor customGlyphs. See the file-level
      // comment for why this matters and what happens if both fail.
      try {
        const addon = new WebglAddon()
        webglContextLossDisposable = addon.onContextLoss(() => {
          addon.dispose()
          webglAddon = null
          webglContextLossDisposable = null
          // Reattach Canvas2D so customGlyphs survives WebGL context loss.
          try {
            const fallback = new CanvasAddon()
            newTerminal.loadAddon(fallback)
            canvasAddon = fallback
          } catch {
            // Canvas2D also unavailable — xterm reverts to DOM rendering.
          }
        })
        newTerminal.loadAddon(addon)
        webglAddon = addon
      } catch {
        try {
          const addon = new CanvasAddon()
          newTerminal.loadAddon(addon)
          canvasAddon = addon
        } catch {
          // Both renderer addons failed — xterm reverts to its DOM renderer.
        }
      }

      // Fit terminal to container — guard against hidden (display:none) containers
      didInitialFit = fitInitialWhenReady(fitAddon)

      // Register OSC 7 handler for cwd tracking. Shell prompts and agent/tool
      // output both arrive through xterm's parser, so this stays pane-local.
      newTerminal.parser.registerOscHandler(7, (data) => {
        applyOsc7Cwd(data)

        return true
      })

      // Cache the terminal instance for this session
      terminalCache.set(sessionId, { terminal: newTerminal, fitAddon })
    }

    const refreshAfterFontFit = (): void => {
      newTerminal.refresh(0, Math.max(newTerminal.rows - 1, 0))
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
      flushFit(fitAddon, {
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
        flushFit(fitAddon, {
          force: true,
          afterFit: (): void => {
            clearPendingDeferredFit()
            refreshAfterFontFit()
          },
        })

        return
      }

      pendingDeferredFitFlushRef.current = false
      flushFit(fitAddon)
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
    resizeRef.current(newTerminal.cols, newTerminal.rows)

    // Handle resize events - notify PTY of terminal size changes.
    // The cols/rows from xterm's onResize event are already correct because
    // fitAddon.fit() (the trigger upstream) has already computed and applied
    // them. Calling fit() again here would re-measure the container — pure
    // overhead during rapid sidebar drag / window resize. Just forward to PTY.
    let lastForwardedResize: { cols: number; rows: number } | null = null

    const resizeDisposable = newTerminal.onResize(({ cols, rows }) => {
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

    // Root cause B (Claude + Codex consensus): xterm renders on a debounced
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

      newTerminal.refresh(0, Math.max(newTerminal.rows - 1, 0))
    }

    window.addEventListener('focus', repaintOnWindowVisible)
    document.addEventListener('visibilitychange', repaintOnWindowVisible)

    // P2 Fix: Add ResizeObserver to detect container size changes
    // When the container resizes (e.g., window resize, panel collapse),
    // fit the terminal which will trigger the onResize event above.
    // Guard: skip fit when container is hidden (display:none → width=0)
    // to avoid PTY scrollback re-wrapping at a narrow column count.
    const resizeObserver = new ResizeObserver(() => {
      scheduleFit(fitAddon)
    })
    resizeObserver.observe(node)

    // Store terminal in state to trigger useTerminal hook
    setTerminal(newTerminal)
    setXtermTerminal(newTerminal)

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
      resizeObserver.disconnect()
      resizeDisposable.dispose()
      node.removeEventListener('focusin', handleFocusIn)
      node.removeEventListener('focusout', handleFocusOut)
      window.removeEventListener('focus', repaintOnWindowVisible)
      document.removeEventListener('visibilitychange', repaintOnWindowVisible)
      // Dispose the renderer addon (and any WebGL context-loss subscription)
      // before the terminal itself — order matters: the addon holds
      // references to the terminal's renderer state and must clean up while
      // that state is still valid. At most one renderer addon is non-null.
      webglContextLossDisposable?.dispose()
      webglContextLossDisposable = null
      webglAddon?.dispose()
      webglAddon = null
      canvasAddon?.dispose()
      canvasAddon = null
      const entry = terminalCache.get(sessionId)
      if (entry) {
        entry.terminal.dispose()
        terminalCache.delete(sessionId)
      }
      setTerminal(null)
      setXtermTerminal(null)
      fitAddonRef.current = null
    }
  }, [activeRendererMode, applyOsc7Cwd, sessionId])

  const clipboard = useTerminalClipboard({
    terminal: xtermTerminal,
    enableImagePaste,
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
        className="h-full w-full"
      />
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
        onPasteImage={(): void => {
          void clipboard.pasteImage()
        }}
        canCopy={clipboard.hasSelection}
        canPasteImage={clipboard.canPasteImage}
        showPasteImage={enableImagePaste}
      />
    </div>
  )
})
