// cspell:ignore worktree
import { useEffect, useRef, type ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import { StatusDot } from '../../../sessions/components/StatusDot'
import type { Session, SessionStatus } from '../../../sessions/types'
import { register, unregister } from '../../paneHeaderRefs'
import { HeaderActions } from './HeaderActions'
import { HeaderMetadata } from './HeaderMetadata'

export interface HeaderProps {
  agent: Agent
  session: Session
  pipStatus: SessionStatus
  worktreeName: string | null
  branch: string | null
  cwd?: string
  added: number
  removed: number
  isFocused: boolean
  isCollapsed: boolean
  ptyId: string
  paneAgentTitle?: string
  paneUserLabel?: string
  onToggleCollapse: () => void
  onClose?: () => void
  onBurner?: () => void
  burnerActive?: boolean
}

export const Header = ({
  agent,
  session,
  pipStatus,
  worktreeName,
  branch,
  cwd = undefined,
  added,
  removed,
  isFocused,
  isCollapsed,
  ptyId,
  paneAgentTitle = undefined,
  paneUserLabel = undefined,
  onToggleCollapse,
  onClose = undefined,
  onBurner = undefined,
  burnerActive = false,
}: HeaderProps): ReactElement => {
  const titleRef = useRef<HTMLSpanElement | null>(null)

  const headerStyle = isFocused
    ? {
        background: `linear-gradient(180deg, ${agent.accentDim}, rgba(13,13,28,0.0))`,
      }
    : { background: 'transparent' }

  useEffect(() => {
    if (titleRef.current) {
      register(ptyId, titleRef.current)
    }

    return (): void => unregister(ptyId)
  }, [ptyId])

  return (
    <div
      data-testid="terminal-pane-header"
      data-focused={isFocused || undefined}
      data-collapsed={isCollapsed || undefined}
      style={headerStyle}
      className={`flex shrink-0 select-none items-center gap-2.5 border-b border-outline-variant/[0.18] font-mono text-[10.5px] ${
        isCollapsed ? 'px-2.5 py-1.5' : 'pb-2 pl-2.5 pr-3 pt-2'
      }`}
    >
      <div
        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] font-semibold tracking-[0.04em]"
        style={{
          background: agent.accentDim,
          borderColor: agent.accentSoft,
          color: agent.accent,
        }}
      >
        <span className="text-[12px]" aria-hidden="true">
          {agent.glyph}
        </span>
        <span>{agent.short}</span>
      </div>

      <StatusDot status={pipStatus} size={6} aria-label={`pty ${pipStatus}`} />
      <span ref={titleRef} className="min-w-0 truncate text-on-surface">
        {paneUserLabel ?? paneAgentTitle ?? session.name}
      </span>

      {!isCollapsed && (
        <HeaderMetadata
          worktreeName={worktreeName}
          branch={branch}
          cwd={cwd}
          added={added}
          removed={removed}
          session={session}
        />
      )}

      <span className="flex-1" />

      <HeaderActions
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        onClose={onClose}
        onBurner={onBurner}
        burnerActive={burnerActive}
      />
    </div>
  )
}
