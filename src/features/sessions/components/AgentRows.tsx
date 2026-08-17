import type { ReactElement } from 'react'
import {
  usePtyProgress,
  type ProgressSource,
} from '../../terminal/hooks/usePtyProgress'
import type { Session, SessionStatus } from '../types'
import {
  latestPaneRecord,
  type NotificationRecord,
} from '../hooks/useNotificationCenter'
import {
  deriveSessionAgents,
  type SessionAgentEntry,
} from '../utils/deriveSessionAgents'

// Chip state → glyph + semantic tone + accessible label; exhaustive Record so
// a new SessionStatus must rank itself. Fills stay ≤16% so no row outshouts
// the card-level notification badge (design handoff §3). Themes recolor the
// vocabulary through the semantic tokens themselves.
const CHIP_STATE: Record<
  SessionStatus,
  { glyph: string | null; chipClass: string; label: string }
> = {
  running: {
    glyph: null, // rotating hairline ring instead of a glyph
    chipClass: 'bg-secondary/[0.14] text-secondary',
    label: 'running',
  },
  awaiting: {
    glyph: '!',
    chipClass: 'bg-tertiary/[0.16] text-tertiary',
    label: 'needs you',
  },
  errored: {
    glyph: '✕',
    chipClass: 'bg-error/[0.16] text-error',
    label: 'error',
  },
  completed: {
    glyph: '✓',
    chipClass: 'bg-success-muted/[0.14] text-success-muted',
    label: 'finished',
  },
  idle: {
    glyph: '◦',
    chipClass: 'bg-on-surface-muted/[0.10] text-on-surface-muted',
    label: 'idle',
  },
}

// Inert stand-in so the hook is unconditionally callable when no service is
// threaded (tests, stories); `enabled` stays false then, so it never
// subscribes.
const NOOP_PROGRESS_SOURCE: ProgressSource = {
  getProgress: () => undefined,
  onProgress: (): Promise<() => void> => Promise.resolve(() => undefined),
}

interface AgentRowProps {
  sessionId: string
  entry: SessionAgentEntry
  record?: NotificationRecord
  service?: ProgressSource
  onFocusPane: (sessionId: string, paneId: string) => void
}

const AgentRow = ({
  sessionId,
  entry,
  record = undefined,
  service = undefined,
  onFocusPane,
}: AgentRowProps): ReactElement => {
  const progress = usePtyProgress(
    service ?? NOOP_PROGRESS_SOURCE,
    entry.ptyId,
    service !== undefined &&
      (entry.status === 'running' || entry.status === 'idle')
  )

  // Running signal = watcher lifecycle ∪ live OSC 9;4 progress — the
  // row-level analogue of the pane header's lifecycle fallback. Only idle
  // upgrades; decisive states (awaiting/errored/completed) always win over
  // stray progress.
  const displayStatus: SessionStatus =
    entry.status === 'idle' && progress !== undefined ? 'running' : entry.status
  const state = CHIP_STATE[displayStatus]
  const message = record?.body ?? record?.title ?? entry.label

  return (
    <li>
      <button
        type="button"
        onClick={() => onFocusPane(sessionId, entry.paneId)}
        className="pointer-events-auto grid w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 py-[3px] text-left transition-colors hover:bg-wash-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/45"
      >
        <span
          aria-hidden="true"
          className={`grid h-[22px] w-[22px] place-items-center rounded-[6px] font-mono text-[11px] leading-none ${state.chipClass}`}
        >
          {state.glyph ?? (
            <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-secondary/25 border-t-secondary motion-reduce:animate-none" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-medium leading-none text-on-surface-variant">
            {entry.agent.name}
          </span>
          {/* Chip is aria-hidden — this keeps agent + state + message as the accessible name. */}
          <span className="sr-only"> {state.label}</span>
          <span className="mt-[3px] block truncate text-[10.5px] leading-[1.25] text-on-surface-muted">
            {message}
          </span>
        </span>
      </button>
    </li>
  )
}

export interface AgentRowsProps {
  session: Session
  records?: readonly NotificationRecord[]
  service?: ProgressSource
  onFocusPane: (sessionId: string, paneId: string) => void
}

/**
 * Always-on live agent rows for a session card (spec 2026-08-05, VIM-423):
 * one shared recess panel wrapping a row per coding-agent pane. Renders
 * nothing when the session has none. Must be mounted as a SIBLING of Card's
 * absolute activation button, never inside its pointer-events-none content
 * wrapper.
 */
export const AgentRows = ({
  session,
  records = [],
  service = undefined,
  onFocusPane,
}: AgentRowsProps): ReactElement | null => {
  const entries = deriveSessionAgents(session)

  if (entries.length === 0) {
    return null
  }

  return (
    <ul
      aria-label={`Agents in ${session.name}`}
      // Panel passes clicks through (padding/gaps reach the card's activation
      // button); each row button opts back in.
      className="pointer-events-none relative mt-1.5 flex flex-col gap-px rounded-lg bg-wash-recess p-1"
    >
      {entries.map((entry) => (
        <AgentRow
          key={entry.paneId}
          sessionId={session.id}
          entry={entry}
          record={latestPaneRecord(records, entry.ptyId)}
          service={service}
          onFocusPane={onFocusPane}
        />
      ))}
    </ul>
  )
}
