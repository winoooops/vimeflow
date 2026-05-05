import type { Session } from '../types'
import type { Command } from '../../command-palette/registry/types'

export interface WorkspaceCommandDeps {
  sessions: Session[]
  activeSessionId: string | null
  createSession: () => void
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  setActiveSessionId: (id: string) => void
  notifyInfo: (message: string) => void
}

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

        // Try numeric (1-indexed)
        const num = parseInt(trimmed, 10)

        if (!isNaN(num)) {
          if (num < 1 || !Number.isInteger(parseFloat(trimmed))) {
            notifyInfo('Position must be a positive integer')

            return
          }

          if (num > sessions.length) {
            notifyInfo(`No tab at position ${num}`)

            return
          }

          setActiveSessionId(sessions[num - 1].id)

          return
        }

        // Try name match (case-insensitive substring)
        const match = sessions.find((s) =>
          s.name.toLowerCase().includes(trimmed.toLowerCase())
        )

        if (match) {
          setActiveSessionId(match.id)

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
