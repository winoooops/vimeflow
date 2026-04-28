import { useId, useState } from 'react'
import type { ReactElement } from 'react'
import type { TestGroup, TestRunSnapshot, TestRunStatus } from '../types'

interface TestResultsProps {
  snapshot: TestRunSnapshot | null
  onOpenFile?: (path: string) => void
}

export const TestResults = ({
  snapshot,
  onOpenFile = undefined,
}: TestResultsProps): ReactElement => {
  if (snapshot === null) {
    return <TestResultsPlaceholder />
  }

  return <TestResultsLive snapshot={snapshot} onOpenFile={onOpenFile} />
}

const TestResultsPlaceholder = (): ReactElement => (
  <div
    role="status"
    aria-live="polite"
    className="border-t border-outline-variant/[0.08] px-5 py-3 font-mono text-[10px] uppercase tracking-[0.15em] text-on-surface-variant/60"
    data-testid="test-results"
  >
    Tests &nbsp;&nbsp;no runs yet
  </div>
)

interface LiveProps {
  snapshot: TestRunSnapshot
  onOpenFile?: (path: string) => void
}

const TestResultsLive = ({
  snapshot,
  onOpenFile = undefined,
}: LiveProps): ReactElement => {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()

  const { passed, total } = snapshot.summary
  const dotClass = statusDotClass(snapshot.status)

  return (
    <div
      className="border-t border-outline-variant/[0.08]"
      data-testid="test-results"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={(): void => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-5 py-3 text-left"
      >
        <span className="text-[10px] text-outline">{expanded ? '▾' : '▸'}</span>
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-outline">
          Tests
        </span>
        <span
          className={`inline-block h-2 w-2 rounded-full ${dotClass}`}
          aria-hidden
        />
        <span className="font-mono text-[10px] text-on-surface">
          {passed}/{total}
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant/70">
          · {snapshot.runner}
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant/70">
          · {formatDuration(snapshot.durationMs)}
        </span>
      </button>
      <div id={bodyId} hidden={!expanded} className="px-5 pb-3">
        {expanded && (
          <TestResultsBody snapshot={snapshot} onOpenFile={onOpenFile} />
        )}
      </div>
    </div>
  )
}

interface BodyProps {
  snapshot: TestRunSnapshot
  onOpenFile?: (path: string) => void
}

const TestResultsBody = ({
  snapshot,
  onOpenFile = undefined,
}: BodyProps): ReactElement => {
  if (snapshot.status === 'noTests') {
    return (
      <span className="font-mono text-[10px] text-on-surface-variant">
        no tests collected
      </span>
    )
  }
  if (snapshot.status === 'error') {
    return (
      <span className="font-mono text-[10px] text-on-surface-variant">
        {snapshot.outputExcerpt ?? 'runner errored before producing results'}
      </span>
    )
  }

  const { passed, failed, skipped } = snapshot.summary

  return (
    <div className="flex flex-col gap-2">
      <ProportionalBar passed={passed} failed={failed} skipped={skipped} />
      <SummaryText passed={passed} failed={failed} skipped={skipped} />
      <ul className="flex flex-col gap-1">
        {snapshot.summary.groups.map((g, i) => (
          <li key={`${g.label}-${i}`}>
            <GroupRow group={g} onOpenFile={onOpenFile} />
          </li>
        ))}
      </ul>
    </div>
  )
}

interface BarProps {
  passed: number
  failed: number
  skipped: number
}

const ProportionalBar = ({
  passed,
  failed,
  skipped,
}: BarProps): ReactElement => {
  if (passed + failed + skipped === 0) {
    return <></>
  }

  return (
    <div className="flex h-[3px] w-full overflow-hidden rounded-full">
      {passed > 0 && (
        <div style={{ flexGrow: passed }} className="bg-success" />
      )}
      {failed > 0 && <div style={{ flexGrow: failed }} className="bg-error" />}
      {skipped > 0 && (
        <div
          style={{ flexGrow: skipped }}
          className="bg-on-surface-variant/40"
        />
      )}
    </div>
  )
}

const SummaryText = ({ passed, failed, skipped }: BarProps): ReactElement => {
  const parts = [`${passed} passed`]
  if (failed > 0) {
    parts.push(`${failed} failed`)
  }
  if (skipped > 0) {
    parts.push(`${skipped} skipped`)
  }

  return (
    <span className="font-mono text-[10px] font-bold text-on-surface">
      {parts.join(', ')}
    </span>
  )
}

interface GroupRowProps {
  group: TestGroup
  onOpenFile?: (path: string) => void
}

const GroupRow = ({
  group,
  onOpenFile = undefined,
}: GroupRowProps): ReactElement => {
  const icon = groupIcon(group.status)

  const countText =
    group.skipped > 0
      ? `${group.passed}/${group.total} (${group.skipped} skipped)`
      : `${group.passed}/${group.total}`

  if (
    group.kind === 'file' &&
    group.path !== null &&
    onOpenFile !== undefined
  ) {
    const path = group.path

    return (
      <button
        type="button"
        aria-label={`Open ${group.label}`}
        onClick={(): void => onOpenFile(path)}
        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-container-high"
      >
        <span
          className={`${groupIconColor(group.status)} font-mono text-[11px]`}
          aria-hidden
        >
          {icon}
        </span>
        <span className="flex-1 truncate font-mono text-[11px] text-on-surface">
          {group.label}
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant">
          {countText}
        </span>
      </button>
    )
  }

  return (
    <div className="flex w-full items-center gap-2 px-1 py-0.5">
      <span
        className={`${groupIconColor(group.status)} font-mono text-[11px]`}
        aria-hidden
      >
        {icon}
      </span>
      <span className="flex-1 truncate font-mono text-[11px] text-on-surface">
        {group.label}
      </span>
      <span className="font-mono text-[10px] text-on-surface-variant">
        {countText}
      </span>
    </div>
  )
}

const statusDotClass = (s: TestRunStatus): string => {
  switch (s) {
    case 'pass':
      return 'bg-success'
    case 'fail':
      return 'bg-error'
    case 'noTests':
      return 'bg-on-surface-variant'
    case 'error':
      return 'bg-tertiary'
  }
}

const groupIcon = (s: TestGroup['status']): string => {
  switch (s) {
    case 'pass':
      return '✓'
    case 'fail':
      return '✗'
    case 'skip':
      return '⊘'
  }
}

const groupIconColor = (s: TestGroup['status']): string => {
  switch (s) {
    case 'pass':
      return 'text-success'
    case 'fail':
      return 'text-error'
    case 'skip':
      return 'text-on-surface-variant'
  }
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)

  return `${minutes}m ${seconds}s`
}
