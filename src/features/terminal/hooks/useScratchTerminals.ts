import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
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
  /**
   * Live `${sessionId}:${paneId}` keys across all sessions. A scratch entry
   * whose key drops out (pane close / session close) is reaped — killed +
   * dropped. A pane restart keeps the key (stable paneId), so its scratch
   * survives. Omitted ⇒ no reconciliation (PR1/PR2 behavior).
   */
  livePaneKeys?: ReadonlySet<string>
  /** Drop the spawn→attach buffer for a killed / self-exited scratch pty. */
  dropAllForPty?: (ptyId: string) => void
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
  livePaneKeys,
  dropAllForPty,
}: UseScratchTerminalsArgs): UseScratchTerminals => {
  // Authoritative handles live in a ref so they never serialize; a projection
  // is mirrored into state so renderNode + cues re-render.
  const entriesRef = useRef<Map<string, ScratchEntry>>(new Map())
  const [entries, setEntries] = useState<Map<string, ScratchEntry>>(new Map())
  const [visibleKey, setVisibleKey] = useState<string | null>(null)
  const spawningRef = useRef<Set<string>>(new Set())
  /** Show-intent guard: prevents a late-resolving spawn from stealing visibility. */
  const showIntentRef = useRef<string | null>(null)
  // Latest live-pane keys, mirrored so an async spawn resolution can re-check
  // liveness without a stale closure. The reconcile effect only fires on a
  // `livePaneKeys` change, so a spawn that resolves after its pane closed would
  // otherwise slip past it.
  const livePaneKeysRef = useRef(livePaneKeys)
  livePaneKeysRef.current = livePaneKeys

  const commit = useCallback((): void => {
    setEntries(new Map(entriesRef.current))
  }, [])

  const hide = useCallback((): void => {
    showIntentRef.current = null
    setVisibleKey(null)
  }, [])

  // Lazily spawn a pane's scratch shell on first open. Idempotent + guarded.
  const spawnIfNeeded = useCallback(
    async (target: ScratchTarget, key: string): Promise<void> => {
      const existing = entriesRef.current.get(key)
      if (
        (existing && existing.status !== 'exited') ||
        !ready ||
        spawningRef.current.has(key)
      ) {
        return
      }
      // Re-opening a self-exited scratch: drop the dead shell's stale buffer
      // before the fresh spawn replaces the entry (VIM-62 self-exit reconcile).
      if (existing) {
        dropAllForPty?.(existing.scratchPtyId)
      }
      spawningRef.current.add(key)
      try {
        const result = await service.spawn({
          // The pane's live (OSC 7-tracked) cwd, not the session's static wd.
          cwd: target.cwd,
          ephemeral: true,
          enableAgentBridge: false,
        })
        // The host pane may have closed while the spawn was in flight. Reconcile
        // can't catch it — the entry wasn't in the map when livePaneKeys last
        // changed — so reap the fresh shell here instead of tracking an orphan.
        const live = livePaneKeysRef.current
        if (live && !live.has(key)) {
          void service.kill({ sessionId: result.sessionId })
          dropAllForPty?.(result.sessionId)
          if (showIntentRef.current === key) {
            showIntentRef.current = null
          }

          return
        }
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
        // Contain the rejection (chord/pill call with `void`); no entry is
        // created, so the next attempt retries.
        // eslint-disable-next-line no-console
        console.warn('scratch spawn failed', err)
      } finally {
        spawningRef.current.delete(key)
      }
    },
    [ready, service, commit, registerPending, dropAllForPty]
  )

  // Reveal a pane's scratch (spawning on first open). The pane button and the
  // pane-switcher pills land here; only the chord toggles (hide-if-shown).
  const show = useCallback(
    async (target: ScratchTarget): Promise<void> => {
      const key = paneKey(target.sessionId, target.paneId)
      showIntentRef.current = key
      await spawnIfNeeded(target, key)
      if (entriesRef.current.has(key) && showIntentRef.current === key) {
        setVisibleKey(key)
      }
    },
    [spawnIfNeeded]
  )

  const toggle = useCallback(
    async (target?: ScratchTarget): Promise<void> => {
      // Chord (no target): hide whatever is shown, else open the focused pane.
      // Keying off `visibleKey` (not the focused pane's key) keeps it a true
      // toggle even after the pills switched the popup to a non-focused pane.
      if (!target) {
        if (visibleKey !== null) {
          hide()

          return
        }
        const focused = resolveFocusedPane()
        if (!focused) {
          return
        }
        await show({
          sessionId: focused.session.id,
          paneId: focused.pane.id,
          cwd: focused.pane.cwd,
        })

        return
      }

      // Targeted (pane button): toggle that specific pane's scratch.
      const key = paneKey(target.sessionId, target.paneId)
      if (visibleKey === key) {
        hide()

        return
      }
      await show(target)
    },
    [resolveFocusedPane, visibleKey, show, hide]
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

  // Self-exit (VIM-62): a scratch child that exits on its own (`exit`/Ctrl-D)
  // flips its entry to `exited`. The button cue goes dark (status !== running);
  // it's dropped on the next reconcile or replaced on the next open
  // (spawnIfNeeded re-spawns an exited entry).
  useEffect(() => {
    // The subscribe is async but the cleanup is sync — the teardown flag and
    // unsubscribe handle live on an object so the type-checker doesn't narrow
    // them to always-false the way it does closure-mutated `let`s.
    const subscription: { cancelled: boolean; off: (() => void) | null } = {
      cancelled: false,
      off: null,
    }
    void (async (): Promise<void> => {
      const off = await service.onExit((ptyId) => {
        const affected = [...entriesRef.current.entries()].filter(
          ([, entry]) =>
            entry.scratchPtyId === ptyId && entry.status !== 'exited'
        )
        if (affected.length === 0) {
          return
        }
        for (const [key, entry] of affected) {
          entriesRef.current.set(key, { ...entry, status: 'exited' })
        }
        commit()
      })
      if (subscription.cancelled) {
        off()

        return
      }
      subscription.off = off
    })()

    return (): void => {
      subscription.cancelled = true
      subscription.off?.()
    }
  }, [service, commit])

  // Lazy reconciliation (VIM-62): a scratch whose host pane no longer exists
  // (pane close / session close) is killed + dropped. A pane restart keeps it —
  // the key is the stable `${sessionId}:${paneId}`, not the rotating host ptyId.
  useEffect(() => {
    if (!livePaneKeys) {
      return
    }

    const deadKeys = [...entriesRef.current.keys()].filter(
      (key) => !livePaneKeys.has(key)
    )
    if (deadKeys.length === 0) {
      return
    }
    for (const key of deadKeys) {
      const entry = entriesRef.current.get(key)
      if (entry) {
        void service.kill({ sessionId: entry.scratchPtyId })
        dropAllForPty?.(entry.scratchPtyId)
      }
      entriesRef.current.delete(key)
    }
    const intent = showIntentRef.current
    if (intent !== null && !livePaneKeys.has(intent)) {
      showIntentRef.current = null
    }
    setVisibleKey((current) =>
      current !== null && !entriesRef.current.has(current) ? null : current
    )
    commit()
  }, [livePaneKeys, service, dropAllForPty, commit])

  // Memoized so consumers threading it down only re-render on actual change.
  const runningByPane = useMemo(() => {
    const map = new Map<string, ScratchStatus>()
    entries.forEach((entry, key) => map.set(key, entry.status))

    return map
  }, [entries])

  const renderNode: ReactNode =
    entries.size > 0
      ? createElement(
          Fragment,
          null,
          [...entries.entries()].map(([key, entry]) =>
            createElement(ScratchTerminalPopup, {
              // Keyed by pty so a re-spawned (post-exit) shell remounts a fresh
              // <Body>; `open` still tracks the stable pane key.
              key: `${key}:${entry.scratchPtyId}`,
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
