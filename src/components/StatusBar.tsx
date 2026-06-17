import {
  Fragment,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Tooltip } from './Tooltip'
import type { ShortcutInput, ShortcutKey } from '../lib/formatShortcut'

// Display-side fallbacks for the bottom-bar actions. WorkspaceView passes the
// live palette binding so the tooltip chip follows persisted overrides.
const PALETTE_SHORTCUT = ['Mod', ';'] as const satisfies readonly ShortcutKey[]
const DOCK_SHORTCUT = ['Mod', '0'] as const satisfies readonly ShortcutKey[]

interface StatusBarCache {
  cached: number
  wrote: number
  fresh: number
}

interface StatusBarChanges {
  added: number
  removed: number
}

export interface StatusBarSession {
  startedAgo?: string
  turns: number
  cache?: StatusBarCache
  changes?: StatusBarChanges
}

export interface StatusBarProps {
  session: StatusBarSession | null
  // null = the agent is active but has not reported a context window yet;
  // the segment is suppressed rather than shown as a misleading 0%.
  contextPct: number | null
  onOpenPalette: () => void
  /** Current command-palette shortcut — defaults to the app binding. */
  paletteShortcut?: ShortcutInput
  /** Whether the editor/diff dock is open — drives the toggle's icon tone. */
  dockOpen: boolean
  onToggleDock: () => void
  /** Total running burner shells across all sessions (VIM-53/71 cue). */
  burnerCount?: number
}

interface Segment {
  id: string
  node: ReactNode
}

interface ContextPresentation {
  face: string
  toneClass: string
}

const separatorStyle = {
  color: 'color-mix(in srgb, var(--color-outline-variant) 70%, transparent)',
} satisfies CSSProperties

const barStyle = {
  borderTopColor:
    'color-mix(in srgb, var(--color-outline-variant) 20%, transparent)',
} satisfies CSSProperties

// Main-stage handoff J7: compact transparent icon buttons — hover fill
// only, never a persistent background.
const ACTION_BUTTON_BASE =
  'inline-flex h-[18px] w-[22px] cursor-pointer items-center justify-center rounded-[5px] transition-colors duration-[140ms] focus-visible:outline-none focus-visible:shadow-[var(--shadow-ring-primary)]'

const ACTION_BUTTON_IDLE =
  'text-on-surface-muted hover:bg-primary/10 hover:text-primary'

const normalizePct = (pct: number): number =>
  Math.min(100, Math.max(0, Math.round(pct)))

const contextPresentation = (pct: number): ContextPresentation => {
  if (pct < 50) {
    return { face: '😊', toneClass: 'text-success' }
  }

  if (pct < 75) {
    return { face: '😐', toneClass: 'text-on-surface-variant' }
  }

  if (pct < 90) {
    return { face: '😟', toneClass: 'text-tertiary' }
  }

  return { face: '🥵', toneClass: 'text-error' }
}

const cacheToneClass = (rate: number): string => {
  if (rate >= 70) {
    return 'text-success'
  }

  if (rate >= 40) {
    return 'text-primary'
  }

  return 'text-tertiary'
}

const cacheRate = (cache: StatusBarCache | undefined): number | null => {
  if (!cache) {
    return null
  }

  const total = cache.cached + cache.wrote + cache.fresh

  if (total <= 0) {
    return null
  }

  return Math.round((cache.cached / total) * 100)
}

const hasStartedAgo = (startedAgo: string | undefined): startedAgo is string =>
  startedAgo !== undefined &&
  startedAgo.trim().length > 0 &&
  startedAgo.trim() !== '—'

const hasChanges = (
  changes: StatusBarChanges | undefined
): changes is StatusBarChanges =>
  changes !== undefined && (changes.added > 0 || changes.removed > 0)

const formatCompactCount = (count: number): string => {
  if (count <= 999) {
    return String(count)
  }

  return `${parseFloat((count / 1000).toFixed(1))}k`
}

const Separator = (): ReactElement => (
  <span
    aria-hidden="true"
    data-testid="status-bar-separator"
    style={separatorStyle}
  >
    ·
  </span>
)

const MaterialIcon = ({ name }: { name: string }): ReactElement => (
  <span
    aria-hidden="true"
    className="material-symbols-outlined text-[11px] leading-none"
  >
    {name}
  </span>
)

const ContextSmiley = ({ pct }: { pct: number }): ReactElement => {
  const normalizedPct = normalizePct(pct)
  const presentation = contextPresentation(normalizedPct)

  return (
    <span
      data-testid="status-bar-context"
      aria-label={`Context ${normalizedPct}%`}
      className="inline-flex items-center gap-[4px] whitespace-nowrap"
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {presentation.face}
      </span>
      <span className={`font-bold tabular-nums ${presentation.toneClass}`}>
        {normalizedPct}%
      </span>
    </span>
  )
}

const buildSegments = ({
  session,
  contextPct,
  burnerCount = 0,
}: Pick<
  StatusBarProps,
  'session' | 'contextPct' | 'burnerCount'
>): Segment[] => {
  // Global across sessions, so it surfaces even when no session is active.
  const burnerSegment: Segment | null =
    burnerCount > 0
      ? {
          id: 'burner',
          node: (
            <span
              data-testid="status-bar-burner"
              className="inline-flex items-center gap-1 whitespace-nowrap"
              style={{ color: 'var(--color-agent-shell-accent)' }}
            >
              <span
                aria-hidden="true"
                className="h-[5px] w-[5px] rounded-full bg-current"
              />
              burner ×{burnerCount}
            </span>
          ),
        }
      : null

  if (session === null) {
    return burnerSegment ? [burnerSegment] : []
  }

  const segments: Segment[] = []

  if (hasStartedAgo(session.startedAgo)) {
    segments.push({
      id: 'duration',
      node: (
        <span
          data-testid="status-bar-duration"
          className="inline-flex items-center gap-[4px] whitespace-nowrap text-on-surface-variant max-[760px]:hidden"
        >
          <MaterialIcon name="schedule" />
          <span>{session.startedAgo}</span>
        </span>
      ),
    })
  }

  if (contextPct !== null) {
    segments.push({
      id: 'context',
      node: <ContextSmiley pct={contextPct} />,
    })
  }

  const rate = cacheRate(session.cache)

  if (rate !== null) {
    const toneClass = cacheToneClass(rate)

    segments.push({
      id: 'cache',
      node: (
        <span
          data-testid="status-bar-cache"
          className="inline-flex items-center gap-[4px] whitespace-nowrap"
        >
          <span className={toneClass}>
            <MaterialIcon name="bolt" />
          </span>
          <span
            data-testid="status-bar-cache-rate"
            className={`font-semibold tabular-nums ${toneClass}`}
          >
            {rate}%
          </span>
          <span
            data-testid="status-bar-cache-label"
            className="text-on-surface-muted max-[760px]:hidden"
          >
            cached
          </span>
        </span>
      ),
    })
  }

  if (session.turns > 0) {
    segments.push({
      id: 'turns',
      node: (
        <span
          data-testid="status-bar-turns"
          className="whitespace-nowrap text-on-surface-muted max-[760px]:hidden"
        >
          <span className="tabular-nums">{session.turns}</span> turns
        </span>
      ),
    })
  }

  if (hasChanges(session.changes)) {
    segments.push({
      id: 'diff',
      node: (
        <span
          data-testid="status-bar-diff"
          className="inline-flex whitespace-nowrap font-semibold tabular-nums"
        >
          {session.changes.added > 0 && (
            <span className="text-success">
              +{formatCompactCount(session.changes.added)}
            </span>
          )}
          {session.changes.removed > 0 && (
            <span className="text-tertiary">
              −{formatCompactCount(session.changes.removed)}
            </span>
          )}
        </span>
      ),
    })
  }

  if (burnerSegment) {
    segments.push(burnerSegment)
  }

  return segments
}

export const StatusBar = ({
  session,
  contextPct,
  onOpenPalette,
  paletteShortcut = PALETTE_SHORTCUT,
  dockOpen,
  onToggleDock,
  burnerCount = 0,
}: StatusBarProps): ReactElement => {
  const segments = buildSegments({ session, contextPct, burnerCount })

  return (
    <footer
      data-testid="status-bar"
      aria-label="App status"
      style={barStyle}
      className="flex h-[var(--status-bar-h)] shrink-0 items-center gap-x-[14px] border-t border-solid bg-surface px-[12px] font-mono text-[10px] text-on-surface-muted tabular-nums"
    >
      <span
        data-testid="status-bar-actions"
        className="inline-flex items-center gap-[6px]"
      >
        <Tooltip content="Command palette" shortcut={paletteShortcut}>
          <button
            type="button"
            aria-label="Open command palette"
            data-testid="status-bar-palette"
            onClick={onOpenPalette}
            className={`${ACTION_BUTTON_BASE} ${ACTION_BUTTON_IDLE}`}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 4.5L6 8L3 11.5M7.5 11.5H13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.55"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </Tooltip>
        <Tooltip
          content={dockOpen ? 'Hide editor & diff' : 'Show editor & diff'}
          shortcut={DOCK_SHORTCUT}
        >
          <button
            type="button"
            aria-label={
              dockOpen ? 'Hide editor & diff panel' : 'Show editor & diff panel'
            }
            aria-pressed={dockOpen}
            data-testid="status-bar-dock-toggle"
            onClick={onToggleDock}
            className={`${ACTION_BUTTON_BASE} ${
              dockOpen
                ? 'text-success hover:bg-success/[0.08]'
                : ACTION_BUTTON_IDLE
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
              <rect
                x="2.2"
                y="2.8"
                width="11.6"
                height="10.4"
                rx="2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path d="M2.6 9.5H13.4" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </Tooltip>
      </span>

      <span className="min-w-[10px] flex-1" />

      <span
        data-testid="status-bar-right"
        className="flex min-w-0 items-center justify-end gap-x-[8px] whitespace-nowrap max-[760px]:gap-x-[5px]"
      >
        {segments.map((segment, index) => (
          <Fragment key={segment.id}>
            {index > 0 && <Separator />}
            {segment.node}
          </Fragment>
        ))}
      </span>
    </footer>
  )
}
