import { type ReactElement } from 'react'
import { Reorder } from 'framer-motion'
import type { Session } from '../types'
import { StatusDot } from '../../workspace/components/StatusDot'
import { useRenameState } from '../../workspace/hooks/useRenameState'
import { formatRelativeTime } from '../../agent-status/utils/relativeTime'
import {
  STATE_PILL_LABEL,
  STATE_PILL_TONE,
  STATE_PILL_TONE_DIM,
} from '../utils/statePill'
import { lineDelta } from '../utils/lineDelta'
import { subtitle } from '../utils/subtitle'

export interface CardProps {
  session: Session
  variant: 'active' | 'recent'
  isActive?: boolean
  onClick: (id: string) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, name: string) => void
}

const activeCardClass = (isActive: boolean): string => `
  relative mb-1 cursor-grab rounded-[8px] px-3 py-2.5 transition-colors
  active:cursor-grabbing group
  ${
    isActive
      ? 'bg-primary/10 text-on-surface'
      : 'text-on-surface-variant hover:bg-on-surface/[0.04]'
  }
`

const recentCardClass = (isActive: boolean): string => `
  group relative mb-1 rounded-[8px] px-3 py-2 transition-colors
  ${
    isActive
      ? 'bg-primary/10 text-on-surface'
      : 'text-on-surface-variant hover:bg-on-surface/[0.04]'
  }
`

export const Card = ({
  session,
  variant,
  isActive = false,
  onClick,
  onRemove = undefined,
  onRename = undefined,
}: CardProps): ReactElement => {
  const {
    isEditing,
    editValue,
    setEditValue,
    inputRef,
    beginEdit,
    commitRename,
    cancelRename,
  } = useRenameState(session, onRename)
  const { added, removed } = lineDelta(session)
  const subtitleText = subtitle(session)

  // Inner content shared by both variants — only the outer wrapper and
  // class lookups differ. Two render paths keep TypeScript happy around
  // the Reorder.Item-vs-li polymorphism.
  const inner = (
    <>
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-primary-container"
        />
      )}

      {/* Click-to-activate button covers the whole row as an absolute
          background layer. Foreground content sits above with
          pointer-events-none so clicks fall through to this button —
          except interactive bits (rename input, hover buttons, the
          title span) which opt back in via pointer-events-auto. */}
      <button
        type="button"
        onClick={() => onClick(session.id)}
        aria-label={session.name}
        id={`sidebar-activate-${session.id}`}
        data-role="activate"
        className="absolute inset-0 rounded-[8px]"
        tabIndex={isEditing ? -1 : 0}
      />

      <div className="pointer-events-none relative flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {variant === 'active' ? (
            <StatusDot status={session.status} />
          ) : (
            <StatusDot status={session.status} size={6} dim />
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitRename()
                }
                if (e.key === 'Escape') {
                  cancelRename()
                }
              }}
              className={
                variant === 'active'
                  ? 'pointer-events-auto min-w-0 flex-1 truncate rounded bg-surface-container-high px-1 font-label text-[13px] font-semibold text-on-surface outline-none ring-1 ring-primary'
                  : 'pointer-events-auto min-w-0 flex-1 truncate rounded bg-surface-container-high px-1 font-label text-[12.5px] text-on-surface outline-none ring-1 ring-primary'
              }
              aria-label="Rename session"
            />
          ) : (
            <span
              // aria-hidden so AT doesn't announce the name twice — the
              // sibling overlay button already carries aria-label=name.
              aria-hidden="true"
              className={
                variant === 'active'
                  ? 'pointer-events-auto min-w-0 flex-1 cursor-pointer truncate font-label text-[13px] font-semibold text-on-surface'
                  : `pointer-events-auto min-w-0 flex-1 cursor-pointer truncate font-label text-[12.5px] ${isActive ? 'text-on-surface' : 'text-on-surface-variant/60'}`
              }
              // Title-click activation — REQUIRED. Without an explicit
              // onClick, single clicks on the title would NOT bubble to
              // the sibling overlay button (the button is not an
              // ancestor); pointer-events-auto would intercept and
              // primary row activation would silently break.
              onClick={() => onClick(session.id)}
              onDoubleClick={(e) => {
                if (!onRename) {
                  return
                }
                e.stopPropagation()
                beginEdit()
              }}
            >
              {session.name}
            </span>
          )}
          {/* Hide on hover so the absolute-positioned edit/close
              actions in the top-right corner don't overlap. */}
          <span
            className={
              variant === 'active'
                ? 'shrink-0 font-mono text-[10px] text-on-surface-variant/70 transition-opacity group-hover:opacity-0'
                : 'shrink-0 font-mono text-[10px] text-on-surface-variant/50 transition-opacity group-hover:opacity-0'
            }
          >
            {formatRelativeTime(session.lastActivityAt)}
          </span>
        </div>

        {variant === 'active' && (
          <div className="block truncate pl-[15px] font-label text-[11.5px] text-on-surface-variant">
            {subtitleText}
          </div>
        )}

        <div className="flex items-center gap-2 pl-[15px] font-mono text-[10px]">
          <span
            data-testid="state-pill"
            className={`rounded-full px-1.5 py-px uppercase tracking-wide ${
              variant === 'active'
                ? STATE_PILL_TONE[session.status]
                : STATE_PILL_TONE_DIM[session.status]
            }`}
          >
            {STATE_PILL_LABEL[session.status]}
          </span>
          {(added > 0 || removed > 0) && (
            <span
              data-testid="line-delta"
              className={
                variant === 'active'
                  ? 'text-on-surface-variant/70'
                  : 'text-on-surface-variant/50'
              }
            >
              <span
                className={
                  variant === 'active' ? 'text-success' : 'text-success/70'
                }
              >
                +{added}
              </span>{' '}
              <span
                className={
                  variant === 'active' ? 'text-error' : 'text-error/70'
                }
              >
                -{removed}
              </span>
            </span>
          )}
          {variant === 'recent' && (
            <span className="ml-auto truncate font-label text-[10.5px] text-on-surface-variant/50 transition-opacity group-hover:opacity-0">
              {subtitleText}
            </span>
          )}
        </div>
      </div>

      <div className="pointer-events-auto absolute right-2 top-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {onRename && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              beginEdit()
            }}
            className="rounded p-0.5 text-on-surface-variant/60 transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Rename session"
            title="Rename"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(session.id)
            }}
            className={`rounded p-0.5 transition-colors hover:bg-error/20 hover:text-error ${
              variant === 'active'
                ? 'text-on-surface-variant/60'
                : 'text-on-surface-variant/40'
            }`}
            aria-label="Remove session"
            title="Remove"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
    </>
  )

  if (variant === 'active') {
    return (
      <Reorder.Item
        value={session}
        id={session.id}
        data-testid="session-row"
        data-session-id={session.id}
        data-active={isActive}
        className={activeCardClass(isActive)}
        whileDrag={{
          scale: 1.02,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 50,
        }}
        layout="position"
      >
        {inner}
      </Reorder.Item>
    )
  }

  return (
    <li
      data-testid="recent-session-row"
      data-session-id={session.id}
      data-active={isActive}
      className={recentCardClass(isActive)}
    >
      {inner}
    </li>
  )
}
