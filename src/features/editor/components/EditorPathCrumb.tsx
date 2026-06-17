import { Fragment, useEffect, useState, type ReactElement } from 'react'

export type EditorPathCrumbStatus = 'SAVED' | 'UNSAVED' | 'NEW' | 'DELETED'

interface EditorPathCrumbProps {
  filePath: string
  status?: EditorPathCrumbStatus | null
  savedAt?: number | null
  maxSegments?: number
}

const STATUS_CLASS_BY_STATUS: Record<EditorPathCrumbStatus, string> = {
  SAVED: 'text-success-muted',
  UNSAVED: 'text-primary',
  NEW: 'text-success-muted',
  DELETED: 'text-tertiary',
}

const RELATIVE_TIME_UPDATE_MS = 60_000
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const formatSavedRelativeTime = (savedAt: number, now: number): string => {
  const elapsedMs = Math.max(0, now - savedAt)

  if (elapsedMs < MINUTE_MS) {
    return 'just now'
  }

  if (elapsedMs < HOUR_MS) {
    return `${Math.floor(elapsedMs / MINUTE_MS)}m ago`
  }

  if (elapsedMs < DAY_MS) {
    return `${Math.floor(elapsedMs / HOUR_MS)}h ago`
  }

  return `${Math.floor(elapsedMs / DAY_MS)}d ago`
}

const pathParts = (filePath: string): string[] =>
  filePath.replace(/\\/g, '/').split('/').filter(Boolean)

export const EditorPathCrumb = ({
  filePath,
  status = null,
  savedAt = null,
  maxSegments = 3,
}: EditorPathCrumbProps): ReactElement => {
  const [now, setNow] = useState(() => Date.now())
  const parts = pathParts(filePath)
  const leaf = parts[parts.length - 1] ?? filePath
  const directories = parts.slice(0, -1)
  const visibleDirectoryCount = Math.max(0, maxSegments - 1)
  const trimmed = directories.length > visibleDirectoryCount

  const visibleDirectories = trimmed
    ? visibleDirectoryCount === 0
      ? []
      : directories.slice(-visibleDirectoryCount)
    : directories

  useEffect(() => {
    if (status !== 'SAVED' || savedAt === null) {
      return undefined
    }

    setNow(Date.now())

    const intervalId = window.setInterval(() => {
      setNow(Date.now())
    }, RELATIVE_TIME_UPDATE_MS)

    return (): void => {
      window.clearInterval(intervalId)
    }
  }, [savedAt, status])

  const statusLabel =
    status === 'SAVED'
      ? savedAt === null
        ? null
        : `SAVED · ${formatSavedRelativeTime(savedAt, now)}`
      : status

  return (
    <div
      aria-label={
        statusLabel
          ? `File path: ${filePath}. ${statusLabel.toLowerCase()}`
          : `File path: ${filePath}`
      }
      data-testid="editor-path-crumb"
      className="flex cursor-default shrink-0 items-center gap-1 border-b border-outline-variant/20 px-4 py-[7px] font-mono text-[11px] leading-none text-on-surface-muted"
    >
      <span
        className="material-symbols-outlined shrink-0 text-[12px] leading-none text-on-surface-muted"
        aria-hidden="true"
      >
        folder_open
      </span>

      <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
        {trimmed && (
          <span
            className="shrink-0 text-outline-variant"
            data-testid="editor-path-trimmed"
          >
            …/
          </span>
        )}
        {visibleDirectories.map((directory, index) => (
          <Fragment key={`${directory}-${index}`}>
            <span className="shrink-0 text-on-surface-muted">{directory}</span>
            <span className="shrink-0 text-outline-variant">/</span>
          </Fragment>
        ))}
        <span className="truncate text-on-surface">{leaf}</span>
      </span>

      <span className="flex-1" aria-hidden="true" />

      {statusLabel && status ? (
        <span className={`shrink-0 ${STATUS_CLASS_BY_STATUS[status]}`}>
          {statusLabel}
        </span>
      ) : null}
    </div>
  )
}
