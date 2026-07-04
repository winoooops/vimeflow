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
  type MouseEvent,
  type ReactElement,
} from 'react'
import { useGitBranch } from '../../../diff/hooks/useGitBranch'
import { useGitStatus } from '../../../diff/hooks/useGitStatus'
import { useGitWorktree } from '../../../diff/hooks/useGitWorktree'
import type { Pane, Session } from '../../../sessions/types'
import { agentForPane } from '../../../sessions/utils/agentForSession'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { BurnerTarget } from '../../hooks/useBurnerTerminals'
import type { NativeGhosttyShortcutContext } from '../../nativeGhosttyClient'
import type { ITerminalService } from '../../services/terminalService'
import { aggregateLineDelta } from './aggregateLineDelta'
import type { BodyMode } from './Body'
import { Header } from './Header'
import { PaneStatusBar } from './PaneStatusBar'
import { RestartAffordance } from './RestartAffordance'
import { TerminalBody, type TerminalBodyHandle } from './TerminalBody'
import { usePaneWidth } from './usePaneWidth'

// A pane narrower than this auto-collapses the bottom status bar. Tunable.
const AUTO_COLLAPSE_PANE_WIDTH_PX = 220
const TERMINAL_PANE_CORNER_RADIUS = 10

const INTERACTIVE_TARGET_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

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
  onRequestFocus?: () => void
  /** Pane-keys with a foreground command running — drives the amber button tint (VIM-71). */
  activeBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys whose burner secondary terminal is currently visible. */
  openBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys with a live burner shell (idle or active) — drives a11y state (VIM-53). */
  runningBurnerPaneKeys?: ReadonlySet<string>
  onCwdChange?: (cwd: string) => void
  onCommandSubmit?: (ptyId: string, command: string) => void
  onRestart?: (sessionId: string, paneId?: string) => void
  deferFit?: boolean
  shortcutContext?: NativeGhosttyShortcutContext
  shortcutHint?: string
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
      onRequestFocus = undefined,
      activeBurnerPaneKeys = undefined,
      openBurnerPaneKeys = undefined,
      runningBurnerPaneKeys = undefined,
      onCwdChange = undefined,
      onCommandSubmit = undefined,
      onRestart = undefined,
      deferFit = false,
      shortcutContext = undefined,
      shortcutHint = undefined,
      paneDraggable = false,
      onHeaderDragStart = undefined,
      onHeaderDragEnd = undefined,
    }: TerminalPaneProps,
    ref
  ): ReactElement {
    const agent = agentForPane(pane)
    const bodyRef = useRef<TerminalBodyHandle>(null)
    // Seeded `undefined` (NOT `pane.active`) so the first effect run can detect
    // initial mount distinctly from a stable `true → true` re-render. A pane
    // born active (createSession, addPane, restored on app launch) must focus
    // on first paint — otherwise its xterm stays unfocused with no transition
    // for the rising-edge branch below to catch.
    const wasActiveRef = useRef<boolean | undefined>(undefined)
    const wrapperRef = useRef<HTMLDivElement | null>(null)
    const [manuallyCollapsed, setManuallyCollapsed] = useState(false)
    // Width-driven auto-collapse: a pane too narrow for the expanded chrome
    // hides the bottom status bar for real, so the button state stays in sync.
    const paneWidth = usePaneWidth(wrapperRef)

    const autoCollapsed =
      paneWidth !== null && paneWidth < AUTO_COLLAPSE_PANE_WIDTH_PX
    const isCollapsed = manuallyCollapsed || autoCollapsed

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

    useEffect(() => {
      // Fire on `undefined → true` (initial mount active) AND `false → true`
      // (existing rising edge). Stable `true → true` re-renders are skipped.
      if (pane.active && wasActiveRef.current !== true) {
        bodyRef.current?.focusTerminal()
      }
      wasActiveRef.current = pane.active
    }, [pane.active])

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

    const requestPaneActive = useCallback((): void => {
      if (!pane.active) {
        onRequestActive?.(session.id, pane.id)
      }
    }, [onRequestActive, pane.active, pane.id, session.id])

    const handleContainerClick = useCallback(
      (event: MouseEvent<HTMLDivElement>): void => {
        if (!pane.active) {
          event.stopPropagation()

          return
        }

        bodyRef.current?.focusTerminal()
      },
      [pane.active]
    )

    const handleContainerMouseDown = useCallback(
      (event: MouseEvent<HTMLDivElement>): void => {
        if (
          event.target instanceof Element &&
          event.target.closest(INTERACTIVE_TARGET_SELECTOR)
        ) {
          return
        }

        if (!pane.active) {
          requestPaneActive()

          return
        }
        bodyRef.current?.focusTerminal()
      },
      [pane.active, requestPaneActive]
    )

    const handleToggleCollapse = useCallback((): void => {
      setManuallyCollapsed((collapsed) => !collapsed)
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
      onBurner?.({
        sessionId: session.id,
        paneId: pane.id,
        hostPtyId: pane.ptyId,
        cwd: pane.cwd,
      })
    }, [onRequestActive, onBurner, session.id, pane.id, pane.ptyId, pane.cwd])

    const handleRestart = useCallback(
      (restartSessionId: string): void => {
        if (!pane.active) {
          onRequestActive?.(session.id, pane.id)
          onRestart?.(restartSessionId, pane.id)

          return
        }

        onRestart?.(restartSessionId, pane.id)
      },
      [onRequestActive, onRestart, pane.active, pane.id, session.id]
    )

    const isAwaitingRestart = mode === 'awaiting-restart'
    const hideCollapseToggle = isAwaitingRestart || autoCollapsed
    const enableImagePaste = pane.agentType !== 'generic'
    const bodyMode: BodyMode = mode === 'attach' ? 'attach' : 'spawn'

    const terminalBodyBottomCornerRadius = isCollapsed
      ? TERMINAL_PANE_CORNER_RADIUS
      : 0

    const containerStyle = {
      boxShadow: 'none',
      cursor: isPaneActive ? ('default' as const) : ('pointer' as const),
    }

    return (
      <div
        ref={wrapperRef}
        data-testid="terminal-pane-wrapper"
        data-session-id={session.id}
        data-mode={mode}
        data-pane-active={isPaneActive || undefined}
        onMouseDown={handleContainerMouseDown}
        onClick={handleContainerClick}
        style={{
          ...containerStyle,
          background: 'var(--color-surface-container-lowest)',
          borderRadius: TERMINAL_PANE_CORNER_RADIUS,
          transition: 'box-shadow 220ms ease, opacity 220ms ease',
          opacity: isPaneActive ? 1 : 0.78,
        }}
        className="@container/pane relative isolate flex h-full w-full flex-col overflow-hidden"
      >
        <Header
          agent={agent}
          session={session}
          isActive={isPaneActive}
          isCollapsed={isCollapsed}
          autoCollapsed={autoCollapsed}
          hideCollapseToggle={hideCollapseToggle}
          ptyId={pane.ptyId}
          paneAgentTitle={pane.agentTitle}
          paneUserLabel={pane.userLabel}
          shortcutHint={shortcutHint}
          onToggleCollapse={handleToggleCollapse}
          onClose={onClose ? handleClose : undefined}
          onBurner={onBurner ? handleBurner : undefined}
          burnerActive={
            activeBurnerPaneKeys?.has(`${session.id}:${pane.id}`) ?? false
          }
          burnerOpen={
            openBurnerPaneKeys?.has(`${session.id}:${pane.id}`) ?? false
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
          <div
            data-testid="terminal-pane-body-slot"
            className={`relative min-h-0 flex-1 ${
              isCollapsed ? 'overflow-hidden' : ''
            }`}
            style={{
              borderBottomLeftRadius: terminalBodyBottomCornerRadius,
              borderBottomRightRadius: terminalBodyBottomCornerRadius,
            }}
          >
            <TerminalBody
              ref={bodyRef}
              paneId={pane.id}
              ptyId={pane.ptyId}
              cwd={pane.cwd}
              active={isActive && pane.active}
              service={service}
              restoredFrom={pane.restoreData}
              onCwdChange={onCwdChange}
              onPaneReady={onPaneReady}
              onCommandSubmit={onCommandSubmit}
              onRequestActive={requestPaneActive}
              onRequestFocus={onRequestFocus}
              shortcutContext={shortcutContext}
              bottomCornerRadius={terminalBodyBottomCornerRadius}
              mode={bodyMode}
              deferFit={deferFit}
              enableImagePaste={enableImagePaste}
            />
          </div>
        )}

        {!isAwaitingRestart && !isCollapsed && (
          <PaneStatusBar
            isActive={isPaneActive}
            worktreeName={worktreeName}
            branch={branch}
            cwd={pane.cwd}
            nativeOverlay
            added={added}
            removed={removed}
            lastActivityAt={session.lastActivityAt}
          />
        )}

        <span
          data-testid="terminal-pane-border"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 rounded-[10px] border border-outline-variant/[0.22] transition-opacity"
        />
      </div>
    )
  }
)
