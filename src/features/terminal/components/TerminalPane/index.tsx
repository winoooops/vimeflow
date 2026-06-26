/* eslint-disable react/require-default-props -- forwardRef components: ESLint cannot see through forwardRef to find destructuring defaults */
// cspell:ignore worktree
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react'
import { useGitBranch } from '../../../diff/hooks/useGitBranch'
import { useGitStatus } from '../../../diff/hooks/useGitStatus'
import { useGitWorktree } from '../../../diff/hooks/useGitWorktree'
import type { Pane, Session, SessionStatus } from '../../../sessions/types'
import { agentForPane } from '../../../sessions/utils/agentForSession'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { BurnerTarget } from '../../hooks/useBurnerTerminals'
import type { ITerminalService } from '../../services/terminalService'
import { aggregateLineDelta } from './aggregateLineDelta'
import { Body, type BodyHandle } from './Body'
import { Footer } from './Footer'
import { Header } from './Header'
import {
  ptyStatusToSessionStatus,
  type PtyStatus,
} from './ptyStatusToSessionStatus'
import { RestartAffordance } from './RestartAffordance'

export type TerminalPaneMode = 'attach' | 'spawn' | 'awaiting-restart'

export interface TerminalPaneProps {
  session: Session
  pane: Pane
  isActive: boolean
  service: ITerminalService
  onPaneReady?: NotifyPaneReady
  mode?: TerminalPaneMode
  onClose?: (sessionId: string, paneId: string) => void
  /** Toggle this pane's ephemeral burner terminal (VIM-53). */
  onBurner?: (target: BurnerTarget) => void
  /** Make this pane active — the burner button focuses its pane (spec §8). */
  onRequestActive?: (sessionId: string, paneId: string) => void
  /** Pane-keys with a foreground command running — drives the amber button tint (VIM-71). */
  activeBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys with a live burner shell (idle or active) — drives a11y state (VIM-53). */
  runningBurnerPaneKeys?: ReadonlySet<string>
  onCwdChange?: (cwd: string) => void
  onCommandSubmit?: (ptyId: string, command: string) => void
  onRestart?: (sessionId: string) => void
  deferFit?: boolean
  showFocusHighlight?: boolean
  terminalFontFamily?: string
  /**
   * VIM-167: make this pane's header the drag handle for drag-into-slot. The
   * terminal body is never draggable so xterm selection keeps the pointer.
   */
  paneDraggable?: boolean
  onHeaderDragStart?: (event: DragEvent<HTMLDivElement>) => void
  onHeaderDragEnd?: (event: DragEvent<HTMLDivElement>) => void
}

export interface TerminalPaneHandle {
  /** Returns true if xterm body focused successfully, false if not ready. */
  focusTerminal(): boolean
}

export {
  clearTerminalCache,
  disposeTerminalSession,
  terminalCache,
} from './Body'

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane(
    {
      session,
      pane,
      isActive,
      service,
      onPaneReady = undefined,
      mode = 'spawn',
      onClose = undefined,
      onBurner = undefined,
      onRequestActive = undefined,
      activeBurnerPaneKeys = undefined,
      runningBurnerPaneKeys = undefined,
      onCwdChange = undefined,
      onCommandSubmit = undefined,
      onRestart = undefined,
      deferFit = false,
      showFocusHighlight = true,
      terminalFontFamily = undefined,
      paneDraggable = false,
      onHeaderDragStart = undefined,
      onHeaderDragEnd = undefined,
    }: TerminalPaneProps,
    ref
  ): ReactElement {
    const agent = agentForPane(pane)
    const bodyRef = useRef<BodyHandle>(null)
    // Seeded `undefined` (NOT `pane.active`) so the first effect run can detect
    // initial mount distinctly from a stable `true → true` re-render. A pane
    // born active (createSession, addPane, restored on app launch) must focus
    // on first paint — otherwise its xterm stays unfocused with no transition
    // for the rising-edge branch below to catch.
    const wasActiveRef = useRef<boolean | undefined>(undefined)
    const [ptyStatus, setPtyStatus] = useState<PtyStatus>('idle')
    const [isCollapsed, setIsCollapsed] = useState(false)

    useImperativeHandle(ref, () => ({
      focusTerminal(): boolean {
        if (!bodyRef.current) {
          return false
        }

        bodyRef.current.focusTerminal()

        return true
      },
    }))

    const isPaneActive = pane.active
    const isFocusHighlightVisible = isPaneActive && showFocusHighlight

    useEffect(() => {
      // Fire on `undefined → true` (initial mount active) AND `false → true`
      // (existing rising edge). Stable `true → true` re-renders are skipped.
      if (pane.active && wasActiveRef.current !== true) {
        bodyRef.current?.focusTerminal()
      }
      wasActiveRef.current = pane.active
    }, [pane.active])

    const pipStatus: SessionStatus =
      mode === 'awaiting-restart'
        ? pane.status
        : ptyStatusToSessionStatus(ptyStatus)

    const isIdle = pipStatus === 'idle'

    const { branch } = useGitBranch(pane.cwd, {
      enabled: isActive,
    })

    const { worktreeName } = useGitWorktree(pane.cwd, {
      enabled: isActive,
    })

    const { files, filesCwd } = useGitStatus(pane.cwd, {
      enabled: isActive,
    })

    const isFresh = filesCwd === pane.cwd

    const { added, removed } = useMemo(
      () => (isFresh ? aggregateLineDelta(files) : { added: 0, removed: 0 }),
      [files, isFresh]
    )

    const handleContainerClick = useCallback((): void => {
      // SplitView owns click-to-focus state changes. If this pane is inactive,
      // the slot click flips pane.active first; the rising-edge effect above
      // moves DOM focus into xterm after React commits the active state.
      if (!pane.active) {
        return
      }
      bodyRef.current?.focusTerminal()
    }, [pane.active])

    const handleToggleCollapse = useCallback((): void => {
      setIsCollapsed((collapsed) => !collapsed)
    }, [])

    const handleClose = useCallback((): void => {
      onClose?.(session.id, pane.id)
    }, [onClose, pane.id, session.id])

    // The header button toggles THIS pane's burner — not whatever is focused —
    // so it passes its own identity + live cwd (spec §8).
    const handleBurner = useCallback((): void => {
      // Focus this pane first (spec §8): the button stops propagation, so the
      // slot's click-to-activate never runs — without this the active-pane
      // state would stay on the previously-focused pane.
      onRequestActive?.(session.id, pane.id)
      onBurner?.({ sessionId: session.id, paneId: pane.id, cwd: pane.cwd })
    }, [onRequestActive, onBurner, session.id, pane.id, pane.cwd])

    const handleRestart = useCallback(
      (restartSessionId: string): void => {
        // TODO(#202): for multi-pane sessions, this needs to thread `pane.id`
        // through so `useSessionManager.restartSession` targets the clicked
        // pane instead of `getActivePane(session)`. Deferred to 5c (production
        // multi-pane).
        //
        // Until 5c lands the paneId-aware restart, gate the callback on
        // `pane.active`. Without the guard, clicking Restart on a non-active
        // exited pane silently restarts the active PTY (because
        // `useSessionManager.restartSession` resolves via `getActivePane`).
        // The guard makes non-active restarts INERT — a visible "click has
        // no effect" is strictly safer than a wrong-pane restart with no
        // recovery path until reload. Single-pane production has
        // `pane.active` always true, so the guard is a no-op there.
        if (!pane.active) {
          return
        }
        onRestart?.(restartSessionId)
      },
      [onRestart, pane.active]
    )

    const isAwaitingRestart = mode === 'awaiting-restart'
    const enableImagePaste = pane.agentType !== 'generic'

    const footerPlaceholder = isAwaitingRestart
      ? `session ended — restart to resume ${agent.short.toLowerCase()}`
      : undefined

    const containerStyle = isFocusHighlightVisible
      ? {
          boxShadow: `0 0 0 6px ${agent.accentDim}, var(--shadow-ambient)`,
          cursor: 'default' as const,
        }
      : {
          boxShadow: 'none',
          cursor: isPaneActive ? ('default' as const) : ('pointer' as const),
        }

    const focusRingStyle = {
      border: isFocusHighlightVisible
        ? `2px solid ${agent.accent}`
        : '1px solid color-mix(in srgb, var(--color-outline-variant) 22%, transparent)',
      transition:
        'border-color 180ms ease, box-shadow 220ms ease, opacity 220ms ease',
    }

    return (
      <div
        data-testid="terminal-pane-wrapper"
        data-session-id={session.id}
        data-mode={mode}
        data-focused={isFocusHighlightVisible || undefined}
        onClick={handleContainerClick}
        style={{
          ...containerStyle,
          background: 'var(--color-surface)',
          borderRadius: 10,
          transition: 'box-shadow 220ms ease, opacity 220ms ease',
          opacity: isPaneActive ? 1 : 0.78,
        }}
        className="relative isolate flex h-full w-full flex-col overflow-hidden"
      >
        <Header
          agent={agent}
          session={session}
          worktreeName={worktreeName}
          branch={branch}
          cwd={pane.cwd}
          added={added}
          removed={removed}
          isFocused={isFocusHighlightVisible}
          isCollapsed={isCollapsed}
          ptyId={pane.ptyId}
          paneAgentTitle={pane.agentTitle}
          paneUserLabel={pane.userLabel}
          onToggleCollapse={handleToggleCollapse}
          onClose={onClose ? handleClose : undefined}
          onBurner={onBurner ? handleBurner : undefined}
          burnerActive={
            activeBurnerPaneKeys?.has(`${session.id}:${pane.id}`) ?? false
          }
          burnerShellExists={
            runningBurnerPaneKeys?.has(`${session.id}:${pane.id}`) ?? false
          }
          draggable={paneDraggable}
          onHeaderDragStart={onHeaderDragStart}
          onHeaderDragEnd={onHeaderDragEnd}
        />

        {isAwaitingRestart ? (
          <RestartAffordance
            agent={agent}
            sessionId={session.id}
            exitedAt={session.lastActivityAt}
            onRestart={handleRestart}
          />
        ) : (
          <div className="relative min-h-0 flex-1">
            <Body
              ref={bodyRef}
              sessionId={pane.ptyId}
              cwd={pane.cwd}
              service={service}
              restoredFrom={pane.restoreData}
              onCwdChange={onCwdChange}
              onPaneReady={onPaneReady}
              onCommandSubmit={onCommandSubmit}
              mode={mode}
              onPtyStatusChange={setPtyStatus}
              deferFit={deferFit}
              terminalFontFamily={terminalFontFamily}
              enableImagePaste={enableImagePaste}
            />
          </div>
        )}

        <Footer
          agent={agent}
          isFocused={isFocusHighlightVisible}
          isIdle={isIdle}
          onClickFocus={handleContainerClick}
          placeholder={footerPlaceholder}
        />
        <span
          data-testid="terminal-pane-focus-ring"
          aria-hidden="true"
          style={focusRingStyle}
          className="pointer-events-none absolute inset-0 z-30 rounded-[10px]"
        />
      </div>
    )
  }
)
