import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { ScratchTerminalPopup } from '../components/ScratchTerminalPopup'
import { registerChord } from '../../command-palette/chordRegistry'
import type { ITerminalService } from '../services/terminalService'
import type { NotifyPaneReady } from './useTerminal'
import type { Session } from '../../sessions/types'

type ScratchStatus = 'running' | 'exited'

interface ScratchEntry {
  scratchPtyId: string
  pid: number
  status: ScratchStatus
  cwd: string
}

export interface UseScratchTerminalsArgs {
  service: ITerminalService
  /** Resolve the currently-active session — the chord / button target. */
  resolveActiveSession: () => Session | null
  /** Gate spawning until the boot reap resolves (wired in a later task). */
  ready?: boolean
  /** Buffer early `pty-data` from spawn until the popup's terminal attaches. */
  registerPending?: (ptyId: string) => void
  /** Drain the spawn→attach buffer once the popup's terminal subscribes. */
  notifyPaneReady?: NotifyPaneReady
}

export interface UseScratchTerminals {
  /**
   * Mounted while any scratch shell lives; visibility-toggled so hiding the
   * popup does NOT unmount (and so the shell keeps running). Mount in
   * `WorkspaceView` like `usePaneRenameChord`'s node.
   */
  renderNode: ReactNode
  /** Toggle the popup for the active session (chord + pane-button entry points). */
  toggle: () => Promise<void>
  /**
   * Running scratch shells keyed by `sessionId` (PR1 is session-scoped; PR2
   * generalizes the key to `${sessionId}:${paneId}` and renames to
   * `runningByPane`). Drives the live-but-hidden cues.
   */
  running: ReadonlyMap<string, ScratchStatus>
}

/**
 * Owns the lifecycle of ephemeral "scratch" terminals (VIM-53). PR1: one
 * scratch shell per session, spawned at the session's `workingDirectory` with
 * `{ ephemeral: true, enableAgentBridge: false }`. The hook owns spawn/kill;
 * the popup renders the existing `<Body>` in `attach` mode. Hide ≠ kill.
 */
export const useScratchTerminals = ({
  service,
  resolveActiveSession,
  ready = true,
  registerPending,
  notifyPaneReady,
}: UseScratchTerminalsArgs): UseScratchTerminals => {
  // Authoritative handles live in a ref so they never serialize; a projection
  // is mirrored into state so renderNode + cues re-render.
  const entriesRef = useRef<Map<string, ScratchEntry>>(new Map())
  const [entries, setEntries] = useState<Map<string, ScratchEntry>>(new Map())
  const [visibleSessionId, setVisibleSessionId] = useState<string | null>(null)
  const spawningRef = useRef<Set<string>>(new Set())

  const commit = useCallback((): void => {
    setEntries(new Map(entriesRef.current))
  }, [])

  const hide = useCallback((): void => {
    setVisibleSessionId(null)
  }, [])

  const toggle = useCallback(async (): Promise<void> => {
    const session = resolveActiveSession()
    if (!session) {
      return
    }
    const key = session.id

    // Already showing this session's scratch → hide (never kill).
    if (visibleSessionId === key) {
      setVisibleSessionId(null)

      return
    }

    // Lazily spawn the session's scratch shell on first open.
    if (
      !entriesRef.current.has(key) &&
      ready &&
      !spawningRef.current.has(key)
    ) {
      spawningRef.current.add(key)
      try {
        const result = await service.spawn({
          cwd: session.workingDirectory,
          ephemeral: true,
          enableAgentBridge: false,
        })
        // Buffer prompt/rc output emitted before the popup's terminal attaches.
        registerPending?.(result.sessionId)
        entriesRef.current.set(key, {
          scratchPtyId: result.sessionId,
          pid: result.pid,
          status: 'running',
          cwd: result.cwd,
        })
        commit()
      } finally {
        spawningRef.current.delete(key)
      }
    }

    if (entriesRef.current.has(key)) {
      setVisibleSessionId(key)
    }
  }, [
    resolveActiveSession,
    visibleSessionId,
    ready,
    service,
    commit,
    registerPending,
  ])

  // `Mod+;` then backtick chord — registered once, calls the latest toggle via a ref.
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle
  useEffect(
    () =>
      registerChord('`', () => {
        void toggleRef.current()

        return true
      }),
    []
  )

  const running = new Map<string, ScratchStatus>()
  entries.forEach((entry, key) => running.set(key, entry.status))

  const renderNode: ReactNode =
    entries.size > 0
      ? createElement(
          Fragment,
          null,
          [...entries.entries()].map(([key, entry]) =>
            createElement(ScratchTerminalPopup, {
              key,
              open: visibleSessionId === key,
              scratchPtyId: entry.scratchPtyId,
              cwd: entry.cwd,
              pid: entry.pid,
              service,
              onHide: hide,
              onPaneReady: notifyPaneReady,
            })
          )
        )
      : null

  return { renderNode, toggle, running }
}
