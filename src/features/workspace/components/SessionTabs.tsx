import { type KeyboardEvent, type ReactElement } from 'react'
import type { Session } from '../types'
import { agentForSession } from '../utils/agentForSession'
import {
  getVisibleSessions,
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
  // Single source of truth for "what's visible in the strip" — see
  // `getVisibleSessions` for the predicate. Both this component and
  // `pickNextVisibleSessionId` consume it so the visible-set can't
  // drift between render and close-navigation.
  const open = getVisibleSessions(sessions, activeSessionId)

  // useSessionManager.removeSession uses `flushSync` internally to apply
  // its own setActiveSessionId mid-call. There is an intermediate React
  // commit where `sessions` has dropped the removed session but
  // `activeSessionId` still holds its id; `getVisibleSessions` cannot
  // include the removed id (no longer in `sessions`), so without this
  // fallback every visible tab evaluates `id === activeSessionId` as
  // false → all tabs get tabIndex=-1 → tablist is keyboard-unreachable
  // for that frame. The `activeSessionId === null` guard does not fire
  // either because the id is non-null-but-stale. Compute once per
  // render and use as a tie-breaker so exactly one tab always carries
  // tabIndex=0 — the WAI-ARIA roving-focus invariant.
  const hasFocusMatch = open.some((s) => s.id === activeSessionId)

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
      // WAI-ARIA Tabs Pattern §4.4.3: after a close, focus must move
      // to the newly-selected tab. Removing the close button drops
      // DOM focus to <body> regardless of input method — the close
      // button briefly holds focus from mousedown too — so this fires
      // for both mouse and keyboard closes. queueMicrotask defers
      // until React has committed the re-render so the new active tab
      // exists in the DOM.
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
            // Roving-tabindex entry point. Three cases that all collapse
            // to the same "first visible tab carries tabIndex=0" rule
            // when no tab matches activeSessionId:
            //   1. Initial mount: activeSessionId === null.
            //   2. Sessions list loaded but no active selected yet.
            //   3. Stale activeSessionId after `flushSync` removeSession
            //      — the id refers to a session that's already been
            //      dropped from `sessions`, so nothing in `open` matches.
            // hasFocusMatch is the single check that covers all three.
            isFocusEntryPoint={
              session.id === activeSessionId || (!hasFocusMatch && idx === 0)
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
      // Skip the no-op reselection when the focused tab is already
      // active. WorkspaceView's onSelect bridges to
      // setActiveSession(IPC); a redundant call adds an unnecessary
      // round-trip AND can interfere with useSessionManager's
      // request-supersession rollback (a later no-op request can
      // supersede an earlier real switch under transient failures).
      if (!isActive) {
        onSelect(session.id)
      }

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
      // independently focusable with their own labels. Exited sessions
      // (completed | errored) keep their tab so the Restart pane stays
      // reachable, but the live-status pip is intentionally hidden — so
      // sighted parity is delivered visually by the Restart pane in the
      // tabpanel, while screen-reader parity is delivered by appending
      // `(ended)` to the tab's accessible name. Without this suffix
      // keyboard-only users would hear the same tab label before and
      // after the session exited and would not know the session needs a
      // restart until they Tab into the panel.
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
        // Mirror the keyboard-activation guard in handleKeyDown:
        // clicking the already-active tab is a no-op user-intent and
        // must NOT trigger a redundant setActiveSession IPC.
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
