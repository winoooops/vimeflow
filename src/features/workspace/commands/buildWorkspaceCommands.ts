// cspell:ignore tabnew tabe tabclose tabc tabnext tabn tabprev tabp
import type {
  LayoutId,
  Session,
  SessionCloseResult,
} from '../../sessions/types'
import { cycleSession } from '../../sessions/utils/cycleSession'
import { validateTitle } from '../../sessions/utils/sanitizeTitle'
import { isExpectedLocalOnlyRenameFailure } from '../../sessions/utils/agentRenameErrors'
import type { Command } from '../../command-palette/registry/types'
import { fuzzyMatch } from '../../command-palette/registry/fuzzyMatch'
import { isMacPlatform } from '../../command-palette/shortcutConfig'
import {
  SINGLE_PANE_FOCUS_LABEL,
  SINGLE_PANE_FOCUS_LAYOUT_ID,
} from '../../terminal/layout-registry'
import { themeService } from '../../../theme'
import type { CommandId } from '../../keymap/catalog'

export type DockPositionCommandArg = 'bottom' | 'top' | 'left' | 'right'

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
  navigableSessions?: WorkspaceTab[]
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
   * pane and hides-if-shown, same as the registered burner shortcut. Optional
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
  // Resolved registry display tokens for commands with a live accelerator.
  keybindingShortcut?: (id: CommandId) => string[]
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
    navigableSessions = sessions,
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
    keybindingShortcut,
  } = deps

  const isMac = isMacPlatform()

  const shortcutFor = (id: CommandId, fallback: string[]): string[] =>
    keybindingShortcut?.(id) ?? fallback

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
    const nextSession = cycleSession(navigableSessions, activeSessionId, delta)
    if (nextSession === null) {
      notifyInfo('No open sessions')

      return
    }

    setActiveSessionId(nextSession.id)
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
        description: 'New browser',
        hint: 'open a browser-only session',
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
        description: 'Restart session',
        hint: 'respawn the active shell',
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
        description: 'Open editor',
        hint: 'edit files in the dock',
        icon: 'code',
        shortcut: shortcutFor(
          'focus-editor',
          isMac ? ['⌘', 'E'] : ['Ctrl', 'E']
        ),
        execute: (): void => {
          openEditor()
        },
      }
    : undefined

  const openDiffCommand: Command | undefined = openDiff
    ? {
        id: 'open-diff',
        label: ':open-diff',
        description: 'Open diff',
        hint: 'review changes vs HEAD',
        icon: 'difference',
        shortcut: shortcutFor('focus-diff', isMac ? ['⌘', 'G'] : ['Ctrl', 'G']),
        execute: (): void => {
          openDiff()
        },
      }
    : undefined

  const toggleDockCommand: Command | undefined = toggleDock
    ? {
        id: 'toggle-dock',
        label: ':toggle-dock',
        description: 'Toggle dock',
        hint: 'show or hide the panel',
        icon: 'horizontal_split',
        shortcut: shortcutFor(
          'dock-toggle',
          isMac ? ['⌘', '0'] : ['Ctrl', '0']
        ),
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
          description: 'Pane layout',
          hint: 'switch the arrangement',
          icon: 'grid_view',
          children: availableLayouts.map((layout) => ({
            id: `layout-${layout.id}`,
            label:
              layout.id === SINGLE_PANE_FOCUS_LAYOUT_ID
                ? SINGLE_PANE_FOCUS_LABEL
                : layout.title,
            description:
              layout.id === SINGLE_PANE_FOCUS_LAYOUT_ID
                ? 'Toggle active-pane focus'
                : `Switch to the ${layout.title} layout`,
            icon: 'grid_view',
            shortcut:
              layout.id === SINGLE_PANE_FOCUS_LAYOUT_ID
                ? shortcutFor(
                    'single-pane-focus',
                    isMac ? ['⌘', 'Z'] : ['Ctrl', 'Z']
                  )
                : undefined,
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
        description: 'Dock position',
        hint: 'move it to an edge',
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
        description: 'Activity panel',
        hint: 'show or hide agent activity',
        icon: 'notes',
        shortcut: shortcutFor(
          'activity-panel-toggle',
          isMac ? ['⌘', 'R'] : ['Ctrl', 'R']
        ),
        execute: (): void => {
          toggleActivityPanel()
        },
      }
    : undefined

  const showSessionsCommand: Command | undefined = showSidebarTab
    ? {
        id: 'show-sessions',
        label: ':show-sessions',
        description: 'Sessions tab',
        hint: 'open the sessions sidebar',
        icon: 'view_agenda',
        shortcut: shortcutFor(
          'sidebar-sessions',
          isMac ? ['⌘', '⇧', 'S'] : ['Ctrl', '⇧', 'S']
        ),
        execute: (): void => {
          showSidebarTab('sessions')
        },
      }
    : undefined

  const showFilesCommand: Command | undefined = showSidebarTab
    ? {
        id: 'show-files',
        label: ':show-files',
        description: 'Files tab',
        hint: 'open the file tree',
        icon: 'folder_open',
        shortcut: shortcutFor(
          'sidebar-files',
          isMac ? ['⌘', '⇧', 'F'] : ['Ctrl', '⇧', 'F']
        ),
        execute: (): void => {
          showSidebarTab('files')
        },
      }
    : undefined

  const focusTerminalCommand: Command | undefined = focusTerminal
    ? {
        id: 'focus-terminal',
        label: ':focus-terminal',
        description: 'Focus terminal',
        hint: 'return focus to the terminal',
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
        description: 'Open file',
        hint: 'by absolute path',
        icon: 'description',
        requiresArgument: true,
        argumentPlaceholder: '<absolute path>',
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

  const baseCommands: Command[] = [
    // The workspace palette consumes THIS tree, not data/defaultCommands —
    // the `:set theme` entry there is unreachable in-app. Reconciling the
    // two trees is deferred to the upcoming command-palette refactor; until
    // then `:theme` here is the live switch surface.
    {
      id: 'theme',
      label: ':theme',
      description: 'Color theme',
      hint: 'switch the active scheme',
      icon: 'palette',
      children: themeService.list().map((theme) => {
        const isActive = themeService.current().id === theme.id

        return {
          id: `theme-${theme.id}`,
          label: theme.label,
          description: isActive ? 'Active theme' : `Switch to ${theme.label}`,
          icon: 'palette',
          isActive: (): boolean => themeService.current().id === theme.id,
          preview: (): void => {
            themeService.preview(theme.id)
          },
          execute: (): void => {
            themeService.apply(theme.id)
          },
        }
      }),
    },
    {
      id: 'new',
      label: ':new',
      description: 'New session',
      hint: 'spawn a terminal session',
      icon: 'add',
      shortcut: shortcutFor(
        'new-session',
        isMac ? ['⌘', 'N'] : ['Ctrl', '⇧', 'N']
      ),
      execute: (): void => {
        createSession()
      },
    },
    ...(browserCommand ? [browserCommand] : []),
    {
      id: 'close',
      label: ':close',
      description: 'Close session',
      hint: 'close the active session',
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
      description: 'Rename session',
      hint: 'renames every pane',
      icon: 'edit',
      requiresArgument: true,
      argumentPlaceholder: '<name>',
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
      description: 'Rename pane',
      hint: 'only the active pane',
      icon: 'edit',
      requiresArgument: true,
      argumentPlaceholder: '<name>',
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
      description: 'Next session',
      hint: 'switch forward',
      icon: 'arrow_forward',
      shortcut: shortcutFor(
        'session-next',
        isMac ? ['⌘', ']'] : ['Ctrl', '⇧', ']']
      ),
      execute: (): void => {
        switchRelativeSession(1)
      },
    },
    {
      id: 'previous',
      label: ':previous',
      description: 'Previous session',
      hint: 'switch back',
      icon: 'arrow_back',
      shortcut: shortcutFor(
        'session-prev',
        isMac ? ['⌘', '['] : ['Ctrl', '⇧', '[']
      ),
      execute: (): void => {
        switchRelativeSession(-1)
      },
    },
    {
      id: 'goto',
      label: ':goto',
      description: 'Go to session',
      hint: 'by position or name',
      icon: 'tab',
      requiresArgument: true,
      argumentPlaceholder: '<position or name>',
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
        if (navigableSessions.length === 0) {
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

          if (position > navigableSessions.length) {
            notifyInfo(`No tab at position ${position}`)

            return
          }

          setActiveSessionId(navigableSessions[position - 1].id)

          return
        }

        const match = navigableSessions.reduce<{
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
      description: 'Toggle sidebar',
      hint: 'show or hide the sidebar',
      icon: 'left_panel_close',
      shortcut: shortcutFor(
        'sidebar-toggle',
        isMac ? ['⌘', 'B'] : ['Ctrl', '⇧', 'B']
      ),
      execute: (): void => {
        toggleSidebar?.()
      },
    },
    {
      id: 'burner',
      label: ':burner',
      description: 'Burner terminal',
      hint: 'toggle for the focused pane',
      icon: 'terminal',
      shortcut: shortcutFor(
        'burner-toggle',
        isMac ? ['⌃', '`'] : ['Ctrl', '`']
      ),
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
        if (pickLayout) {
          if (pickLayout('vsplit') === false) {
            notifyInfo("Layout 'VSplit' needs fewer panes")
          }

          return
        }

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
        if (pickLayout) {
          if (pickLayout('hsplit') === false) {
            notifyInfo("Layout 'HSplit' needs fewer panes")
          }

          return
        }

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
        if (pickLayout) {
          if (pickLayout('single') === false) {
            notifyInfo("Layout 'Single' needs fewer panes")
          }

          return
        }

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
