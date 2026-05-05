import type { Session } from '../types'
import type { Command } from '../../command-palette/registry/types'
import { fuzzyMatch } from '../../command-palette/registry/fuzzyMatch'

export interface WorkspaceCommandDeps {
  sessions: Session[]
  activeSessionId: string | null
  createSession: () => void
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  setActiveSessionId: (id: string) => void
  notifyInfo: (message: string) => void
}

/**
 * Build the workspace's command-palette command list.
 *
 * Pure function: takes the live `useSessionManager` API surface (sessions
 * + lifecycle callbacks) plus a `notifyInfo` channel and returns the
 * eight verb-keyed commands the palette dispatches against — the six
 * functional tab verbs (`:new`, `:close`, `:rename`, `:next`, `:previous`,
 * `:goto`) plus the two split-pane stubs (`:split-horizontal`,
 * `:split-vertical`). Each command's `execute` closure captures the
 * dependencies passed in, so the caller (typically `WorkspaceView`)
 * should re-invoke this builder inside a `useMemo` over the relevant
 * session-manager state to keep the closures in sync with the latest
 * tab list and active session.
 *
 * Pulled out of `WorkspaceView` so the failure-mode logic for each verb
 * is unit-testable in isolation against mocked deps, without rendering
 * the workspace shell. See `buildWorkspaceCommands.test.ts` for the
 * failure-mode contracts and `Section 5` of the design spec
 * (`docs/superpowers/specs/2026-05-04-command-palette-trigger-actions-design.md`)
 * for the authoritative behavior table.
 */
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

        // Try numeric position (1-indexed). Digit-prefixed names like
        // "1alpha" must still be reachable by name.
        const isPositionLike = /^-?\d+(?:\.\d+)?$/.test(trimmed)

        if (isPositionLike) {
          const position = Number(trimmed)

          if (position < 1 || !Number.isInteger(position)) {
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
          session: Session | null
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
