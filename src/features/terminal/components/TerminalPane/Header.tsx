// cspell:ignore worktree
import { useEffect, useRef, type DragEvent, type ReactElement } from 'react'
import { Chip } from '@/components/Chip'
import { AgentGlyph } from '@/components/AgentGlyph'
import type { Agent } from '@/agents/registry'
import type { Session } from '@/features/sessions/types'
import type { BurnerPlacement } from '@/features/terminal/hooks/useBurnerTerminals'
import { register, unregister } from '@/features/terminal/paneHeaderRefs'
import { HeaderActions } from './HeaderActions'

export interface HeaderProps {
  agent: Agent
  session: Session
  isActive: boolean
  isCollapsed: boolean
  autoCollapsed?: boolean
  hideCollapseToggle?: boolean
  ptyId: string
  paneAgentTitle?: string
  paneUserLabel?: string
  shortcutHint?: string
  onToggleCollapse: () => void
  onClose?: () => void
  onBurner?: () => void
  onSyncBurner?: () => void
  onCycleBurnerPlacement?: () => void
  burnerPlacement?: BurnerPlacement
  burnerActive?: boolean
  burnerOpen?: boolean
  burnerShellExists?: boolean
  burnerOutOfSync?: boolean
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
  isActive,
  isCollapsed,
  autoCollapsed = false,
  hideCollapseToggle = false,
  ptyId,
  paneAgentTitle = undefined,
  paneUserLabel = undefined,
  shortcutHint = undefined,
  onToggleCollapse,
  onClose = undefined,
  onBurner = undefined,
  onSyncBurner = undefined,
  onCycleBurnerPlacement = undefined,
  burnerPlacement = undefined,
  burnerActive = false,
  burnerOpen = false,
  burnerShellExists = false,
  burnerOutOfSync = false,
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

  useEffect(() => {
    if (titleRef.current) {
      register(ptyId, titleRef.current)
    }

    return (): void => unregister(ptyId)
  }, [ptyId])

  return (
    <div
      data-testid="terminal-pane-header"
      className={`flex shrink-0 select-none items-center border-b border-outline-variant/[0.18] font-mono text-[10.5px] ${
        isActive ? 'bg-primary-container/15' : ''
      } gap-1.5 px-2 py-1`}
    >
      {/* Drag handle is isolated to the left/title rect so gaps around the
       * action buttons do not inherit the grab cursor or start a drag. */}
      <div
        data-testid="terminal-pane-drag-handle"
        data-drag-handle={draggable || undefined}
        draggable={draggable}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ cursor: draggable ? 'grab' : undefined }}
        className={`-my-1 -ml-2 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-[10px] px-2 py-1 ${
          isActive ? 'bg-primary-container/15' : 'bg-surface-container-lowest'
        }`}
      >
        <Chip
          data-testid="agent-glyph-chip"
          tone="custom"
          radius="md"
          size="custom"
          className="h-[22px] w-[22px] shrink-0 justify-center rounded-md border p-0 font-semibold tracking-[0.04em]"
          style={{
            background: agent.accentDim,
            borderColor: agent.accentSoft,
            color: agent.accent,
          }}
        >
          <span className="text-[12px]" aria-hidden="true">
            <AgentGlyph agent={agent} size={12} />
          </span>
          <span data-testid="agent-glyph-label" className="hidden">
            {agent.short}
          </span>
        </Chip>

        {/* Flexible title truncates so the fixed action zone never clips. */}
        <span
          ref={titleRef}
          className="min-w-0 flex-1 truncate text-on-surface"
        >
          {paneUserLabel ?? paneAgentTitle ?? session.name}
        </span>
      </div>

      <div
        data-testid="terminal-pane-header-actions"
        className="flex shrink-0 items-center gap-1.5"
      >
        <HeaderActions
          isCollapsed={isCollapsed}
          onToggleCollapse={onToggleCollapse}
          shortcutHint={shortcutHint}
          hideCollapseToggle={hideCollapseToggle || autoCollapsed}
          onClose={onClose}
          onBurner={onBurner}
          onSyncBurner={onSyncBurner}
          onCycleBurnerPlacement={onCycleBurnerPlacement}
          burnerPlacement={burnerPlacement}
          burnerActive={burnerActive}
          burnerOpen={burnerOpen}
          burnerShellExists={burnerShellExists}
          burnerOutOfSync={burnerOutOfSync}
        />
      </div>
    </div>
  )
}
