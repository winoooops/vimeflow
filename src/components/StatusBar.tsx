import {
  Fragment,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { formatShortcut, type ShortcutKey } from '../lib/formatShortcut'

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
  contextPct: number
  paletteShortcut: readonly ShortcutKey[]
  onOpenPalette: () => void
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
  color: 'color-mix(in srgb, var(--outline-variant) 70%, transparent)',
} satisfies CSSProperties

const barStyle = {
  borderTopColor: 'color-mix(in srgb, var(--outline-variant) 20%, transparent)',
} satisfies CSSProperties

const normalizePct = (pct: number): number =>
  Math.min(100, Math.max(0, Math.round(pct)))

const contextPresentation = (pct: number): ContextPresentation => {
  if (pct < 50) {
    return { face: '😊', toneClass: 'text-[var(--success)]' }
  }

  if (pct < 75) {
    return { face: '😐', toneClass: 'text-[var(--on-surface-variant)]' }
  }

  if (pct < 90) {
    return { face: '😟', toneClass: 'text-[var(--tertiary)]' }
  }

  return { face: '🥵', toneClass: 'text-[var(--error)]' }
}

const cacheToneClass = (rate: number): string => {
  if (rate >= 70) {
    return 'text-[var(--success)]'
  }

  if (rate >= 40) {
    return 'text-[var(--primary)]'
  }

  return 'text-[var(--tertiary)]'
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

const Kbd = ({ children }: { children: ReactNode }): ReactElement => (
  <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-[color:color-mix(in_srgb,var(--outline-variant)_60%,transparent)] bg-[color-mix(in_srgb,var(--surface-container-high)_60%,transparent)] px-[5px] font-mono text-[10px] font-semibold leading-none text-[var(--on-surface-variant)]">
    {children}
  </kbd>
)

const ContextSmiley = ({ pct }: { pct: number }): ReactElement => {
  const normalizedPct = normalizePct(pct)
  const presentation = contextPresentation(normalizedPct)

  return (
    <span
      data-testid="status-bar-context"
      aria-label={`Context ${normalizedPct}%`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
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

const PaletteHint = ({
  shortcut,
  onOpenPalette,
}: {
  shortcut: readonly ShortcutKey[]
  onOpenPalette: () => void
}): ReactElement => (
  <button
    type="button"
    aria-label="Open command palette"
    data-testid="status-bar-palette"
    onClick={onOpenPalette}
    className="inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] px-1 py-0.5 transition-colors hover:bg-[var(--surface-container-low)] focus-visible:outline-none focus-visible:shadow-[var(--ring-primary)]"
  >
    {shortcut.map((key, index) => (
      <Kbd key={`${key}-${index}`}>{formatShortcut(key)}</Kbd>
    ))}
  </button>
)

const buildSegments = ({
  session,
  contextPct,
  paletteShortcut,
  onOpenPalette,
}: StatusBarProps): Segment[] => {
  const paletteSegment = {
    id: 'palette',
    node: (
      <PaletteHint shortcut={paletteShortcut} onOpenPalette={onOpenPalette} />
    ),
  }

  if (session === null) {
    return [paletteSegment]
  }

  const segments: Segment[] = []

  if (hasStartedAgo(session.startedAgo)) {
    segments.push({
      id: 'duration',
      node: (
        <span
          data-testid="status-bar-duration"
          className="inline-flex items-center gap-1 whitespace-nowrap text-[var(--on-surface-variant)]"
        >
          <MaterialIcon name="schedule" />
          <span>{session.startedAgo}</span>
        </span>
      ),
    })
  }

  segments.push({
    id: 'context',
    node: <ContextSmiley pct={contextPct} />,
  })

  const rate = cacheRate(session.cache)

  if (rate !== null) {
    const toneClass = cacheToneClass(rate)

    segments.push({
      id: 'cache',
      node: (
        <span
          data-testid="status-bar-cache"
          className="inline-flex items-center gap-1 whitespace-nowrap"
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
          <span className="text-[var(--on-surface-muted)]">cached</span>
        </span>
      ),
    })
  }

  segments.push({
    id: 'turns',
    node: (
      <span
        data-testid="status-bar-turns"
        className="whitespace-nowrap text-[var(--on-surface-muted)]"
      >
        <span className="tabular-nums">{Math.max(0, session.turns)}</span> turns
      </span>
    ),
  })

  if (hasChanges(session.changes)) {
    segments.push({
      id: 'diff',
      node: (
        <span
          data-testid="status-bar-diff"
          className="inline-flex whitespace-nowrap font-semibold tabular-nums"
        >
          <span className="text-[var(--success)]">
            +{formatCompactCount(session.changes.added)}
          </span>
          <span className="text-[var(--tertiary)]">
            −{formatCompactCount(session.changes.removed)}
          </span>
        </span>
      ),
    })
  }

  segments.push(paletteSegment)

  return segments
}

export const StatusBar = ({
  session,
  contextPct,
  paletteShortcut,
  onOpenPalette,
}: StatusBarProps): ReactElement => {
  const segments = buildSegments({
    session,
    contextPct,
    paletteShortcut,
    onOpenPalette,
  })

  return (
    <footer
      data-testid="status-bar"
      aria-label="App status"
      style={barStyle}
      className="flex h-[var(--status-bar-h)] shrink-0 flex-wrap items-center gap-x-[14px] border-t border-solid bg-[var(--surface-container-lowest)] px-3 font-mono text-[10px] text-[var(--on-surface-muted)] tabular-nums max-[760px]:h-[44px] max-[760px]:content-between max-[760px]:items-start max-[760px]:py-1"
    >
      <span className="whitespace-nowrap text-[var(--primary-container)]">
        obsidian-cli
      </span>
      <Separator />
      <span className="whitespace-nowrap text-[var(--on-surface-muted)]">
        v{__APP_VERSION__}
      </span>
      <span className="min-w-0 flex-1 max-[760px]:hidden" />
      <span
        data-testid="status-bar-right"
        className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-[14px] gap-y-0 max-[760px]:basis-full max-[760px]:justify-end"
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
