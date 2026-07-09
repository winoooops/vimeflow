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
  /** Selected-pane activity: drives focus, chrome emphasis, and body interactivity. */
  isActive: boolean
  /** Session visibility: drives background metadata for panes mounted on screen. */
  isSessionVisible?: boolean
  service: ITerminalService
  onPaneReady?: NotifyPaneReady
  mode?: TerminalPaneMode
  onClose?: (sessionId: string, paneId: string) => void
  /** Toggle this pane's ephemeral burner terminal (VIM-53). */
  onBurner?: (target: BurnerTarget) => void
  /** Sync this pane's burner terminal back to the pane cwd. */
  onSyncBurner?: (target: BurnerTarget) => void
  /** Make this pane active — the burner button focuses its pane (spec §8). */
  onRequestActive?: (sessionId: string, paneId: string) => void
  onRequestFocus?: () => void
  /** Pane-keys with a foreground command running — drives the amber button tint (VIM-71). */
  activeBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys whose burner secondary terminal is currently visible. */
  openBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys with a live burner shell (idle or active) — drives a11y state (VIM-53). */
  runningBurnerPaneKeys?: ReadonlySet<string>
  /** Pane-keys whose burner terminal cwd has drifted from its host pane cwd. */
  outOfSyncBurnerPaneKeys?: ReadonlySet<string>
  onCwdChange?: (cwd: string) => void
  onCommandSubmit?: (ptyId: string, command: string) => void
  onRestart?: (sessionId: string, paneId?: string) => void
  deferFit?: boolean
  showFocusHighlight?: boolean
  terminalFontFamily?: string
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
      isSessionVisible = isActive,
      service,
      onPaneReady = undefined,
      mode = 'spawn',
      onClose = undefined,
      onBurner = undefined,
      onSyncBurner = undefined,
      onRequestActive = undefined,
      onRequestFocus = undefined,
      activeBurnerPaneKeys = undefined,
      openBurnerPaneKeys = undefined,
      runningBurnerPaneKeys = undefined,
      outOfSyncBurnerPaneKeys = undefined,
      onCwdChange = undefined,
      onCommandSubmit = undefined,
      onRestart = undefined,
      deferFit = false,
      showFocusHighlight = true,
      terminalFontFamily = undefined,
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
    // Seeded `undefined` so the first effect run can detect
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

    useEffect(() => {
      // Fire on `undefined → true` (initial mount active) AND `false → true`
      // (existing rising edge). Stable `true → true` re-renders are skipped.
      if (isActive && wasActiveRef.current !== true) {
        bodyRef.current?.focusTerminal()
      }
      wasActiveRef.current = isActive
    }, [isActive])

    const { branch } = useGitBranch(pane.cwd, {
      enabled: isSessionVisible,
    })

    const { worktreeName } = useGitWorktree(pane.cwd, {
      enabled: isSessionVisible,
    })

    const { files, filesCwd } = useGitStatus(pane.cwd, {
      enabled: isSessionVisible,
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
        if (!isActive) {
          event.stopPropagation()

          return
        }

        bodyRef.current?.focusTerminal()
      },
      [isActive]
    )

    const handleContainerMouseDown = useCallback(
      (event: MouseEvent<HTMLDivElement>): void => {
        if (
          event.target instanceof Element &&
          event.target.closest(INTERACTIVE_TARGET_SELECTOR)
        ) {
          return
        }

        if (!isActive) {
          requestPaneActive()

          return
        }
        bodyRef.current?.focusTerminal()
      },
      [isActive, requestPaneActive]
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

    const handleSyncBurner = useCallback((): void => {
      onRequestActive?.(session.id, pane.id)
      onSyncBurner?.({
        sessionId: session.id,
        paneId: pane.id,
        hostPtyId: pane.ptyId,
        cwd: pane.cwd,
      })
    }, [
      onRequestActive,
      onSyncBurner,
      session.id,
      pane.id,
      pane.ptyId,
      pane.cwd,
    ])

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
    const isFocusVisible = showFocusHighlight && isActive

    const containerStyle = {
      boxShadow: 'none',
      cursor: isActive ? ('default' as const) : ('pointer' as const),
    }

    return (
      <div
        ref={wrapperRef}
        data-testid="terminal-pane-wrapper"
        data-session-id={session.id}
        data-mode={mode}
        data-pane-active={isActive || undefined}
        data-focused={isActive || undefined}
        onMouseDown={handleContainerMouseDown}
        onClick={handleContainerClick}
        style={{
          ...containerStyle,
          background: 'var(--color-surface-container-lowest)',
          borderRadius: TERMINAL_PANE_CORNER_RADIUS,
          transition: 'box-shadow 220ms ease, opacity 220ms ease',
          opacity: isActive ? 1 : 0.78,
        }}
        className="@container/pane relative isolate flex h-full w-full flex-col overflow-hidden"
      >
        <Header
          agent={agent}
          session={session}
          isActive={isActive}
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
          onSyncBurner={onSyncBurner ? handleSyncBurner : undefined}
          burnerActive={
            activeBurnerPaneKeys?.has(`${session.id}:${pane.id}`) ?? false
          }
          burnerOpen={
            openBurnerPaneKeys?.has(`${session.id}:${pane.id}`) ?? false
          }
          burnerShellExists={
            runningBurnerPaneKeys?.has(`${session.id}:${pane.id}`) ?? false
          }
          burnerOutOfSync={
            outOfSyncBurnerPaneKeys?.has(`${session.id}:${pane.id}`) ?? false
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
              active={isActive}
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
              terminalFontFamily={terminalFontFamily}
              enableImagePaste={enableImagePaste}
            />
          </div>
        )}

        {!isAwaitingRestart && !isCollapsed && (
          <PaneStatusBar
            isActive={isActive}
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
          style={{ opacity: isFocusVisible ? 1 : 0 }}
        />
      </div>
    )
  }
)
