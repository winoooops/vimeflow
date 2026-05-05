import type { Session } from '../types'
import type { Command } from '../../command-palette/registry/types'
import { fuzzyMatch } from '../../command-palette/registry/fuzzyMatch'

// Narrow slice — id+name are the only fields any command body reads.
// Enforcing the type at the boundary means a future command cannot quietly
// start reading `status` / `activity` / `workingDirectory` and inherit
// stale closures from the workspace's narrowed memo signature.
export type WorkspaceTab = Pick<Session, 'id' | 'name'>

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

        // Try numeric position (1-indexed). Digit-prefixed names like
        // "1alpha" must still be reachable by name.
        const isPositionLike = /^-?\d+(?:\.\d+)?$/.test(trimmed)

        if (isPositionLike) {
          const position = Number(trimmed)

          // `Number.isInteger(1.0)` is `true`, so the explicit decimal-point
          // check is what catches `:goto 1.0` / `:goto 2.0` and routes them
          // to the same error path as `:goto 1.5`. Without this check, those
          // inputs would silently navigate to the integer position, masking
          // typos.
          if (
            position < 1 ||
            !Number.isInteger(position) ||
            trimmed.includes('.')
          ) {
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
