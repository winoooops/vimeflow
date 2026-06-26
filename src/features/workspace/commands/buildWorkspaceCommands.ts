import type { Session, SessionCloseResult } from '../../sessions/types'
import { validateTitle } from '../../sessions/utils/sanitizeTitle'
import { isExpectedLocalOnlyRenameFailure } from '../../sessions/utils/agentRenameErrors'
import type { Command } from '../../command-palette/registry/types'
import { fuzzyMatch } from '../../command-palette/registry/fuzzyMatch'
import { isMacPlatform } from '../../command-palette/shortcutConfig'
import { themeService } from '../../../theme'

export type DockPositionCommandArg = 'bottom' | 'top' | 'left' | 'right'

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
  // Restart the active session's shell pane. Omitted when absent.
  restartSession?: (id: string) => void
  // Surface the dock Editor tab (opens the dock if collapsed).
  openEditor?: () => void
  // Surface the dock Diff tab (opens the dock if collapsed).
  openDiff?: () => void
  // Toggle the editor/diff dock open or collapsed.
  toggleDock?: () => void
  // Apply a pane layout; returns false when the active session has too many panes.
  pickLayout?: (id: string) => boolean
  // Layout choices for the `:layout` namespace, in display order.
  availableLayouts?: readonly { id: string; title: string }[]
  // Move the dock to an edge of the workspace.
  setDockPosition?: (pos: DockPositionCommandArg) => void
  // Current dock edge, used to mark the active `:dock-position` choice.
  dockPosition?: string
  // Show or hide the agent activity panel.
  toggleActivityPanel?: () => void
  // Select a sidebar tab and ensure the sidebar is visible.
  showSidebarTab?: (tab: 'sessions' | 'files') => void
  // Move focus to the active terminal pane.
  focusTerminal?: () => void
  // Open a file in the dock editor by absolute path.
  openFile?: (path: string) => void
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

const DOCK_POSITION_CHOICES: readonly {
  pos: DockPositionCommandArg
  label: string
}[] = [
  { pos: 'bottom', label: 'Bottom' },
  { pos: 'top', label: 'Top' },
  { pos: 'left', label: 'Left' },
  { pos: 'right', label: 'Right' },
]

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
    restartSession,
    openEditor,
    openDiff,
    toggleDock,
    pickLayout,
    availableLayouts,
    setDockPosition,
    dockPosition,
    toggleActivityPanel,
    showSidebarTab,
    focusTerminal,
    openFile,
  } = deps

  const isMac = isMacPlatform()

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

  const restartCommand: Command | undefined = restartSession
    ? {
        id: 'restart',
        label: ':restart',
        description: 'Restart the active session shell',
        icon: 'restart_alt',
        execute: (): void => {
          if (!activeSessionId) {
            notifyInfo('No active session to restart')

            return
          }

          restartSession(activeSessionId)
        },
      }
    : undefined

  const openEditorCommand: Command | undefined = openEditor
    ? {
        id: 'open-editor',
        label: ':open-editor',
        description: 'Open the editor in the dock',
        icon: 'code',
        // ⌘E / Ctrl+E — useDockShortcuts.
        shortcut: isMac ? ['⌘', 'E'] : ['Ctrl', 'E'],
        execute: (): void => {
          openEditor()
        },
      }
    : undefined

  const openDiffCommand: Command | undefined = openDiff
    ? {
        id: 'open-diff',
        label: ':open-diff',
        description: 'Open the git diff in the dock',
        icon: 'difference',
        // ⌘G / Ctrl+G — useDockShortcuts.
        shortcut: isMac ? ['⌘', 'G'] : ['Ctrl', 'G'],
        execute: (): void => {
          openDiff()
        },
      }
    : undefined

  const toggleDockCommand: Command | undefined = toggleDock
    ? {
        id: 'toggle-dock',
        label: ':toggle-dock',
        description: 'Open or collapse the editor/diff dock',
        icon: 'horizontal_split',
        // ⌘0 / Ctrl+0 — useDockToggleShortcut.
        shortcut: isMac ? ['⌘', '0'] : ['Ctrl', '0'],
        execute: (): void => {
          toggleDock()
        },
      }
    : undefined

  const layoutCommand: Command | undefined =
    pickLayout && availableLayouts
      ? {
          id: 'layout',
          label: ':layout',
          description: 'Switch the pane layout',
          icon: 'grid_view',
          children: availableLayouts.map((layout) => ({
            id: `layout-${layout.id}`,
            label: layout.title,
            description: `Switch to the ${layout.title} layout`,
            icon: 'grid_view',
            execute: (): void => {
              // `false` means the active session has more panes than this layout holds.
              if (pickLayout(layout.id) === false) {
                notifyInfo(`Layout '${layout.title}' needs fewer panes`)
              }
            },
          })),
        }
      : undefined

  const dockPositionCommand: Command | undefined = setDockPosition
    ? {
        id: 'dock-position',
        label: ':dock-position',
        description: 'Move the dock to an edge',
        icon: 'open_in_new',
        children: DOCK_POSITION_CHOICES.map((choice) => ({
          id: `dock-position-${choice.pos}`,
          label: choice.label,
          description:
            choice.pos === dockPosition
              ? `Dock is at ${choice.label.toLowerCase()}`
              : `Move dock to ${choice.label.toLowerCase()}`,
          icon: 'open_in_new',
          execute: (): void => {
            setDockPosition(choice.pos)
          },
        })),
      }
    : undefined

  const toggleActivityCommand: Command | undefined = toggleActivityPanel
    ? {
        id: 'toggle-activity',
        label: ':toggle-activity',
        description: 'Show or hide the agent activity panel',
        icon: 'notes',
        execute: (): void => {
          toggleActivityPanel()
        },
      }
    : undefined

  const showSessionsCommand: Command | undefined = showSidebarTab
    ? {
        id: 'show-sessions',
        label: ':show-sessions',
        description: 'Show the sessions sidebar tab',
        icon: 'view_agenda',
        execute: (): void => {
          showSidebarTab('sessions')
        },
      }
    : undefined

  const showFilesCommand: Command | undefined = showSidebarTab
    ? {
        id: 'show-files',
        label: ':show-files',
        description: 'Show the files sidebar tab',
        icon: 'folder_open',
        execute: (): void => {
          showSidebarTab('files')
        },
      }
    : undefined

  const focusTerminalCommand: Command | undefined = focusTerminal
    ? {
        id: 'focus-terminal',
        label: ':focus-terminal',
        description: 'Move focus to the active terminal',
        icon: 'terminal',
        execute: (): void => {
          focusTerminal()
        },
      }
    : undefined

  const openFileCommand: Command | undefined = openFile
    ? {
        id: 'open-file',
        label: ':open-file',
        description: 'Open a file by absolute path',
        icon: 'description',
        execute: (args: string): void => {
          const path = args.trim()

          if (!path) {
            notifyInfo('Usage: :open-file <absolute path>')

            return
          }

          openFile(path)
        },
      }
    : undefined

  return [
    // The workspace palette consumes THIS tree, not data/defaultCommands —
    // the `:set theme` entry there is unreachable in-app. Reconciling the
    // two trees is deferred to the upcoming command-palette refactor; until
    // then `:theme` here is the live switch surface.
    {
      id: 'theme',
      label: ':theme',
      description: 'Switch color theme',
      icon: 'palette',
      children: themeService.list().map((theme) => ({
        id: `theme-${theme.id}`,
        label: theme.label,
        description: `Switch to ${theme.label}`,
        icon: 'palette',
        preview: (): void => {
          themeService.preview(theme.id)
        },
        execute: (): void => {
          themeService.apply(theme.id)
        },
      })),
    },
    {
      id: 'new',
      label: ':new',
      description: 'Create a new terminal session',
      icon: 'add',
      // ⌘N / Ctrl+⇧N — useNewSessionShortcut.
      shortcut: isMac ? ['⌘', 'N'] : ['Ctrl', '⇧', 'N'],
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
        const idx = findActiveIndex()

        if (idx === -1) {
          notifyInfo('No active tab to close')

          return
        }

        removeSession(sessions[idx].id)
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
      id: 'toggle-sidebar',
      label: ':toggle-sidebar',
      description: 'Show or hide the sidebar',
      icon: 'left_panel_close',
      // ⌘B / Ctrl+⇧B — useSidebarShortcut.
      shortcut: isMac ? ['⌘', 'B'] : ['Ctrl', '⇧', 'B'],
      execute: (): void => {
        toggleSidebar?.()
      },
    },
    {
      id: 'burner',
      label: ':burner',
      description: 'Toggle the burner terminal for the focused pane',
      icon: 'terminal',
      // No chip: :burner is a ⌘; then ` leader chord, not a single combo.
      execute: (): void => {
        toggleBurner?.()
      },
    },
    ...(restartCommand ? [restartCommand] : []),
    ...(openEditorCommand ? [openEditorCommand] : []),
    ...(openDiffCommand ? [openDiffCommand] : []),
    ...(toggleDockCommand ? [toggleDockCommand] : []),
    ...(layoutCommand ? [layoutCommand] : []),
    ...(dockPositionCommand ? [dockPositionCommand] : []),
    ...(toggleActivityCommand ? [toggleActivityCommand] : []),
    ...(showSessionsCommand ? [showSessionsCommand] : []),
    ...(showFilesCommand ? [showFilesCommand] : []),
    ...(focusTerminalCommand ? [focusTerminalCommand] : []),
    ...(openFileCommand ? [openFileCommand] : []),
  ]
}
