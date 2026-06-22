// cspell:ignore worktree
import { useEffect, useRef, type DragEvent, type ReactElement } from 'react'
import { Chip } from '@/components/Chip'
import { AgentGlyph } from '@/components/AgentGlyph'
import type { Agent } from '../../../../agents/registry'
import type { Session } from '../../../sessions/types'
import { register, unregister } from '../../paneHeaderRefs'
import { HeaderActions } from './HeaderActions'
import { HeaderMetadata } from './HeaderMetadata'

export interface HeaderProps {
  agent: Agent
  session: Session
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
  burnerShellExists?: boolean
  /**
   * VIM-167: when true, the header acts as the pane's drag handle for the
   * drag-into-slot interaction. The terminal body stays non-draggable so xterm
   * text selection is unaffected.
   */
  draggable?: boolean
  onHeaderDragStart?: (event: DragEvent<HTMLDivElement>) => void
  onHeaderDragEnd?: (event: DragEvent<HTMLDivElement>) => void
}

export const Header = ({
  agent,
  session,
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
  burnerShellExists = false,
  draggable = false,
  onHeaderDragStart = undefined,
  onHeaderDragEnd = undefined,
}: HeaderProps): ReactElement => {
  const titleRef = useRef<HTMLSpanElement | null>(null)

  // The pane clips the header's top corners (rounded) but its bottom sits
  // mid-pane and stays square, so the native drag snapshot reads as a slab.
  // Round all corners for the duration of the drag so the snapshot looks like a
  // pill (matching the pane's 10px). Chromium paints the drag image after this
  // synchronous handler, so the inline radius is captured; reverted on drag end.
  const handleDragStart = (event: DragEvent<HTMLDivElement>): void => {
    event.currentTarget.style.borderRadius = '10px'
    onHeaderDragStart?.(event)
  }

  const handleDragEnd = (event: DragEvent<HTMLDivElement>): void => {
    event.currentTarget.style.borderRadius = ''
    onHeaderDragEnd?.(event)
  }

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
      data-drag-handle={draggable || undefined}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{
        ...headerStyle,
        cursor: draggable ? 'grab' : undefined,
      }}
      className={`flex shrink-0 select-none items-center gap-2.5 border-b border-outline-variant/[0.18] font-mono text-[10.5px] ${
        isCollapsed ? 'px-2.5 py-1.5' : 'pb-2 pl-2.5 pr-3 pt-2'
      }`}
    >
      <Chip
        data-testid="agent-glyph-chip"
        tone="custom"
        radius="md"
        size="custom"
        className="gap-1.5 rounded-md border px-2 py-[3px] font-semibold tracking-[0.04em]"
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
        burnerShellExists={burnerShellExists}
      />
    </div>
  )
}
