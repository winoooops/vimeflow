// cspell:ignore worktree
import { useEffect, useRef, type ReactElement } from 'react'
import { Chip } from '@/components/Chip'
import { AgentGlyph } from '@/components/AgentGlyph'
import type { Agent } from '../../../../agents/registry'
import type { Session } from '../../../sessions/types'
import { register, unregister } from '../../paneHeaderRefs'
import { HeaderActions } from './HeaderActions'

export interface HeaderProps {
  agent: Agent
  session: Session
  isFocused: boolean
  isCollapsed: boolean
  autoCollapsed?: boolean
  ptyId: string
  paneAgentTitle?: string
  paneUserLabel?: string
  onToggleCollapse: () => void
  onClose?: () => void
  onBurner?: () => void
  burnerActive?: boolean
  burnerShellExists?: boolean
}

export const Header = ({
  agent,
  session,
  isFocused,
  isCollapsed,
  autoCollapsed = false,
  ptyId,
  paneAgentTitle = undefined,
  paneUserLabel = undefined,
  onToggleCollapse,
  onClose = undefined,
  onBurner = undefined,
  burnerActive = false,
  burnerShellExists = false,
}: HeaderProps): ReactElement => {
  const titleRef = useRef<HTMLSpanElement | null>(null)

  const headerStyle = isFocused
    ? {
        background: `linear-gradient(180deg, ${agent.accentDim}, color-mix(in srgb, var(--color-surface-container-lowest) 0%, transparent))`,
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
      <Chip
        data-testid="agent-glyph-chip"
        tone="custom"
        radius="md"
        size="custom"
        className="shrink-0 gap-1.5 rounded-md border px-2 py-[3px] font-semibold tracking-[0.04em]"
        style={{
          background: agent.accentDim,
          borderColor: agent.accentSoft,
          color: agent.accent,
        }}
      >
        <span className="text-[12px]" aria-hidden="true">
          <AgentGlyph agent={agent} size={12} />
        </span>
        <span>{agent.short}</span>
      </Chip>

      {/* Flexible title truncates so the fixed action zone never clips. */}
      <span ref={titleRef} className="min-w-0 flex-1 truncate text-on-surface">
        {paneUserLabel ?? paneAgentTitle ?? session.name}
      </span>

      <div className="flex shrink-0 items-center gap-2.5">
        <HeaderActions
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
          autoCollapsed={autoCollapsed}
          onClose={onClose}
          onBurner={onBurner}
          burnerActive={burnerActive}
          burnerShellExists={burnerShellExists}
        />
      </div>
    </div>
  )
}
