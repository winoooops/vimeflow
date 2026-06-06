// cspell:ignore incard
import type { ReactElement } from 'react'
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
}

// Fixed below-header body height — the whole point of the SHELL kit. Agent
// content and the shell placeholder both render inside this exact height so the
// card never changes height and nothing below it reflows.
const CARD_BODY_H = 92

const STATE_WASH: Record<AgentCardState, string> = {
  running: 'var(--wash-running)',
  awaiting: 'var(--wash-awaiting)',
  completed: 'var(--wash-completed)',
  errored: 'var(--wash-errored)',
  idle: 'var(--wash-idle)',
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
      className="material-symbols-outlined text-syn-comment"
      aria-hidden="true"
      style={{ fontSize: 12, lineHeight: 1 }}
    >
      {cell.icon}
    </span>
    <span className="ml-1 text-on-surface-variant">{cell.value}</span>
    {!last && <span className="mx-[9px] text-[#3a3450]">·</span>}
  </span>
)

// Pure-shell placeholder. Fills the exact CARD_BODY_H so the card height
// matches an agent pane's.
const ShellBody = (): ReactElement => (
  <div
    data-testid="agent-status-card-shell-body"
    className="mt-[11px] flex items-center gap-[11px] rounded-[9px] border border-dashed border-outline-variant/50 bg-surface-container-lowest/28 py-0 px-[13px]"
    style={{ height: CARD_BODY_H }}
  >
    <div
      className="grid shrink-0 place-items-center rounded-lg bg-syn-comment/14"
      style={{ width: 34, height: 34 }}
    >
      <span
        className="material-symbols-outlined text-[18px] text-[#9b93ab]"
        aria-hidden="true"
      >
        terminal
      </span>
    </div>
    <div className="min-w-0">
      <div className="truncate font-display text-[13px] font-semibold text-on-surface-variant">
        No active agent
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border-[1.5px] border-solid border-outline-variant" />
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-on-surface-muted">
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
      <div className="min-w-0 truncate font-display text-sm font-semibold text-on-surface">
        {isShell ? 'SHELL' : title}
      </div>

      {isShell ? (
        <ShellBody />
      ) : (
        <div style={{ height: CARD_BODY_H, marginTop: 11 }}>
          {metrics.length > 0 && (
            <div className="flex flex-wrap items-center font-mono text-[10px] text-on-surface-muted">
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
