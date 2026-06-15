// cspell:ignore tabnew tabclose tabnext tabn tabprev tabp tabe tabc
import type {
  Session,
  SessionCloseResult,
  LayoutId,
} from '../../sessions/types'
import { validateTitle } from '../../sessions/utils/sanitizeTitle'
import { isExpectedLocalOnlyRenameFailure } from '../../sessions/utils/agentRenameErrors'
import type { Command } from '../../command-palette/registry/types'
import { fuzzyMatch } from '../../command-palette/registry/fuzzyMatch'

// Score a query against every alias form of a vim ex-command and return the
// best match. The command-palette filter strips the leading ':' before calling
// `match`, so forms here must be ':'-stripped (e.g. 'w', 'write').
const aliasMatch =
  (...forms: string[]) =>
  (query: string): number =>
    forms.reduce((best, form) => Math.max(best, fuzzyMatch(query, form)), 0)

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
  /**
   * PTY handle of the active pane in the active session, or `null` if no
   * session is active. Used by `:rename-pane` to address the pane locally
   * via `setPaneUserLabel(ptyId, label)`.
   */
  activePanePtyId: string | null
  activePaneAgentType?: Session['agentType'] | null
  createSession: () => void
  createBrowserSession?: () => void
  removeSession: (id: string) => SessionCloseResult
  renameSession: (id: string, name: string) => void
  /**
   * Set a per-pane user label, written by `:rename-pane`. In-memory only;
   * see `pane.userLabel` doc in `src/features/sessions/types/index.ts`.
   */
  setPaneUserLabel: (
    ptyId: string,
    label: string | undefined,
    options?: { ifCurrentLabel?: string | undefined }
  ) => void
  /**
   * Write `/rename <label>\r` to the agent's PTY. Raw-mode agent TUIs
   * submit on CR (`\r`), not LF. The agent persists the new title to
   * its transcript/index, which then re-emits through PR1's
   * `agent-session-title` channel and the pane's `agentTitle` converges.
   * Returns a promise that rejects on IPC failure; callers surface the
   * error via `notifyInfo`.
   */
  renameAgentSession: (ptyId: string, label: string) => Promise<void>
  nextPaneRenameRequestId?: () => number
  isCurrentPaneRenameRequest?: (requestId: number) => boolean
  setActiveSessionId: (id: string) => void
  notifyInfo: (message: string) => void
  /**
   * Toggle the workspace-global sidebar-collapse flag (VIM-66). Optional so
   * callers/tests that don't exercise `:toggle-sidebar` stay valid; the real
   * WorkspaceView always provides it.
   */
  toggleSidebar?: () => void
  /**
   * Toggle the focused pane's burner terminal (VIM-72). Resolves the focused
   * pane and hides-if-shown, same as the `Mod+;` then backtick chord. Optional
   * so the builder's unit tests need not thread it; WorkspaceView always wires it.
   */
  toggleBurner?: () => void
  /**
   * Keymap preset that gates vim-flavored ex-command aliases (VIM-104 B1).
   * Optional so existing callers/tests stay valid.
   */
  keymapPreset?: string
  /**
   * Save the active editor file, wired to `:w` / `:write`.
   */
  saveActiveFile?: () => void
  /**
   * Open a file path in the editor, wired to `:edit <path>`.
   */
  openFileInEditor?: (path: string) => void
  /**
   * Close the focused pane, guarded by `canClosePane`. Wired to `:q`.
   */
  closeActivePane?: () => void
  /**
   * Change the active session's layout. Wired to `:vsplit`, `:split`, `:only`.
   */
  setActiveSessionLayout?: (layoutId: LayoutId) => void
}

interface FallbackPaneRenameRequestState {
  current: number
}

const fallbackPaneRenameRequestStates = new WeakMap<
  WorkspaceCommandDeps['renameAgentSession'],
  FallbackPaneRenameRequestState
>()

// Production injects a WorkspaceView-owned request guard. The fallback is for
// direct builder tests and is keyed by the backend function so command rebuilds
// share state without leaking across unrelated tests/callers.
const fallbackPaneRenameRequestStateFor = (
  renameAgentSession: WorkspaceCommandDeps['renameAgentSession']
): FallbackPaneRenameRequestState => {
  const existing = fallbackPaneRenameRequestStates.get(renameAgentSession)
  if (existing) {
    return existing
  }

  const created = { current: 0 }
  fallbackPaneRenameRequestStates.set(renameAgentSession, created)

  return created
}

// Pure builder: closures capture `deps`, so call from a useMemo over session-manager state.
export const buildWorkspaceCommands = (
  deps: WorkspaceCommandDeps
): Command[] => {
  const {
    sessions,
    activeSessionId,
    activePanePtyId,
    activePaneAgentType = null,
    createSession,
    createBrowserSession,
    removeSession,
    renameSession,
    setPaneUserLabel,
    renameAgentSession,
    nextPaneRenameRequestId,
    isCurrentPaneRenameRequest,
    setActiveSessionId,
    notifyInfo,
    toggleSidebar,
    toggleBurner,
    keymapPreset,
    saveActiveFile,
    openFileInEditor,
    closeActivePane,
    setActiveSessionLayout,
  } = deps

  const fallbackPaneRenameRequestState =
    fallbackPaneRenameRequestStateFor(renameAgentSession)

  const hasInjectedPaneRenameRequestGuard =
    nextPaneRenameRequestId !== undefined &&
    isCurrentPaneRenameRequest !== undefined

  const claimPaneRenameRequest = (): number => {
    if (hasInjectedPaneRenameRequestGuard) {
      return nextPaneRenameRequestId()
    }

    fallbackPaneRenameRequestState.current += 1

    return fallbackPaneRenameRequestState.current
  }

  const isLatestPaneRenameRequest = (requestId: number): boolean => {
    if (hasInjectedPaneRenameRequestGuard) {
      return isCurrentPaneRenameRequest(requestId)
    }

    return requestId === fallbackPaneRenameRequestState.current
  }

  const findActiveIndex = (): number =>
    sessions.findIndex((s) => s.id === activeSessionId)

  const switchRelativeSession = (delta: number): void => {
    if (sessions.length === 0) {
      notifyInfo('No open sessions')

      return
    }

    const idx = findActiveIndex()

    const nextIdx =
      idx === -1
        ? delta > 0
          ? 0
          : sessions.length - 1
        : (idx + delta + sessions.length) % sessions.length

    setActiveSessionId(sessions[nextIdx].id)
  }

  const closeActiveSessionCommand = (): void => {
    const idx = findActiveIndex()

    if (idx === -1) {
      notifyInfo('No active tab to close')

      return
    }

    removeSession(sessions[idx].id)
  }

  const browserCommand: Command | undefined = createBrowserSession
    ? {
        id: 'new-browser',
        label: ':new-browser',
        description: 'Create a new browser-only session',
        icon: 'public',
        execute: (): void => {
          createBrowserSession()
        },
      }
    : undefined

  const baseCommands: Command[] = [
    {
      id: 'new',
      label: ':new',
      description: 'Create a new terminal session',
      icon: 'add',
      execute: (): void => {
        createSession()
      },
    },
    ...(browserCommand ? [browserCommand] : []),
    {
      id: 'close',
      label: ':close',
      description: 'Close the active terminal session',
      icon: 'close',
      execute: (): void => {
        closeActiveSessionCommand()
      },
    },
    {
      // `:rename` was the old single-rename command; split into two to
      // disambiguate session-level vs per-pane intent (the previous
      // single command always renamed the session, surprising users who
      // wanted to label one pane in a multi-pane session).
      id: 'rename-session',
      label: ':rename-session',
      description: 'Rename the active terminal session (affects all panes)',
      icon: 'edit',
      execute: (args: string): void => {
        const idx = findActiveIndex()

        if (idx === -1) {
          notifyInfo('No active tab to rename')

          return
        }

        const validation = validateTitle(args)

        if (validation.kind === 'empty') {
          notifyInfo('Usage: :rename-session <name>')

          return
        }

        if (validation.kind === 'invalid') {
          notifyInfo('title is too long (max 200 bytes)')

          return
        }

        renameSession(sessions[idx].id, validation.sanitized)
      },
    },
    {
      id: 'rename-pane',
      label: ':rename-pane',
      description: 'Rename only the active pane (does not affect siblings)',
      icon: 'edit',
      execute: (args: string): void => {
        if (!activePanePtyId) {
          notifyInfo('No active pane to rename')

          return
        }

        const validation = validateTitle(args)

        if (validation.kind === 'empty') {
          notifyInfo('Usage: :rename-pane <name>')

          return
        }

        if (validation.kind === 'invalid') {
          notifyInfo('title is too long (max 200 bytes)')

          return
        }

        const title = validation.sanitized
        const requestId = claimPaneRenameRequest()

        // Always set the local label first so the Header reflects the
        // new name immediately, even before the agent round-trip
        // completes (or for non-agent panes where no round-trip exists).
        setPaneUserLabel(activePanePtyId, title)

        // Ask the backend to sync the agent transcript even if the
        // frontend still sees `generic`. The backend owns the live-agent
        // registry and returns a clear error for shell / unsupported panes.
        const syncAgentRename = async (): Promise<void> => {
          try {
            await renameAgentSession(activePanePtyId, title)
          } catch (error: unknown) {
            if (isExpectedLocalOnlyRenameFailure(error, activePaneAgentType)) {
              return
            }

            if (!isLatestPaneRenameRequest(requestId)) {
              return
            }

            setPaneUserLabel(activePanePtyId, undefined, {
              ifCurrentLabel: title,
            })

            const message =
              error instanceof Error ? error.message : String(error)
            notifyInfo(`agent /rename failed: ${message}`)
          }
        }

        void syncAgentRename()
      },
    },
    {
      id: 'next',
      label: ':next',
      description: 'Switch to the next terminal session',
      icon: 'arrow_forward',
      execute: (): void => {
        switchRelativeSession(1)
      },
    },
    {
      id: 'previous',
      label: ':previous',
      description: 'Switch to the previous terminal session',
      icon: 'arrow_back',
      execute: (): void => {
        switchRelativeSession(-1)
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
      id: 'toggle-sidebar',
      label: ':toggle-sidebar',
      description: 'Show or hide the sidebar',
      icon: 'left_panel_close',
      execute: (): void => {
        toggleSidebar?.()
      },
    },
    {
      id: 'burner',
      label: ':burner',
      description: 'Toggle the burner terminal for the focused pane',
      icon: 'terminal',
      execute: (): void => {
        toggleBurner?.()
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

  if (keymapPreset !== 'vim') {
    return baseCommands
  }

  const vimCommands: Command[] = [
    {
      id: 'vim-write',
      label: ':w',
      description: 'Save the active file',
      icon: 'save',
      match: aliasMatch('w', 'write'),
      execute: (): void => {
        if (saveActiveFile) {
          saveActiveFile()

          return
        }

        notifyInfo('No file to save')
      },
    },
    {
      id: 'vim-quit',
      label: ':q',
      description: 'Close the focused pane',
      icon: 'close',
      // :q has no secondary alias in the design.
      execute: (): void => {
        if (closeActivePane) {
          closeActivePane()

          return
        }

        notifyInfo('No pane to close')
      },
    },
    {
      id: 'vim-quit-all',
      label: ':qa',
      description: 'Close the active session',
      icon: 'exit_to_app',
      execute: (): void => {
        closeActiveSessionCommand()
      },
    },
    {
      id: 'vim-tabnew',
      label: ':tabnew',
      description: 'New session',
      icon: 'add',
      match: aliasMatch('tabnew', 'tabe'),
      execute: (): void => {
        createSession()
      },
    },
    {
      id: 'vim-tabclose',
      label: ':tabclose',
      description: 'Close the active session',
      icon: 'close',
      match: aliasMatch('tabclose', 'tabc'),
      execute: (): void => {
        closeActiveSessionCommand()
      },
    },
    {
      id: 'vim-tabnext',
      label: ':tabn',
      description: 'Next session',
      icon: 'arrow_forward',
      match: aliasMatch('tabn', 'tabnext'),
      execute: (): void => {
        switchRelativeSession(1)
      },
    },
    {
      id: 'vim-tabprev',
      label: ':tabp',
      description: 'Previous session',
      icon: 'arrow_back',
      match: aliasMatch('tabp', 'tabprev'),
      execute: (): void => {
        switchRelativeSession(-1)
      },
    },
    {
      id: 'vim-vsplit',
      label: ':vsplit',
      description: 'Left/right split layout',
      icon: 'vertical_split',
      match: aliasMatch('vsplit', 'vs'),
      execute: (): void => {
        if (setActiveSessionLayout) {
          setActiveSessionLayout('vsplit')

          return
        }

        notifyInfo('Layout change unavailable')
      },
    },
    {
      id: 'vim-split',
      label: ':split',
      description: 'Top/bottom split layout',
      icon: 'horizontal_split',
      match: aliasMatch('split', 'sp'),
      execute: (): void => {
        if (setActiveSessionLayout) {
          setActiveSessionLayout('hsplit')

          return
        }

        notifyInfo('Layout change unavailable')
      },
    },
    {
      id: 'vim-only',
      label: ':only',
      description: 'Single-pane layout',
      icon: 'crop_free',
      match: aliasMatch('only', 'on'),
      execute: (): void => {
        if (setActiveSessionLayout) {
          setActiveSessionLayout('single')

          return
        }

        notifyInfo('Layout change unavailable')
      },
    },
    {
      id: 'vim-edit',
      label: ':edit',
      description: 'Open a file (:edit <path>)',
      icon: 'edit',
      match: aliasMatch('edit', 'e'),
      execute: (args: string): void => {
        const path = args.trim()

        if (!path) {
          notifyInfo('Usage: :edit <path>')

          return
        }

        if (openFileInEditor) {
          openFileInEditor(path)

          return
        }

        notifyInfo('Editor unavailable')
      },
    },
  ]

  return [...baseCommands, ...vimCommands]
}
