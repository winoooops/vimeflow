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
import { BurnerTerminalPopup } from '../components/BurnerTerminalPopup'
import { registerChord } from '../../command-palette/chordRegistry'
import type { ITerminalService } from '../services/terminalService'
import type { NotifyPaneReady } from './useTerminal'
import type { FocusedPaneRef } from '../../command-palette/hooks/usePaneRenameChord'

type BurnerStatus = 'running' | 'exited'

interface BurnerEntry {
  burnerPtyId: string
  pid: number
  status: BurnerStatus
  /** The cwd the shell spawned at (the `<Body>` attach snapshot). */
  cwd: string
  /**
   * The burner shell's live cwd, tracked from its own OSC 7 (VIM-94). Starts at
   * the spawn cwd; drives the out-of-sync highlight vs the host pane's cwd.
   */
  currentCwd: string
  /** A foreground command is currently running in the shell (VIM-71). */
  active: boolean
}

/**
 * A pane to open a burner shell against. The chord derives it from the focused
 * pane; the pane-header button passes its own pane's identity + live cwd.
 */
export interface BurnerTarget {
  sessionId: string
  paneId: string
  cwd: string
}

/** Stable per-pane key — NOT the host ptyId, which rotates on pane restart. */
const paneKey = (sessionId: string, paneId: string): string =>
  `${sessionId}:${paneId}`

// POSIX single-quote a path so spaces / shell metacharacters reach the burner
// shell as a single `cd` argument (a literal ' becomes the four chars '\'').
// Unix shells only — Windows PowerShell/cmd quoting is a separate follow-up.
const singleQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`

// True if the path carries any C0 control byte or DEL. These survive shell
// quoting but the terminal line editor acts on them before the shell parses the
// line, so a cwd containing one is refused rather than injected.
const hasControlBytes = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }

  return false
}

// Ctrl-E then Ctrl-U: move to end of line and kill it, so the injected cd runs
// on a clean prompt instead of merging with whatever the user half-typed.
const CLEAR_LINE = '\x05\x15'

// Compare OSC 7 cwds forgiving a trailing slash (root stays "/").
const normalizeCwd = (value: string): string => value.replace(/\/+$/, '') || '/'

export interface UseBurnerTerminalsArgs {
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
   * Live `${sessionId}:${paneId}` keys across all sessions. A burner entry
   * whose key drops out (pane close / session close) is reaped — killed +
   * dropped. A pane restart keeps the key (stable paneId), so its burner
   * survives. Omitted ⇒ no reconciliation (PR1/PR2 behavior).
   */
  livePaneKeys?: ReadonlySet<string>
  /** Drop the spawn→attach buffer for a killed / self-exited burner pty. */
  dropAllForPty?: (ptyId: string) => void
  /**
   * Live `${sessionId}:${paneId}` → current pane cwd, for the align-to-pane
   * button (VIM-81). Read at click-time so the burner snaps to where its host
   * pane is *now*, not the cwd it spawned at. Omitted ⇒ no align button.
   */
  livePaneCwds?: ReadonlyMap<string, string>
}

export interface UseBurnerTerminals {
  /**
   * Mounted while any burner shell lives; visibility-toggled so hiding the
   * popup does NOT unmount (and so the shell keeps running). Mount in
   * `WorkspaceView` like `usePaneRenameChord`'s node.
   */
  renderNode: ReactNode
  /** Toggle the popup for a target pane (defaults to the focused pane). */
  toggle: (target?: BurnerTarget) => Promise<void>
  /**
   * Running burner shells keyed by `${sessionId}:${paneId}` — drives the
   * live-but-hidden cues. Global across sessions (hide ≠ kill survives a
   * session switch), so the bound is ≤4 per session, not ≤4 total.
   */
  runningByPane: ReadonlyMap<string, BurnerStatus>
  /**
   * Burner shells with a foreground command actually running, keyed by
   * `${sessionId}:${paneId}` (VIM-71). Drives the amber button tint —
   * distinct from `runningByPane`, which only means a shell exists.
   */
  activeByPane: ReadonlyMap<string, boolean>
}

/**
 * Owns the lifecycle of ephemeral "burner" terminals (VIM-53). One burner
 * shell per host pane, keyed by `${sessionId}:${paneId}`, spawned at that pane's
 * live cwd with `{ ephemeral: true, enableAgentBridge: false }`. The hook owns
 * spawn/kill; the popup renders the existing `<Body>` in `attach` mode. Hide ≠
 * kill — each burner `<Body>` stays mounted-hidden for its shell's whole life.
 */
export const useBurnerTerminals = ({
  service,
  resolveFocusedPane,
  ready = true,
  registerPending,
  notifyPaneReady,
  livePaneKeys,
  dropAllForPty,
  livePaneCwds,
}: UseBurnerTerminalsArgs): UseBurnerTerminals => {
  // Authoritative handles live in a ref so they never serialize; a projection
  // is mirrored into state so renderNode + cues re-render.
  const entriesRef = useRef<Map<string, BurnerEntry>>(new Map())
  const [entries, setEntries] = useState<Map<string, BurnerEntry>>(new Map())
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
  // Latest live pane cwds, mirrored so the align button resolves the host pane's
  // current cwd at click-time instead of capturing a stale render snapshot.
  const livePaneCwdsRef = useRef(livePaneCwds)
  livePaneCwdsRef.current = livePaneCwds
  // Keys whose in-flight spawn was invalidated because the pane left the live set
  // mid-spawn. Checked when the spawn resolves so the shell is reaped even when a
  // new pane has since reused the freed id (`nextFreePaneId` recycles ids).
  const invalidatedSpawnsRef = useRef<Set<string>>(new Set())

  const commit = useCallback((): void => {
    setEntries(new Map(entriesRef.current))
  }, [])

  const hide = useCallback((): void => {
    showIntentRef.current = null
    setVisibleKey(null)
  }, [])

  // Track the burner shell's own live cwd from its OSC 7 (VIM-94). Updates only
  // the burner entry — never the host pane — so a `cd` inside the burner stays
  // isolated; it just drives the out-of-sync highlight.
  const setBurnerCwd = useCallback(
    (key: string, cwd: string): void => {
      const entry = entriesRef.current.get(key)
      if (!entry || entry.currentCwd === cwd) {
        return
      }
      entriesRef.current.set(key, { ...entry, currentCwd: cwd })
      commit()
    },
    [commit]
  )

  // Kill + drop a burner pty. The kill rejection is contained so a backend
  // failure logs instead of becoming an unhandled rejection; the boot sweep and
  // shutdown kill are the backstop if the kill never lands (spec §4).
  const killBurner = useCallback(
    (ptyId: string): void => {
      void (async (): Promise<void> => {
        try {
          await service.kill({ sessionId: ptyId })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('burner kill failed', err)
        }
      })()
      dropAllForPty?.(ptyId)
    },
    [service, dropAllForPty]
  )

  // Pull the host pane's live cwd into the burner shell — one-directional
  // (VIM-81). A real `cd` (queues behind any running command, shows in history),
  // resolved at call-time from the ref so it tracks the pane's current cwd. The
  // burner's own `cd` still never moves the pane (no OSC 7 wiring on the popup).
  const alignCwd = useCallback(
    (key: string): void => {
      const entry = entriesRef.current.get(key)
      const cwd = livePaneCwdsRef.current?.get(key)
      // Skip while a foreground command owns the shell (VIM-71 active cue): the
      // `cd` would be delivered to that program's stdin, not the shell prompt.
      // `active` is the last ~750ms poll, so a command started inside that window
      // can still slip through — a server-side guarded write closes it (VIM-90).
      if (entry?.status !== 'running' || entry.active || !cwd) {
        return
      }
      // The cwd is untrusted (OSC 7 / agent state). C0/DEL control bytes survive
      // shell quoting but the terminal line editor acts on them before the shell
      // parses the line — an embedded Ctrl-U would clear the `cd '` prefix and
      // run the rest. Refuse any path that carries them rather than inject it.
      if (hasControlBytes(cwd)) {
        // eslint-disable-next-line no-console
        console.warn('burner cwd-align: refusing cwd with control characters')

        return
      }
      const ptyId = entry.burnerPtyId
      void (async (): Promise<void> => {
        try {
          await service.write({
            sessionId: ptyId,
            data: `${CLEAR_LINE}cd ${singleQuote(cwd)}\r`,
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('burner cwd-align write failed', err)
        }
      })()
    },
    [service]
  )

  // Lazily spawn a pane's burner shell on first open. Idempotent + guarded.
  const spawnIfNeeded = useCallback(
    async (target: BurnerTarget, key: string): Promise<void> => {
      const existing = entriesRef.current.get(key)
      if (
        (existing && existing.status !== 'exited') ||
        !ready ||
        spawningRef.current.has(key)
      ) {
        return
      }
      // Re-opening a self-exited burner: drop the dead shell's stale buffer
      // before the fresh spawn replaces the entry (VIM-62 self-exit reconcile).
      if (existing) {
        dropAllForPty?.(existing.burnerPtyId)
      }
      spawningRef.current.add(key)
      try {
        const result = await service.spawn({
          // The pane's live (OSC 7-tracked) cwd, not the session's static wd.
          cwd: target.cwd,
          ephemeral: true,
          enableAgentBridge: false,
        })
        // The host pane may have closed mid-spawn (and a new pane may have reused
        // its id). `invalidatedSpawnsRef` flags a key whose pane left the live set
        // while spawning; with the current liveness check this reaps the fresh
        // shell instead of orphaning it or attaching it to an unrelated new pane.
        const invalidated = invalidatedSpawnsRef.current.has(key)
        const live = livePaneKeysRef.current
        if (invalidated || (live && !live.has(key))) {
          killBurner(result.sessionId)
          if (showIntentRef.current === key) {
            showIntentRef.current = null
          }

          return
        }
        // Buffer prompt/rc output emitted before the popup's terminal attaches.
        registerPending?.(result.sessionId)
        entriesRef.current.set(key, {
          burnerPtyId: result.sessionId,
          pid: result.pid,
          status: 'running',
          cwd: result.cwd,
          currentCwd: result.cwd,
          active: false,
        })
        commit()
      } catch (err) {
        // Contain the rejection (chord/pill call with `void`); no entry is
        // created, so the next attempt retries.
        // eslint-disable-next-line no-console
        console.warn('burner spawn failed', err)
      } finally {
        spawningRef.current.delete(key)
        // Clear the tombstone once the spawn settles (success, reap, or failure)
        // so a failed attempt can't kill a later valid spawn for a reused id.
        invalidatedSpawnsRef.current.delete(key)
      }
    },
    [ready, service, commit, registerPending, dropAllForPty, killBurner]
  )

  // Reveal a pane's burner (spawning on first open). The pane button and the
  // pane-switcher pills land here; only the chord toggles (hide-if-shown).
  const show = useCallback(
    async (target: BurnerTarget): Promise<void> => {
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
    async (target?: BurnerTarget): Promise<void> => {
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

      // Targeted (pane button): toggle that specific pane's burner.
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

  // Self-exit (VIM-62): a burner child that exits on its own (`exit`/Ctrl-D)
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
            entry.burnerPtyId === ptyId && entry.status !== 'exited'
        )
        if (affected.length === 0) {
          return
        }
        for (const [key, entry] of affected) {
          // A dead shell can't be running a foreground command, so the mint
          // "running" dot clears alongside the lifecycle flip.
          entriesRef.current.set(key, {
            ...entry,
            status: 'exited',
            active: false,
          })
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

  // Live "running" cue (VIM-71): the backend polls each burner shell's
  // foreground process group and emits `burner-foreground` when a command
  // starts or finishes. Mirror it onto the matching entry's `active` flag,
  // which drives the amber button tint. Same async-subscribe / sync-cleanup shape as
  // the self-exit effect above.
  useEffect(() => {
    const subscription: { cancelled: boolean; off: (() => void) | null } = {
      cancelled: false,
      off: null,
    }
    void (async (): Promise<void> => {
      const off = await service.onBurnerForeground((ptyId, running) => {
        // Gate on `status === 'running'`: the poll loop and the PTY reader emit
        // from independent backend tasks, so a stale `running: true` can arrive
        // after `pty-exit` — without this it would re-light a dead shell.
        const affected = [...entriesRef.current.entries()].filter(
          ([, entry]) =>
            entry.burnerPtyId === ptyId &&
            entry.status === 'running' &&
            entry.active !== running
        )
        if (affected.length === 0) {
          return
        }
        for (const [key, entry] of affected) {
          entriesRef.current.set(key, { ...entry, active: running })
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

  // Lazy reconciliation (VIM-62): a burner whose host pane no longer exists
  // (pane close / session close) is killed + dropped. A pane restart keeps it —
  // the key is the stable `${sessionId}:${paneId}`, not the rotating host ptyId.
  useEffect(() => {
    if (!livePaneKeys) {
      return
    }

    // Invalidate any in-flight spawn whose pane just left the live set, before
    // it can resolve — guards against a new pane reusing the freed id mid-spawn.
    const live = livePaneKeys
    spawningRef.current.forEach((key) => {
      if (!live.has(key)) {
        invalidatedSpawnsRef.current.add(key)
      }
    })

    const deadKeys = [...entriesRef.current.keys()].filter(
      (key) => !live.has(key)
    )
    if (deadKeys.length === 0) {
      return
    }
    for (const key of deadKeys) {
      const entry = entriesRef.current.get(key)
      if (entry) {
        killBurner(entry.burnerPtyId)
      }
      entriesRef.current.delete(key)
    }
    const intent = showIntentRef.current
    if (intent !== null && !live.has(intent)) {
      showIntentRef.current = null
    }
    setVisibleKey((current) =>
      current !== null && !entriesRef.current.has(current) ? null : current
    )
    commit()
  }, [livePaneKeys, killBurner, commit])

  // Memoized so consumers threading it down only re-render on actual change.
  const runningByPane = useMemo(() => {
    const map = new Map<string, BurnerStatus>()
    entries.forEach((entry, key) => map.set(key, entry.status))

    return map
  }, [entries])

  const activeByPane = useMemo(() => {
    const map = new Map<string, boolean>()
    entries.forEach((entry, key) => map.set(key, entry.active))

    return map
  }, [entries])

  const renderNode: ReactNode =
    entries.size > 0
      ? createElement(
          Fragment,
          null,
          [...entries.entries()].map(([key, entry]): ReactNode => {
            const hostCwd = livePaneCwds?.get(key)

            return createElement(BurnerTerminalPopup, {
              // Keyed by pty so a re-spawned (post-exit) shell remounts a fresh
              // <Body>; `open` still tracks the stable pane key.
              key: `${key}:${entry.burnerPtyId}`,
              open: visibleKey === key,
              burnerPtyId: entry.burnerPtyId,
              cwd: entry.cwd,
              pid: entry.pid,
              service,
              onHide: hide,
              onPaneReady: notifyPaneReady,
              // Offer the align button with a live cwd map and a live shell.
              // macOS/Linux only: foreground detection is cfg(unix), so the
              // busy-guard is reliable on every platform we ship to.
              onAlignCwd:
                livePaneCwds && entry.status === 'running'
                  ? (): void => alignCwd(key)
                  : undefined,
              // ...and disable it while a foreground command owns the shell.
              alignBusy: entry.active,
              // Track the burner's own cwd (isolated, never the host pane) and
              // light the button amber once it has wandered from its host pane.
              onCwdChange: (cwd: string): void => setBurnerCwd(key, cwd),
              outOfSync:
                entry.status === 'running' &&
                hostCwd !== undefined &&
                normalizeCwd(entry.currentCwd) !== normalizeCwd(hostCwd),
            })
          })
        )
      : null

  return { renderNode, toggle, runningByPane, activeByPane }
}
