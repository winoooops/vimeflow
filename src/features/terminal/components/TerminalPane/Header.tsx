import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import { StatusDot } from '../../../sessions/components/StatusDot'
import type { Session, SessionStatus } from '../../../sessions/types'
import { HeaderActions } from './HeaderActions'
import { HeaderMetadata } from './HeaderMetadata'

export interface HeaderProps {
  agent: Agent
  session: Session
  pipStatus: SessionStatus
  branch: string | null
  added: number
  removed: number
  isFocused: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose?: () => void
}

export const Header = ({
  agent,
  session,
  pipStatus,
  branch,
  added,
  removed,
  isFocused,
  isCollapsed,
  onToggleCollapse,
  onClose = undefined,
}: HeaderProps): ReactElement => {
  const headerStyle = isFocused
    ? {
        background: `linear-gradient(180deg, ${agent.accentDim}, rgba(13,13,28,0.0))`,
      }
    : { background: 'transparent' }

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
      <span className="min-w-0 truncate text-on-surface">{session.name}</span>

      {!isCollapsed && (
        <HeaderMetadata
          branch={branch}
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
      />
    </div>
  )
}
