import type { Session } from '../../sessions/types'
import type { Command } from '../../command-palette/registry/types'
import { fuzzyMatch } from '../../command-palette/registry/fuzzyMatch'

// Single source of truth for which Session fields a workspace command may
// read. `WorkspaceTab` derives its shape from this list, and the workspace's
// memo signature in `WorkspaceView.tsx` walks the same list to build its
// dep value. Adding a field here automatically widens both — so a future
// command that needs (e.g.) `workingDirectory` cannot silently inherit a
// stale closure: the type permits the read AND the signature triggers a
// memo rebuild on changes to that field.
export const WORKSPACE_TAB_KEYS = ['id', 'name'] as const

export type WorkspaceTabKey = (typeof WORKSPACE_TAB_KEYS)[number]

export type WorkspaceTab = Pick<Session, WorkspaceTabKey>

export interface WorkspaceCommandDeps {
  sessions: WorkspaceTab[]
  activeSessionId: string | null
  createSession: () => void
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  setActiveSessionId: (id: string) => void
  notifyInfo: (message: string) => void
}

// Pure builder: closures capture `deps`, so call from a useMemo over session-manager state.
export const buildWorkspaceCommands = (
  deps: WorkspaceCommandDeps
): Command[] => {
  const {
    sessions,
    activeSessionId,
    createSession,
    removeSession,
    renameSession,
    setActiveSessionId,
    notifyInfo,
  } = deps

  const findActiveIndex = (): number =>
    sessions.findIndex((s) => s.id === activeSessionId)

  return [
    {
      id: 'new',
      label: ':new',
      description: 'Create a new terminal session',
      icon: 'add',
      execute: (): void => {
        createSession()
      },
    },
    {
      id: 'close',
      label: ':close',
      description: 'Close the active terminal session',
      icon: 'close',
      execute: (): void => {
        const idx = findActiveIndex()

        if (idx === -1) {
          notifyInfo('No active tab to close')

          return
        }

        removeSession(sessions[idx].id)
      },
    },
    {
      id: 'rename',
      label: ':rename',
      description: 'Rename the active terminal session',
      icon: 'edit',
      execute: (args: string): void => {
        const idx = findActiveIndex()

        if (idx === -1) {
          notifyInfo('No active tab to rename')

          return
        }

        const trimmed = args.trim()

        if (!trimmed) {
          notifyInfo('Usage: :rename <name>')

          return
        }

        renameSession(sessions[idx].id, trimmed)
      },
    },
    {
      id: 'next',
      label: ':next',
      description: 'Switch to the next terminal session',
      icon: 'arrow_forward',
      execute: (): void => {
        if (sessions.length === 0) {
          notifyInfo('No open sessions')

          return
        }

        const idx = findActiveIndex()
        const nextIdx = idx === -1 ? 0 : (idx + 1) % sessions.length

        setActiveSessionId(sessions[nextIdx].id)
      },
    },
    {
      id: 'previous',
      label: ':previous',
      description: 'Switch to the previous terminal session',
      icon: 'arrow_back',
      execute: (): void => {
        if (sessions.length === 0) {
          notifyInfo('No open sessions')

          return
        }

        const idx = findActiveIndex()

        const prevIdx =
          idx === -1
            ? sessions.length - 1
            : (idx - 1 + sessions.length) % sessions.length

        setActiveSessionId(sessions[prevIdx].id)
      },
    },
    {
      id: 'goto',
      label: ':goto',
      description: 'Go to a terminal session by position or name',
      icon: 'tab',
      execute: (args: string): void => {
        const trimmed = args.trim()

        if (!trimmed) {
          notifyInfo('Usage: :goto <position or name>')

          return
        }

        // Empty-list short-circuit covers BOTH the numeric and the name path.
        // Without it, `:goto 1` against zero sessions would emit the
        // less-helpful "No tab at position 1" while `:goto foo` correctly
        // emits "No open sessions" — same root cause, two different messages.
        if (sessions.length === 0) {
          notifyInfo('No open sessions')

          return
        }

        // Numeric position branch: only POSITIVE-INTEGER strings (e.g. "1",
        // "42") qualify. Negative-sign / decimal-point inputs ("-1", "1.5",
        // "1.0") fall through to fuzzy-name matching below — that's how a
        // user can reach a session whose name happens to look like a
        // number. Digit-prefixed names like "1alpha" already fall through
        // because the `\d+` regex demands an end anchor with no other
        // characters. `:goto 0` still matches the regex and is rejected by
        // the `position < 1` guard, preserving the "Position must be a
        // positive integer" message for the zero case (which has no fuzzy
        // analogue).
        const isPositionLike = /^\d+$/.test(trimmed)

        if (isPositionLike) {
          const position = Number(trimmed)

          if (position < 1) {
            notifyInfo('Position must be a positive integer')

            return
          }

          if (position > sessions.length) {
            notifyInfo(`No tab at position ${position}`)

            return
          }

          setActiveSessionId(sessions[position - 1].id)

          return
        }

        const match = sessions.reduce<{
          session: WorkspaceTab | null
          score: number
        }>(
          (best, session) => {
            const score = fuzzyMatch(trimmed, session.name)

            if (score > best.score) {
              return { session, score }
            }

            return best
          },
          { session: null, score: 0 }
        )

        if (match.session) {
          setActiveSessionId(match.session.id)

          return
        }

        notifyInfo(`No tab matching '${trimmed}'`)
      },
    },
    {
      id: 'split-horizontal',
      label: ':split-horizontal',
      description: 'Split pane horizontally (not yet implemented)',
      icon: 'horizontal_split',
      execute: (): void => {
        notifyInfo('Split panes not yet implemented')
      },
    },
    {
      id: 'split-vertical',
      label: ':split-vertical',
      description: 'Split pane vertically (not yet implemented)',
      icon: 'vertical_split',
      execute: (): void => {
        notifyInfo('Split panes not yet implemented')
      },
    },
  ]
}
