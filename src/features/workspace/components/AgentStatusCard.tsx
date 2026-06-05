// cspell:ignore incard
import type { ReactElement } from 'react'
import { SidebarToggle } from './SidebarToggle'
import { RateLimitBar } from '../../agent-status/components/RateLimitBar'

// Fused agent-status card (VIM-66 — AGENT-STATUS-CARD-HANDOFF + SHELL-CARD-KIT).
// ONE fixed height in every state: the below-header body is locked to
// CARD_BODY_H, so switching the active pane between an agent and a pure shell
// never changes the card height (and never reflows the session list below it).
// Agent panes fill the body with model metrics + rate-limit bars; a pure shell
// fills the same box with a placeholder tile. Borderless elevated surface with
// a faint state-tinted corner wash. The explicit running dot/label was removed
// by request.

export type AgentCardState =
  | 'running'
  | 'awaiting'
  | 'completed'
  | 'errored'
  | 'idle'

export interface AgentStatusCardProps {
  /** Agent model name shown as the title; ignored when `isShell` (shows "SHELL"). */
  title: string
  /** Drives the ambient corner wash. */
  state: AgentCardState
  /** True when the active pane is a pure shell (no agent / model / usage). */
  isShell?: boolean
  /** Elapsed-time string (e.g. "8m"); omitted when falsy. */
  elapsed?: string | null
  /** Turn count; omitted when 0/absent. */
  turns?: number | null
  /** Context-window usage percent; omitted when null. */
  contextPct?: number | null
  /** 5-hour (session) rate-limit usage percent; omitted when null. */
  fiveHourPct?: number | null
  /** 7-day (weekly) rate-limit usage percent; omitted when null. */
  weekPct?: number | null
  onToggleSidebar: () => void
}

// Fixed below-header body height — the whole point of the SHELL kit. Agent
// content and the shell placeholder both render inside this exact height so the
// card never changes height and nothing below it reflows.
const CARD_BODY_H = 92

const STATE_WASH: Record<AgentCardState, string> = {
  running: 'rgba(80,250,123,0.08)',
  awaiting: 'rgba(255,148,165,0.09)',
  completed: 'rgba(203,166,247,0.09)',
  errored: 'rgba(255,180,171,0.09)',
  idle: 'rgba(138,130,153,0.05)',
}

interface MetricCell {
  icon: string
  value: string
  title: string
}

const Metric = ({
  cell,
  last,
}: {
  cell: MetricCell
  last: boolean
}): ReactElement => (
  <span
    style={{ display: 'inline-flex', alignItems: 'center' }}
    title={cell.title}
  >
    <span
      className="material-symbols-outlined"
      aria-hidden="true"
      style={{ fontSize: 12, color: '#6c7086', lineHeight: 1 }}
    >
      {cell.icon}
    </span>
    <span style={{ marginLeft: 4, color: '#cdc3d1' }}>{cell.value}</span>
    {!last && <span style={{ margin: '0 9px', color: '#3a3450' }}>·</span>}
  </span>
)

// Pure-shell placeholder. Fills the exact CARD_BODY_H so the card height
// matches an agent pane's.
const ShellBody = (): ReactElement => (
  <div
    data-testid="agent-status-card-shell-body"
    style={{
      height: CARD_BODY_H,
      marginTop: 11,
      borderRadius: 9,
      border: '1px dashed rgba(74,68,79,0.5)',
      background: 'rgba(13,13,28,0.28)',
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      padding: '0 13px',
    }}
  >
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        flexShrink: 0,
        background: 'rgba(108,112,134,0.14)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <span
        className="material-symbols-outlined"
        aria-hidden="true"
        style={{ fontSize: 18, color: '#9b93ab' }}
      >
        terminal
      </span>
    </div>
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: "'Instrument Sans', system-ui, sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: '#cdc3d1',
        }}
      >
        No active agent
      </div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: 999,
            border: '1.5px solid #4a444f',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#8a8299',
          }}
        >
          Idle · shell only
        </span>
      </div>
    </div>
  </div>
)

export const AgentStatusCard = ({
  title,
  state,
  isShell = false,
  elapsed = null,
  turns = null,
  contextPct = null,
  fiveHourPct = null,
  weekPct = null,
  onToggleSidebar,
}: AgentStatusCardProps): ReactElement => {
  // Guard each metric so a metric-less agent pane collapses gracefully (the
  // fixed-height body keeps the card the same size regardless).
  const metrics: MetricCell[] = []
  if (elapsed) {
    metrics.push({ icon: 'schedule', value: elapsed, title: 'Elapsed' })
  }
  if (turns && turns > 0) {
    metrics.push({ icon: 'forum', value: String(turns), title: 'Turns' })
  }
  if (contextPct !== null) {
    metrics.push({
      icon: 'data_usage',
      value: `${contextPct}%`,
      title: 'Context window',
    })
  }

  const hasUsage = fiveHourPct !== null || weekPct !== null
  const wash = isShell ? STATE_WASH.idle : STATE_WASH[state]

  return (
    <div
      data-testid="sidebar-agent-status-card"
      style={{
        position: 'relative',
        borderRadius: 13,
        padding: '13px 14px 14px',
        background: `radial-gradient(120% 90% at 0% 0%, ${wash} 0%, rgba(34,34,52,0) 55%), rgba(33,33,51,0.55)`,
        boxShadow:
          '0 5px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.045)',
        overflow: 'hidden',
        // The card is chrome, not editable text — show the default arrow rather
        // than the text I-beam over the title/labels. `cursor` inherits, so this
        // covers all the card's text; the toggle re-asserts `cursor-pointer`.
        cursor: 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SidebarToggle
          onClick={onToggleSidebar}
          size={28}
          variant="inset"
          data-testid="sidebar-toggle-incard"
        />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "'Instrument Sans', system-ui, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            color: '#e9e6fb',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {isShell ? 'SHELL' : title}
        </div>
      </div>

      {isShell ? (
        <ShellBody />
      ) : (
        <div style={{ height: CARD_BODY_H, marginTop: 11 }}>
          {metrics.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: '#8a8299',
              }}
            >
              {metrics.map((cell, index) => (
                <Metric
                  key={cell.icon}
                  cell={cell}
                  last={index === metrics.length - 1}
                />
              ))}
            </div>
          )}

          {hasUsage && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: metrics.length > 0 ? 12 : 0,
              }}
            >
              {fiveHourPct !== null && (
                <RateLimitBar label="5-hour Session" percentage={fiveHourPct} />
              )}
              {weekPct !== null && (
                <RateLimitBar label="Weekly Usage" percentage={weekPct} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
