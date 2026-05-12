import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { useGitBranch } from '../../../diff/hooks/useGitBranch'
import { useGitStatus } from '../../../diff/hooks/useGitStatus'
import type { Pane, Session, SessionStatus } from '../../../sessions/types'
import { agentForPane } from '../../../sessions/utils/agentForSession'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
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
  onClose?: (sessionId: string) => void
  onCwdChange?: (cwd: string) => void
  onRestart?: (sessionId: string) => void
  deferFit?: boolean
}

export {
  clearTerminalCache,
  disposeTerminalSession,
  terminalCache,
} from './Body'

export const TerminalPane = ({
  session,
  pane,
  isActive,
  service,
  onPaneReady = undefined,
  mode = 'spawn',
  onClose = undefined,
  onCwdChange = undefined,
  onRestart = undefined,
  deferFit = false,
}: TerminalPaneProps): ReactElement => {
  const agent = agentForPane(pane)
  const bodyRef = useRef<BodyHandle>(null)
  const [ptyStatus, setPtyStatus] = useState<PtyStatus>('idle')
  const [isCollapsed, setIsCollapsed] = useState(false)

  const isFocused = pane.active

  const pipStatus: SessionStatus =
    mode === 'awaiting-restart'
      ? pane.status
      : ptyStatusToSessionStatus(ptyStatus)

  const isPaused = pipStatus === 'paused'

  const { branch } = useGitBranch(pane.cwd, {
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
    bodyRef.current?.focusTerminal()
  }, [])

  const handleToggleCollapse = useCallback((): void => {
    setIsCollapsed((collapsed) => !collapsed)
  }, [])

  const handleClose = useCallback((): void => {
    onClose?.(session.id)
  }, [onClose, session.id])

  const handleRestart = useCallback(
    (restartSessionId: string): void => {
      // TODO(#202): for multi-pane sessions, this needs to thread `pane.id`
      // through so `useSessionManager.restartSession` targets the clicked
      // pane instead of `getActivePane(session)`. Deferred to 5c (production
      // multi-pane). Bug only fires when a non-active pane is in completed/
      // errored state — unreachable in 5b's single-pane production.
      onRestart?.(restartSessionId)
    },
    [onRestart]
  )

  const isAwaitingRestart = mode === 'awaiting-restart'

  const footerPlaceholder = isAwaitingRestart
    ? `session ended — restart to resume ${agent.short.toLowerCase()}`
    : undefined

  const containerStyle = isFocused
    ? {
        boxShadow: `0 0 0 6px ${agent.accentDim}, 0 8px 32px rgba(0,0,0,0.35)`,
        cursor: 'default' as const,
      }
    : {
        boxShadow: 'none',
        cursor: 'pointer' as const,
      }

  const focusRingStyle = {
    border: isFocused
      ? `2px solid ${agent.accent}`
      : '1px solid rgba(74,68,79,0.22)',
    transition:
      'border-color 180ms ease, box-shadow 220ms ease, opacity 220ms ease',
  }

  return (
    <div
      data-testid="terminal-pane-wrapper"
      data-session-id={session.id}
      data-mode={mode}
      data-focused={isFocused || undefined}
      onClick={handleContainerClick}
      style={{
        ...containerStyle,
        background: '#121221',
        borderRadius: 10,
        transition: 'box-shadow 220ms ease, opacity 220ms ease',
        opacity: isFocused ? 1 : 0.78,
      }}
      className="relative flex h-full w-full flex-col overflow-hidden"
    >
      <Header
        agent={agent}
        session={session}
        pipStatus={pipStatus}
        branch={branch}
        added={added}
        removed={removed}
        isFocused={isFocused}
        isCollapsed={isCollapsed}
        onToggleCollapse={handleToggleCollapse}
        onClose={onClose ? handleClose : undefined}
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
            mode={mode}
            onPtyStatusChange={setPtyStatus}
            deferFit={deferFit}
          />
        </div>
      )}

      <Footer
        agent={agent}
        pipStatus={pipStatus}
        isFocused={isFocused}
        isPaused={isPaused}
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
