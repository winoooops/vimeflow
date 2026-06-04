// cspell:ignore incard
import type { ReactElement } from 'react'
import { SidebarToggle } from './SidebarToggle'

// Fused agent-status card (VIM-66 / AGENT-STATUS-CARD-HANDOFF). A single
// borderless elevated card at the top of the sidebar that surfaces the active
// session's live agent state. Depth comes from a drop shadow + a 1px inset top
// highlight (no hard border, no gradient header stripe); state reads from the
// dot + colored label + a faint state-tinted radial wash in the top-left.
// Literal palette values come straight from the handoff (no new tokens).

export type AgentCardState =
  | 'running'
  | 'awaiting'
  | 'completed'
  | 'errored'
  | 'idle'

export interface AgentStatusCardProps {
  title: string
  state: AgentCardState
  /** Current-action line; rendered only when present (clamped to 2 lines). */
  subtitle?: string | null
  /** Elapsed-time string (e.g. "2m"); omitted when falsy. */
  elapsed?: string | null
  /** Turn count; omitted when 0/absent. */
  turns?: number | null
  /** Context-window usage percent; omitted when null. */
  contextPct?: number | null
  onToggleSidebar: () => void
}

interface StateConfig {
  label: string
  labelColor: string
  wash: string
}

// state → label + label color + ambient corner wash (§2 of the handoff).
const STATE_CONFIG: Record<AgentCardState, StateConfig> = {
  running: {
    label: 'Running',
    labelColor: '#7defa1',
    wash: 'rgba(80,250,123,0.08)',
  },
  awaiting: {
    label: 'Awaiting you',
    labelColor: '#ff94a5',
    wash: 'rgba(255,148,165,0.09)',
  },
  completed: {
    label: 'Completed',
    labelColor: '#e2c7ff',
    wash: 'rgba(203,166,247,0.09)',
  },
  errored: {
    label: 'Errored',
    labelColor: '#ffb4ab',
    wash: 'rgba(255,180,171,0.09)',
  },
  idle: {
    label: 'Idle',
    labelColor: '#8a8299',
    wash: 'rgba(138,130,153,0.05)',
  },
}

interface DotConfig {
  bg: string
  border?: string
  ring: string
  pulse: boolean
}

const DOT_CONFIG: Record<AgentCardState, DotConfig> = {
  running: { bg: '#50fa7b', ring: 'rgba(80,250,123,0.45)', pulse: true },
  awaiting: { bg: '#ff94a5', ring: 'rgba(255,148,165,0.45)', pulse: true },
  completed: {
    bg: 'transparent',
    border: '1.5px solid #7defa1',
    ring: 'transparent',
    pulse: false,
  },
  errored: { bg: '#ffb4ab', ring: 'rgba(255,180,171,0.4)', pulse: false },
  idle: {
    bg: 'transparent',
    border: '1.5px solid #4a444f',
    ring: 'transparent',
    pulse: false,
  },
}

const StatusDot = ({ state }: { state: AgentCardState }): ReactElement => {
  const dot = DOT_CONFIG[state]
  const size = 7

  return (
    <span
      data-testid="agent-card-status-dot"
      className={dot.pulse ? 'motion-safe:animate-pulse' : undefined}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: 999,
        background: dot.bg,
        border: dot.border,
        boxShadow:
          dot.ring !== 'transparent'
            ? `0 0 0 3px ${dot.ring}, 0 0 10px ${dot.bg}`
            : 'none',
        flexShrink: 0,
      }}
    />
  )
}

interface MetricCell {
  icon: string
  value: string
}

const Metric = ({
  cell,
  last,
}: {
  cell: MetricCell
  last: boolean
}): ReactElement => (
  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
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

export const AgentStatusCard = ({
  title,
  state,
  subtitle = null,
  elapsed = null,
  turns = null,
  contextPct = null,
  onToggleSidebar,
}: AgentStatusCardProps): ReactElement => {
  const config = STATE_CONFIG[state]

  // Guard each metric so an idle/scratch session collapses the row gracefully
  // instead of printing "—" / "0" / "0%".
  const metrics: MetricCell[] = []
  if (elapsed) {
    metrics.push({ icon: 'schedule', value: elapsed })
  }
  if (turns && turns > 0) {
    metrics.push({ icon: 'forum', value: String(turns) })
  }
  if (contextPct !== null) {
    metrics.push({ icon: 'data_usage', value: `${contextPct}%` })
  }

  return (
    <div
      data-testid="sidebar-agent-status-card"
      style={{
        position: 'relative',
        borderRadius: 13,
        padding: '13px 14px 14px',
        background: `radial-gradient(120% 90% at 0% 0%, ${config.wash} 0%, rgba(34,34,52,0) 55%), rgba(33,33,51,0.55)`,
        boxShadow:
          '0 5px 20px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.045)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <SidebarToggle
          onClick={onToggleSidebar}
          size={28}
          variant="inset"
          data-testid="sidebar-toggle-incard"
        />
        <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
          <div
            style={{
              fontFamily: "'Instrument Sans', system-ui, sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: '#e9e6fb',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 5,
            }}
          >
            <StatusDot state={state} />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                fontWeight: 600,
                color: config.labelColor,
              }}
            >
              {config.label}
            </span>
          </div>
        </div>
      </div>

      {subtitle ? (
        <div
          style={{
            marginTop: 11,
            fontFamily: "'Inter', sans-serif",
            fontSize: 11.5,
            lineHeight: 1.4,
            color: '#a59fb5',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {subtitle}
        </div>
      ) : null}

      {metrics.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginTop: 12,
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
    </div>
  )
}
