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
import type { FocusedPaneRef } from '../../command-palette/hooks/usePaneRenameChord'

type ScratchStatus = 'running' | 'exited'

interface ScratchEntry {
  scratchPtyId: string
  pid: number
  status: ScratchStatus
  cwd: string
}

/**
 * A pane to open a scratch shell against. The chord derives it from the focused
 * pane; the pane-header button passes its own pane's identity + live cwd.
 */
export interface ScratchTarget {
  sessionId: string
  paneId: string
  cwd: string
}

/** Stable per-pane key — NOT the host ptyId, which rotates on pane restart. */
const paneKey = (sessionId: string, paneId: string): string =>
  `${sessionId}:${paneId}`

export interface UseScratchTerminalsArgs {
  service: ITerminalService
  /** Resolve the focused pane — the chord's target when `toggle()` has no arg. */
  resolveFocusedPane: () => FocusedPaneRef | null
  /** Gate spawning until the boot reap resolves. */
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
  /** Toggle the popup for a target pane (defaults to the focused pane). */
  toggle: (target?: ScratchTarget) => Promise<void>
  /**
   * Running scratch shells keyed by `${sessionId}:${paneId}` — drives the
   * live-but-hidden cues. Global across sessions (hide ≠ kill survives a
   * session switch), so the bound is ≤4 per session, not ≤4 total.
   */
  runningByPane: ReadonlyMap<string, ScratchStatus>
}

/**
 * Owns the lifecycle of ephemeral "scratch" terminals (VIM-53). One scratch
 * shell per host pane, keyed by `${sessionId}:${paneId}`, spawned at that pane's
 * live cwd with `{ ephemeral: true, enableAgentBridge: false }`. The hook owns
 * spawn/kill; the popup renders the existing `<Body>` in `attach` mode. Hide ≠
 * kill — each scratch `<Body>` stays mounted-hidden for its shell's whole life.
 */
export const useScratchTerminals = ({
  service,
  resolveFocusedPane,
  ready = true,
  registerPending,
  notifyPaneReady,
}: UseScratchTerminalsArgs): UseScratchTerminals => {
  // Authoritative handles live in a ref so they never serialize; a projection
  // is mirrored into state so renderNode + cues re-render.
  const entriesRef = useRef<Map<string, ScratchEntry>>(new Map())
  const [entries, setEntries] = useState<Map<string, ScratchEntry>>(new Map())
  const [visibleKey, setVisibleKey] = useState<string | null>(null)
  const spawningRef = useRef<Set<string>>(new Set())

  const commit = useCallback((): void => {
    setEntries(new Map(entriesRef.current))
  }, [])

  const hide = useCallback((): void => {
    setVisibleKey(null)
  }, [])

  const toggle = useCallback(
    async (target?: ScratchTarget): Promise<void> => {
      let resolved = target
      if (!resolved) {
        const focused = resolveFocusedPane()
        if (focused) {
          resolved = {
            sessionId: focused.session.id,
            paneId: focused.pane.id,
            cwd: focused.pane.cwd,
          }
        }
      }
      if (!resolved) {
        return
      }
      const key = paneKey(resolved.sessionId, resolved.paneId)

      // Already showing this pane's scratch → hide (never kill).
      if (visibleKey === key) {
        setVisibleKey(null)

        return
      }

      // Lazily spawn this pane's scratch shell on first open.
      if (
        !entriesRef.current.has(key) &&
        ready &&
        !spawningRef.current.has(key)
      ) {
        spawningRef.current.add(key)
        try {
          const result = await service.spawn({
            // The pane's live (OSC 7-tracked) cwd, not the session's static wd.
            cwd: resolved.cwd,
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
        } catch (err) {
          // Contain the rejection (chord calls toggle with `void`); no entry is
          // created, so the next toggle retries.
          // eslint-disable-next-line no-console
          console.warn('scratch spawn failed', err)
        } finally {
          spawningRef.current.delete(key)
        }
      }

      if (entriesRef.current.has(key)) {
        setVisibleKey(key)
      }
    },
    [resolveFocusedPane, visibleKey, ready, service, commit, registerPending]
  )

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

  const runningByPane = new Map<string, ScratchStatus>()
  entries.forEach((entry, key) => runningByPane.set(key, entry.status))

  const renderNode: ReactNode =
    entries.size > 0
      ? createElement(
          Fragment,
          null,
          [...entries.entries()].map(([key, entry]) =>
            createElement(ScratchTerminalPopup, {
              key,
              open: visibleKey === key,
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

  return { renderNode, toggle, runningByPane }
}
