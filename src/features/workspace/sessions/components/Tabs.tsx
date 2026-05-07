import { type ReactElement } from 'react'
import type { Session } from '../../types'
import { agentForSession } from '../../utils/agentForSession'
import {
  getVisibleSessions,
  pickNextVisibleSessionId,
} from '../../utils/pickNextVisibleSessionId'
import { Tab } from './Tab'

export interface TabsProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onNew: () => void
}

export const Tabs = ({
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  onNew,
}: TabsProps): ReactElement => {
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
          <Tab
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            isFocusEntryPoint={
              session.id === activeSessionId || (!hasFocusMatch && idx === 0)
            }
            agent={agentForSession(session)}
            onSelect={(id) => {
              if (id !== activeSessionId) {
                onSelect(id)
              }
            }}
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
