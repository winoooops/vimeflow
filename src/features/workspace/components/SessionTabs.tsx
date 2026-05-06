import { useRef, type KeyboardEvent, type ReactElement } from 'react'
import type { Session } from '../types'
import { agentForSession } from '../utils/agentForSession'
import { StatusDot } from './StatusDot'

export interface SessionTabsProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onNew: () => void
}

const isOpenStatus = (s: Session): boolean =>
  s.status === 'running' || s.status === 'paused'

export const SessionTabs = ({
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  onNew,
}: SessionTabsProps): ReactElement => {
  // Keep the active session in the strip even after its PTY exits (status
  // flips to completed/errored): TerminalZone shows the Restart pane and
  // useSessionManager keeps activeSessionId pointing at it. Dropping the
  // tab would leave the visible pane with no selected tab.
  const open = sessions.filter(
    (s) => isOpenStatus(s) || s.id === activeSessionId
  )

  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const registerTab = (id: string, el: HTMLDivElement | null): void => {
    if (el === null) {
      tabRefs.current.delete(id)
    } else {
      tabRefs.current.set(id, el)
    }
  }

  const focusTabAtOffset = (currentId: string, offset: number): void => {
    const ids = open.map((s) => s.id)
    const idx = ids.indexOf(currentId)
    if (idx === -1 || ids.length === 0) {
      return
    }
    const nextIdx = (idx + offset + ids.length) % ids.length
    const nextId = ids[nextIdx]
    onSelect(nextId)
    // Roving-focus pattern: move DOM focus to the newly-selected tab so
    // arrow-key navigation reads naturally to assistive tech.
    queueMicrotask(() => tabRefs.current.get(nextId)?.focus())
  }

  return (
    <div
      data-testid="session-tabs"
      role="tablist"
      aria-label="Open sessions"
      className="flex h-[38px] shrink-0 items-end gap-0.5 border-b border-outline-variant/25 bg-surface-container-lowest px-2"
    >
      {open.map((session) => (
        <SessionTab
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onSelect={onSelect}
          onClose={onClose}
          onArrow={focusTabAtOffset}
          registerRef={registerTab}
        />
      ))}
      <button
        type="button"
        onClick={onNew}
        aria-label="New session"
        title="New session"
        className="mb-px ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-primary/10 hover:text-primary"
      >
        <span className="material-symbols-outlined text-[15px]">add</span>
      </button>
      <span className="flex-1" />
    </div>
  )
}

interface SessionTabProps {
  session: Session
  isActive: boolean
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onArrow: (currentId: string, offset: number) => void
  registerRef: (id: string, el: HTMLDivElement | null) => void
}

const SessionTab = ({
  session,
  isActive,
  onSelect,
  onClose,
  onArrow,
  registerRef,
}: SessionTabProps): ReactElement => {
  const agent = agentForSession(session)

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Don't react to keys that bubbled from a focused descendant (close X).
    if (e.target !== e.currentTarget) {
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(session.id)

      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      onArrow(session.id, 1)

      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onArrow(session.id, -1)
    }
  }

  return (
    <div
      ref={(el) => registerRef(session.id, el)}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      data-testid="session-tab"
      data-session-id={session.id}
      data-active={isActive}
      onClick={() => onSelect(session.id)}
      onKeyDown={handleKeyDown}
      className={`
        relative flex h-[30px] min-w-[130px] max-w-[220px] cursor-pointer items-center gap-2
        rounded-t-lg border border-transparent pl-3 pr-2 outline-none transition-colors
        focus-visible:ring-2 focus-visible:ring-primary/50
        ${
          isActive
            ? '-mb-px bg-surface border-outline-variant/30'
            : 'hover:bg-on-surface/[0.025]'
        }
      `}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute inset-x-1.5 top-0 h-0.5 rounded-b-sm"
          style={{ background: agent.accent }}
        />
      )}
      <span
        aria-hidden="true"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold"
        style={{ background: agent.accentDim, color: agent.accent }}
      >
        {agent.glyph}
      </span>
      <span
        className={`
          min-w-0 flex-1 truncate font-mono text-[11px]
          ${isActive ? 'font-medium text-on-surface' : 'text-on-surface-variant'}
        `}
      >
        {session.name}
      </span>
      {(session.status === 'running' || session.status === 'paused') && (
        <StatusDot
          status={session.status}
          size={5}
          aria-label={`Status ${session.status}`}
        />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose(session.id)
        }}
        aria-label={`Close ${session.name}`}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-on-surface-variant/70 transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-[11px]">close</span>
      </button>
    </div>
  )
}
