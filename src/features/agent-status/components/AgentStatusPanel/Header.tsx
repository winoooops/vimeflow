import type { ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import { AgentGlyph } from '@/components/AgentGlyph'
import type { Agent } from '../../../../agents/registry'

export interface AgentStatusPanelHeaderProps {
  agent: Agent
  isRefreshing?: boolean
  /**
   * Session is known-stale after a codex `/clear`: show the red state. Recovery
   * is automatic — the watcher relocates once codex writes the conversation
   * (i.e. when the user sends a prompt), so this is an instruction, not a button.
   */
  needsReattach?: boolean
  onCollapse: () => void
  reserveWindowControls?: boolean
}

export const AgentStatusPanelHeader = ({
  agent,
  isRefreshing = false,
  needsReattach = false,
  onCollapse,
  reserveWindowControls = false,
}: AgentStatusPanelHeaderProps): ReactElement => (
  <div
    data-testid="agent-status-panel-header"
    className={`relative flex h-11 shrink-0 items-center gap-2.5 pr-2 pl-3.5 ${
      reserveWindowControls ? 'vf-app-drag-region' : ''
    }`}
    style={{
      background: `linear-gradient(180deg, ${agent.accentDim}, transparent 80%)`,
    }}
  >
    <div
      data-testid="agent-glyph-chip"
      data-refreshing={isRefreshing ? 'true' : 'false'}
      data-stale={needsReattach ? 'true' : 'false'}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-md font-mono text-xs font-bold ${
        needsReattach ? 'ring-1 ring-error' : ''
      } ${isRefreshing ? 'vf-activity-glyph-refresh' : ''}`}
      style={{ background: agent.accentDim, color: agent.accent }}
    >
      <AgentGlyph agent={agent} size={14} />
    </div>
    <div className="flex min-w-0 flex-1 flex-col justify-center">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-headline text-[13px] font-semibold text-on-surface">
          {agent.short}
        </span>
        {needsReattach ? (
          <span
            className="material-symbols-outlined text-[11px] text-error"
            aria-hidden="true"
          >
            link_off
          </span>
        ) : (
          isRefreshing && (
            <span
              className="material-symbols-outlined text-[11px] text-on-surface-muted motion-safe:animate-spin"
              aria-hidden="true"
            >
              sync
            </span>
          )
        )}
      </div>
      <span
        className={`h-3 truncate font-mono text-[10px] leading-3 ${
          needsReattach ? 'text-error' : 'text-on-surface-muted'
        }`}
      >
        {needsReattach
          ? 'send a prompt to reattach'
          : isRefreshing
            ? 'fetching latest'
            : 'updated now'}
      </span>
    </div>
    <IconButton
      icon="chevron_right"
      label="Collapse activity panel"
      onClick={onCollapse}
      className="vf-app-no-drag shrink-0"
    />
    <div
      className="absolute right-0 bottom-0 left-0 h-px overflow-hidden bg-outline-variant/25"
      aria-hidden="true"
    >
      {isRefreshing && <div className="vf-activity-refresh-comet h-full" />}
    </div>
  </div>
)
