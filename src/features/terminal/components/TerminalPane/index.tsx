import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { useGitBranch } from '../../../diff/hooks/useGitBranch'
import { useGitStatus } from '../../../diff/hooks/useGitStatus'
import type { Session, SessionStatus } from '../../../sessions/types'
import { agentForSession } from '../../../sessions/utils/agentForSession'
import type { NotifyPaneReady, RestoreData } from '../../hooks/useTerminal'
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
import { useFocusedPane } from './useFocusedPane'

export type TerminalPaneMode = 'attach' | 'spawn' | 'awaiting-restart'

export interface TerminalPaneProps {
  sessionId: string
  cwd: string
  service: ITerminalService
  shell?: string
  env?: Record<string, string>
  restoredFrom?: RestoreData
  onCwdChange?: (cwd: string) => void
  onPaneReady?: NotifyPaneReady
  mode?: TerminalPaneMode
  onRestart?: (sessionId: string) => void
  session: Session
  isActive: boolean
  onClose?: (sessionId: string) => void
}

export {
  clearTerminalCache,
  disposeTerminalSession,
  terminalCache,
} from './Body'

export const TerminalPane = ({
  sessionId,
  cwd,
  service,
  shell = undefined,
  env = undefined,
  restoredFrom = undefined,
  onCwdChange = undefined,
  onPaneReady = undefined,
  mode = 'spawn',
  onRestart = undefined,
  session,
  isActive,
  onClose = undefined,
}: TerminalPaneProps): ReactElement => {
  const agent = agentForSession(session)
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<BodyHandle>(null)
  const [ptyStatus, setPtyStatus] = useState<PtyStatus>('idle')
  const [isCollapsed, setIsCollapsed] = useState(false)

  const { isFocused, setFocused, onTerminalFocusChange } = useFocusedPane({
    containerRef,
  })

  const pipStatus: SessionStatus =
    mode === 'awaiting-restart'
      ? session.status
      : ptyStatusToSessionStatus(ptyStatus)

  const isPaused = pipStatus === 'paused'

  const { branch } = useGitBranch(session.workingDirectory, {
    enabled: isActive,
  })

  const { files, filesCwd } = useGitStatus(session.workingDirectory, {
    enabled: isActive,
  })

  const isFresh = filesCwd === session.workingDirectory

  const { added, removed } = useMemo(
    () => (isFresh ? aggregateLineDelta(files) : { added: 0, removed: 0 }),
    [files, isFresh]
  )

  const handleContainerClick = useCallback((): void => {
    bodyRef.current?.focusTerminal()
    setFocused(true)
  }, [setFocused])

  const handleToggleCollapse = useCallback((): void => {
    setIsCollapsed((collapsed) => !collapsed)
  }, [])

  const handleClose = useCallback((): void => {
    onClose?.(session.id)
  }, [onClose, session.id])

  const handleRestart = useCallback(
    (restartSessionId: string): void => {
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
      ref={containerRef}
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
            sessionId={sessionId}
            cwd={cwd}
            service={service}
            shell={shell}
            env={env}
            restoredFrom={restoredFrom}
            onCwdChange={onCwdChange}
            onPaneReady={onPaneReady}
            mode={mode}
            onPtyStatusChange={setPtyStatus}
            onFocusChange={onTerminalFocusChange}
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
