import { type ReactElement, type KeyboardEvent } from 'react'
import type { Session } from '../../workspace/types'
import type { Agent } from '../../../agents/registry'
import { StatusDot } from '../../workspace/components/StatusDot'

export interface TabProps {
  session: Session
  isActive?: boolean
  /**
   * Drives `tabIndex=0` for the WAI-ARIA roving-focus entry point.
   * Equal to `isActive` in the steady state; differs only when
   * `activeSessionId` is null and we fall back to the first visible
   * tab so the keyboard still has a way into the tablist. Computed by
   * Tabs (not derivable from `isActive` alone).
   */
  isFocusEntryPoint?: boolean
  agent: Agent
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

export const Tab = ({
  session,
  isActive = false,
  isFocusEntryPoint = false,
  agent,
  onSelect,
  onClose,
}: TabProps): ReactElement => {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Ignore key events bubbled from focused descendants (the close X).
    if (e.target !== e.currentTarget) {
      return
    }
    // Note: e.key for the space bar is the single-character ' ', NOT 'Space'.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      // Skip the no-op reselection when the focused tab is already
      // active. WorkspaceView's onSelect bridges to setActiveSession
      // (IPC); a redundant call adds round-trip cost AND can interfere
      // with useSessionManager's request-supersession rollback.
      if (!isActive) {
        onSelect(session.id)
      }

      return
    }
    // Delete / Backspace close: tracked in #179 for migration to a
    // global keyboard shortcut (Cmd+W). Preserved verbatim here per
    // the no-regression goal of #178.
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onClose(session.id)
    }
  }

  return (
    <div
      id={`session-tab-${session.id}`}
      role="tab"
      aria-label={
        session.status === 'completed' || session.status === 'errored'
          ? `${session.name} (ended)`
          : session.name
      }
      aria-selected={isActive}
      aria-controls={`session-panel-${session.id}`}
      tabIndex={isFocusEntryPoint ? 0 : -1}
      data-testid="session-tab"
      data-session-id={session.id}
      data-active={isActive}
      onClick={() => {
        if (!isActive) {
          onSelect(session.id)
        }
      }}
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
        // WAI-ARIA tabs §3.27: tablist is one Tab stop; descendants
        // reached via shortcut. Always tabIndex=-1.
        tabIndex={-1}
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
