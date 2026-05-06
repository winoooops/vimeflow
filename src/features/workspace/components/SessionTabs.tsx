import { type KeyboardEvent, type ReactElement } from 'react'
import type { Session } from '../types'
import { agentForSession } from '../utils/agentForSession'
import {
  isOpenSessionStatus,
  pickNextVisibleSessionId,
} from '../utils/pickNextVisibleSessionId'
import { StatusDot } from './StatusDot'

export interface SessionTabsProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onNew: () => void
}

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
    (s) => isOpenSessionStatus(s.status) || s.id === activeSessionId
  )

  // STUB: tab cycling between sessions belongs on a global keybinding
  // (Cmd+Shift+] / [) routed through the command palette — see #177.
  // xterm.js holds focus inside the terminal, so in-component
  // arrow-key handlers on the tab divs never fire; the user can't
  // Tab into the strip without leaving the terminal first. The
  // previous in-component handler was removed for that reason.

  const handleClose = (sessionId: string): void => {
    // useSessionManager.removeSession picks its fallback by full-sessions
    // index, which can land on a hidden completed/errored session sitting
    // between two visible ones in the underlying array. We override with
    // the visible next-tab id. Order matters: onClose runs first so
    // removeSession can do its work (kill IPC, drop from list, pick its
    // own fallback); the trailing onSelect then overrides the selection
    // to a tab the user can actually see. This way an onClose failure
    // cannot strand the selection on a removed id.
    const nextId =
      sessionId === activeSessionId
        ? pickNextVisibleSessionId(sessions, sessionId, activeSessionId)
        : undefined
    onClose(sessionId)
    if (nextId !== undefined) {
      onSelect(nextId)
      // WAI-ARIA Tabs Pattern §4.4.3: after a keyboard close, focus must
      // move to the newly-selected tab. Removing the close button drops
      // DOM focus to <body>; queueMicrotask defers until React has
      // committed the re-render so the new active tab exists in the DOM.
      // No-op for mouse closes (the focused element was already the
      // close button, not body).
      queueMicrotask(() => {
        document.getElementById(`session-tab-${nextId}`)?.focus()
      })
    }
  }

  return (
    <div
      data-testid="session-tabs"
      className="flex h-[38px] shrink-0 items-end gap-0.5 border-b border-outline-variant/25 bg-surface-container-lowest px-2"
    >
      {/* WAI-ARIA 1.2 §3.27 requires `tablist` to own only `tab` children.
          Keeping the `+` button and the spacer outside the tablist boundary. */}
      <div
        role="tablist"
        aria-label="Open sessions"
        className="flex items-end gap-0.5"
      >
        {open.map((session, idx) => (
          <SessionTab
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            // Roving-tabindex entry point: when activeSessionId is null
            // (transient on initial mount), fall back to the first
            // visible tab so keyboard users still have a focus stop.
            isFocusEntryPoint={
              session.id === activeSessionId ||
              (activeSessionId === null && idx === 0)
            }
            onSelect={onSelect}
            onClose={handleClose}
          />
        ))}
      </div>
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
  /**
   * Drives `tabIndex=0` for the roving-focus entry point. Equal to
   * `isActive` in the steady state; differs only when `activeSessionId`
   * is null and we fall back to the first visible tab so the keyboard
   * still has a way into the tablist.
   */
  isFocusEntryPoint: boolean
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
}

const SessionTab = ({
  session,
  isActive,
  isFocusEntryPoint,
  onSelect,
  onClose,
}: SessionTabProps): ReactElement => {
  const agent = agentForSession(session)

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Ignore key events that bubbled from a focused descendant (close X).
    if (e.target !== e.currentTarget) {
      return
    }
    // Enter / Space activate the focused tab. Delete / Backspace close
    // it — same convention as browser tab bars (Cmd+W) and matches the
    // WAI-ARIA tabs pattern where the close button is reachable via
    // keyboard shortcut on the focused tab, not as a separate Tab stop.
    // Arrow-key cycling intentionally not handled here — see the
    // global-keybinding stub note in SessionTabs above.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(session.id)

      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onClose(session.id)
    }
  }

  return (
    <div
      id={`session-tab-${session.id}`}
      role="tab"
      // Without an explicit name, the ARIA accessible-name algorithm
      // accumulates labels from descendants — the StatusDot's `Status
      // running` and the close button's `Close <name>` would both fold
      // into the tab's announced name. Setting aria-label here pins the
      // computed name to just the session name; descendants stay
      // independently focusable with their own labels.
      aria-label={session.name}
      aria-selected={isActive}
      aria-controls={`session-panel-${session.id}`}
      tabIndex={isFocusEntryPoint ? 0 : -1}
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
        // WAI-ARIA tabs §3.27: the entire tablist is one Tab stop;
        // interactive descendants are reached via shortcut, not Tab.
        // Always tabIndex=-1 so Tab passes through to the tabpanel
        // below. Keyboard close lives on the parent tab div via
        // Delete/Backspace handling in handleKeyDown above.
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
