// cspell:ignore Ghostty tabnew tabclose tabnext tabn tabprev tabp tabe tabc
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { AgentRenameError } from '../../../lib/backend'
import {
  buildWorkspaceCommands,
  type WorkspaceTab,
  type WorkspaceCommandDeps,
} from './buildWorkspaceCommands'
import type { Command } from '../../command-palette/registry/types'
import { fuzzyMatch } from '../../command-palette/registry/fuzzyMatch'
import { isMacPlatform } from '../../command-palette/shortcutConfig'
import {
  SINGLE_PANE_FOCUS_LABEL,
  SINGLE_PANE_FOCUS_LAYOUT_ID,
} from '../../terminal/layout-registry'
import { themeService, themeToScheme } from '../../../theme'
import { AVAILABLE_SETTINGS_SECTIONS } from '@/features/settings/sections'

// TODO(VIM-339): Cover the command/settings flow once terminal fonts can be
// persisted and hot-swapped across native Ghostty and the xterm fallback.

vi.mock('../../command-palette/shortcutConfig', async (importActual) => {
  const actual =
    await importActual<typeof import('../../command-palette/shortcutConfig')>()

  return { ...actual, isMacPlatform: vi.fn(() => false) }
})

describe('buildWorkspaceCommands - happy paths', () => {
  const mockSessions: WorkspaceTab[] = [
    { id: 'session-1', name: 'main' },
    { id: 'session-2', name: 'feature-branch' },
    { id: 'session-3', name: 'bugfix' },
  ]

  let createSession: ReturnType<typeof vi.fn>
  let removeSession: ReturnType<typeof vi.fn>
  let renameSession: ReturnType<typeof vi.fn>
  let setPaneUserLabel: ReturnType<typeof vi.fn>
  let renameAgentSession: ReturnType<typeof vi.fn>
  let setActiveSessionId: ReturnType<typeof vi.fn>
  let notifyInfo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    themeService._resetCustomThemesForTest()
    themeService.apply('obsidian-lens')
    createSession = vi.fn()
    removeSession = vi.fn()
    renameSession = vi.fn()
    setPaneUserLabel = vi.fn()
    renameAgentSession = vi.fn().mockResolvedValue(undefined)
    setActiveSessionId = vi.fn()
    notifyInfo = vi.fn()
  })

  test(':theme command lists registered themes and applies on execute', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const themeCmd = commands.find((c) => c.id === 'theme')
    expect(themeCmd?.children?.map((c) => c.id)).toEqual([
      'theme-obsidian-lens',
      'theme-flexoki',
      'theme-gruvbox-dark',
      'theme-gruvbox-light',
      'theme-tokyo-night',
      'theme-dracula',
      'theme-ayu',
      'theme-eldritch',
      'theme-kanagawa',
      'theme-nord',
      'theme-rose-pine',
    ])

    expect(
      themeCmd?.children?.find(
        (command) => command.id === 'theme-obsidian-lens'
      )?.description
    ).toBe('Active theme')

    expect(
      themeCmd?.children?.find((command) => command.id === 'theme-flexoki')
        ?.description
    ).toBe('Switch to Flexoki')

    themeCmd?.children?.find((c) => c.id === 'theme-flexoki')?.execute?.('')
    expect(themeService.current().id).toBe('flexoki')

    themeCmd?.children
      ?.find((c) => c.id === 'theme-gruvbox-dark')
      ?.execute?.('')
    expect(themeService.current().id).toBe('gruvbox-dark')

    themeCmd?.children
      ?.find((c) => c.id === 'theme-gruvbox-light')
      ?.execute?.('')
    expect(themeService.current().id).toBe('gruvbox-light')

    themeCmd?.children?.find((c) => c.id === 'theme-tokyo-night')?.preview?.()
    expect(themeService.current().id).toBe('gruvbox-light')
    expect(themeService.displayed().id).toBe('tokyo-night')

    themeCmd?.children?.find((c) => c.id === 'theme-tokyo-night')?.execute?.('')
    expect(themeService.current().id).toBe('tokyo-night')

    themeCmd?.children?.find((c) => c.id === 'theme-dracula')?.preview?.()
    expect(themeService.current().id).toBe('tokyo-night')
    expect(themeService.displayed().id).toBe('dracula')

    themeCmd?.children?.find((c) => c.id === 'theme-dracula')?.execute?.('')
    expect(themeService.current().id).toBe('dracula')

    themeCmd?.children
      ?.find((c) => c.id === 'theme-obsidian-lens')
      ?.execute?.('')
    expect(themeService.current().id).toBe('obsidian-lens')
  })

  test(':theme includes an imported theme on the next command-tree build', () => {
    themeService.install({
      ...themeToScheme(themeService.current()),
      id: 'custom-command-theme',
      label: 'Custom Command Theme',
    })

    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const themeChildren = commands.find(
      (command) => command.id === 'theme'
    )?.children

    expect(
      themeChildren?.some(
        (command) => command.id === 'theme-custom-command-theme'
      )
    ).toBe(true)

    expect(
      themeChildren?.find(
        (command) => command.id === 'theme-custom-command-theme'
      )?.description
    ).toBe('Active theme')
  })

  test(':new command calls createSession', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const newCmd = commands.find((c) => c.id === 'new')
    expect(newCmd).toBeDefined()
    expect(newCmd?.execute).toBeDefined()

    newCmd?.execute?.('')
    expect(createSession).toHaveBeenCalledOnce()
  })

  test(':new-browser command calls createBrowserSession', () => {
    const createBrowserSession = vi.fn()

    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      createBrowserSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const cmd = commands.find((c) => c.id === 'new-browser')
    expect(cmd).toBeDefined()
    expect(cmd?.label).toBe(':new-browser')

    cmd?.execute?.('')
    expect(createBrowserSession).toHaveBeenCalledOnce()
  })

  test(':new-browser command is absent when createBrowserSession is not provided', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const cmd = commands.find((c) => c.id === 'new-browser')
    expect(cmd).toBeUndefined()
  })

  test(':toggle-sidebar command calls toggleSidebar', () => {
    const toggleSidebar = vi.fn()

    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
      toggleSidebar,
    })

    const cmd = commands.find((c) => c.id === 'toggle-sidebar')
    expect(cmd).toBeDefined()
    expect(cmd?.label).toBe(':toggle-sidebar')

    cmd?.execute?.('')
    expect(toggleSidebar).toHaveBeenCalledOnce()
  })

  test(':close command removes active session', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-2',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const closeCmd = commands.find((c) => c.id === 'close')
    expect(closeCmd).toBeDefined()

    closeCmd?.execute?.('')
    expect(removeSession).toHaveBeenCalledWith('session-2')
  })

  test(':close command can remove active tab outside the navigable set', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      navigableSessions: [mockSessions[0], mockSessions[2]],
      activeSessionId: 'session-2',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    commands.find((c) => c.id === 'close')?.execute?.('')
    expect(removeSession).toHaveBeenCalledWith('session-2')
  })

  test(':burner command toggles the focused pane burner terminal', () => {
    const toggleBurner = vi.fn()

    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
      toggleBurner,
    })

    const burnerCmd = commands.find((c) => c.id === 'burner')
    expect(burnerCmd).toBeDefined()
    expect(burnerCmd?.label).toBe(':burner')

    // No-arg toggle: resolves the focused pane and hides-if-shown (chord parity).
    burnerCmd?.execute?.('')
    expect(toggleBurner).toHaveBeenCalledOnce()
  })

  test('typing :bu surfaces only the :burner command (no collision)', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
      toggleBurner: vi.fn(),
    })

    // Mirror useCommandPalette's filter: score each label (minus ':') against
    // the typed verb, keep score > 0. `:sc` once collided with :split-vertical;
    // pin that `:bu` resolves uniquely to :burner.
    const matched = commands
      .filter((c) => fuzzyMatch('bu', c.label.replace(':', '')) > 0)
      .map((c) => c.id)

    expect(matched).toEqual(['burner'])
  })

  test('marks commands with required palette args', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
      openFile: vi.fn(),
    })

    expect(
      commands
        .filter((command) => command.requiresArgument === true)
        .map((command) => ({
          id: command.id,
          argumentPlaceholder: command.argumentPlaceholder,
        }))
    ).toEqual([
      { id: 'rename-session', argumentPlaceholder: '<name>' },
      { id: 'rename-pane', argumentPlaceholder: '<name>' },
      { id: 'goto', argumentPlaceholder: '<position or name>' },
      { id: 'open-file', argumentPlaceholder: '<absolute path>' },
    ])
  })

  test(':rename-session command renames active session', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const renameCmd = commands.find((c) => c.id === 'rename-session')
    expect(renameCmd).toBeDefined()

    renameCmd?.execute?.('new-name')
    expect(renameSession).toHaveBeenCalledWith('session-1', 'new-name')
    expect(setPaneUserLabel).not.toHaveBeenCalled()
  })

  test(':rename-session can rename active tab outside the navigable set', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      navigableSessions: [mockSessions[0], mockSessions[2]],
      activeSessionId: 'session-2',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    commands.find((c) => c.id === 'rename-session')?.execute?.('done')
    expect(renameSession).toHaveBeenCalledWith('session-2', 'done')
  })

  test(':rename-session sanitizes controls before renaming active session', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const renameCmd = commands.find((c) => c.id === 'rename-session')
    renameCmd?.execute?.('bad\u001bname')

    expect(renameSession).toHaveBeenCalledWith('session-1', 'bad name')
    expect(notifyInfo).not.toHaveBeenCalled()
  })

  test(':rename-session rejects overlong input', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const renameCmd = commands.find((c) => c.id === 'rename-session')
    renameCmd?.execute?.('a'.repeat(201))

    expect(renameSession).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('title is too long (max 200 bytes)')
  })

  test(':rename-pane asks backend to sync even while pane type is generic', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-left',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    expect(renamePaneCmd).toBeDefined()

    renamePaneCmd?.execute?.('left')
    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-left', 'left')
    expect(renameAgentSession).toHaveBeenCalledWith('pty-left', 'left')
    expect(renameSession).not.toHaveBeenCalled()
  })

  test(':rename-pane suppresses expected non-agent backend failure after local label update', async () => {
    renameAgentSession.mockRejectedValueOnce(
      new AgentRenameError('no live agent', 'no-live-agent')
    )

    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-shell',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('shell-name')

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-shell', 'shell-name')
    expect(renameAgentSession).toHaveBeenCalledWith('pty-shell', 'shell-name')

    await Promise.resolve()
    await Promise.resolve()

    expect(notifyInfo).not.toHaveBeenCalled()
  })

  test(':rename-pane surfaces unexpected backend rename failure after local label update', async () => {
    renameAgentSession.mockRejectedValueOnce(new Error('pty write failed'))

    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-agent',
      activePaneAgentType: 'claude-code',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('agent-name')

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-agent', 'agent-name')
    expect(renameAgentSession).toHaveBeenCalledWith('pty-agent', 'agent-name')

    await Promise.resolve()
    await Promise.resolve()

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-agent', undefined, {
      ifCurrentLabel: 'agent-name',
    })

    expect(notifyInfo).toHaveBeenCalledWith(
      'agent /rename failed: pty write failed'
    )
  })

  test(':rename-pane stale backend failure does not clear newer label', async () => {
    let rejectFirstRename: (error: Error) => void = () => {
      throw new Error('first rename promise reject was not captured')
    }
    let latestRequestId = 0

    const nextPaneRenameRequestId = vi.fn(() => {
      latestRequestId += 1

      return latestRequestId
    })

    const isCurrentPaneRenameRequest = vi.fn(
      (requestId: number) => requestId === latestRequestId
    )
    renameAgentSession
      .mockReturnValueOnce(
        new Promise<void>((_resolve, reject) => {
          rejectFirstRename = reject
        })
      )
      .mockResolvedValueOnce(undefined)

    const firstCommands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-agent',
      activePaneAgentType: 'claude-code',
      nextPaneRenameRequestId,
      isCurrentPaneRenameRequest,
      setActiveSessionId,
      notifyInfo,
    })
    firstCommands.find((c) => c.id === 'rename-pane')?.execute?.('first')

    const secondCommands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-agent',
      activePaneAgentType: 'claude-code',
      nextPaneRenameRequestId,
      isCurrentPaneRenameRequest,
      setActiveSessionId,
      notifyInfo,
    })
    secondCommands.find((c) => c.id === 'rename-pane')?.execute?.('second')

    await Promise.resolve()
    await Promise.resolve()

    rejectFirstRename(new Error('pty write failed'))

    await Promise.resolve()
    await Promise.resolve()

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-agent', 'first')
    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-agent', 'second')
    expect(
      setPaneUserLabel.mock.calls.some(
        ([ptyId, label]) => ptyId === 'pty-agent' && label === undefined
      )
    ).toBe(false)
    expect(notifyInfo).not.toHaveBeenCalled()
  })

  test(':rename-pane fallback request guard survives command rebuilds', async () => {
    let rejectFirstRename: (error: Error) => void = () => {
      throw new Error('first rename promise reject was not captured')
    }
    renameAgentSession
      .mockReturnValueOnce(
        new Promise<void>((_resolve, reject) => {
          rejectFirstRename = reject
        })
      )
      .mockResolvedValueOnce(undefined)

    const firstCommands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-agent',
      activePaneAgentType: 'claude-code',
      setActiveSessionId,
      notifyInfo,
    })
    firstCommands.find((c) => c.id === 'rename-pane')?.execute?.('first')

    const secondCommands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-agent',
      activePaneAgentType: 'claude-code',
      setActiveSessionId,
      notifyInfo,
    })
    secondCommands.find((c) => c.id === 'rename-pane')?.execute?.('second')

    await Promise.resolve()
    await Promise.resolve()

    rejectFirstRename(new Error('pty write failed'))

    await Promise.resolve()
    await Promise.resolve()

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-agent', 'first')
    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-agent', 'second')
    expect(
      setPaneUserLabel.mock.calls.some(
        ([ptyId, label]) => ptyId === 'pty-agent' && label === undefined
      )
    ).toBe(false)
    expect(notifyInfo).not.toHaveBeenCalled()
  })

  test(':rename-pane fallback request guard is isolated per backend function', async () => {
    let rejectFirstRename: (error: Error) => void = () => {
      throw new Error('first rename promise reject was not captured')
    }

    const firstRenameAgentSession = vi.fn().mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectFirstRename = reject
      })
    )
    const secondRenameAgentSession = vi.fn().mockResolvedValueOnce(undefined)

    const firstCommands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession: firstRenameAgentSession,
      activePanePtyId: 'pty-first',
      activePaneAgentType: 'claude-code',
      setActiveSessionId,
      notifyInfo,
    })
    firstCommands.find((c) => c.id === 'rename-pane')?.execute?.('first')

    const secondCommands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession: secondRenameAgentSession,
      activePanePtyId: 'pty-second',
      activePaneAgentType: 'claude-code',
      setActiveSessionId,
      notifyInfo,
    })
    secondCommands.find((c) => c.id === 'rename-pane')?.execute?.('second')

    await Promise.resolve()
    await Promise.resolve()

    rejectFirstRename(new Error('pty write failed'))

    await Promise.resolve()
    await Promise.resolve()

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-first', undefined, {
      ifCurrentLabel: 'first',
    })

    expect(notifyInfo).toHaveBeenCalledWith(
      'agent /rename failed: pty write failed'
    )
  })

  test(':rename-pane rolls back expected backend failure for rename-capable pane', async () => {
    renameAgentSession.mockRejectedValueOnce(
      new AgentRenameError('no live agent', 'no-live-agent')
    )

    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-agent',
      activePaneAgentType: 'codex',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('agent-name')

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-agent', 'agent-name')
    expect(renameAgentSession).toHaveBeenCalledWith('pty-agent', 'agent-name')

    await Promise.resolve()
    await Promise.resolve()

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-agent', undefined, {
      ifCurrentLabel: 'agent-name',
    })

    expect(notifyInfo).toHaveBeenCalledWith(
      'agent /rename failed: no live agent'
    )
  })

  test(':rename-pane on a Claude pane ALSO writes /rename via renameAgentSession', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-claude',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('feat-x')

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-claude', 'feat-x')
    expect(renameAgentSession).toHaveBeenCalledWith('pty-claude', 'feat-x')
  })

  test(':rename-pane on a Codex pane ALSO writes /rename via renameAgentSession', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-codex',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('codex-task')

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-codex', 'codex-task')
    expect(renameAgentSession).toHaveBeenCalledWith('pty-codex', 'codex-task')
  })

  test(':rename-pane with no active pane notifies usage', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: null,
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('foo')

    expect(setPaneUserLabel).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('No active pane to rename')
  })

  test(':rename-pane with empty input shows usage', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-left',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('   ')

    expect(setPaneUserLabel).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('Usage: :rename-pane <name>')
  })

  test(':rename-pane with control character input sanitizes before local update', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-left',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('bad\nname')

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-left', 'bad name')
    expect(renameAgentSession).toHaveBeenCalledWith('pty-left', 'bad name')
    expect(notifyInfo).not.toHaveBeenCalled()
  })

  test(':rename-pane with overlong input rejects before local update', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-left',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('a'.repeat(201))

    expect(setPaneUserLabel).not.toHaveBeenCalled()
    expect(renameAgentSession).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('title is too long (max 200 bytes)')
  })

  test(':rename-pane collapses whitespace before local and agent rename', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-left',
      setActiveSessionId,
      notifyInfo,
    })

    const renamePaneCmd = commands.find((c) => c.id === 'rename-pane')
    renamePaneCmd?.execute?.('  Fix    CI  ')

    expect(setPaneUserLabel).toHaveBeenCalledWith('pty-left', 'Fix CI')
    expect(renameAgentSession).toHaveBeenCalledWith('pty-left', 'Fix CI')
  })

  test(':next command wraps to first session', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-3',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const nextCmd = commands.find((c) => c.id === 'next')
    expect(nextCmd).toBeDefined()

    nextCmd?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-1')
  })

  test(':next command moves to next session', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const nextCmd = commands.find((c) => c.id === 'next')
    nextCmd?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-2')
  })

  test(':previous command wraps to last session', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const prevCmd = commands.find((c) => c.id === 'previous')
    expect(prevCmd).toBeDefined()

    prevCmd?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-3')
  })

  test(':previous command moves to previous session', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-2',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const prevCmd = commands.find((c) => c.id === 'previous')
    prevCmd?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-1')
  })

  test(':goto command with numeric position (1-indexed)', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')
    expect(gotoCmd).toBeDefined()

    gotoCmd?.execute?.('2')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-2')
  })

  test(':goto command with name (fuzzy match)', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('feature')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-2')
  })

  test(':goto command with name searches only the navigable set', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      navigableSessions: [mockSessions[0], mockSessions[2]],
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('feature')
    expect(setActiveSessionId).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith("No tab matching 'feature'")
  })

  test(':goto command supports fuzzy abbreviation matching', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('fb')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-2')
  })

  test(':goto command with partial name match', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('bug')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-3')
  })

  test(':goto command treats digit-prefixed nonnumeric text as a name', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        ...mockSessions,
        {
          ...mockSessions[0],
          id: 'session-4',
          name: '1alpha',
        },
      ],
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('1alpha')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-4')
  })

  test('split stub commands are no longer registered', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    expect(commands.find((c) => c.id === 'split-horizontal')).toBeUndefined()
    expect(commands.find((c) => c.id === 'split-vertical')).toBeUndefined()
  })
})

describe('buildWorkspaceCommands - failure modes', () => {
  const mockSessions: WorkspaceTab[] = [
    { id: 'session-1', name: 'main' },
    { id: 'session-2', name: 'feature-branch' },
    { id: 'session-3', name: 'bugfix' },
  ]

  let createSession: ReturnType<typeof vi.fn>
  let removeSession: ReturnType<typeof vi.fn>
  let renameSession: ReturnType<typeof vi.fn>
  let setPaneUserLabel: ReturnType<typeof vi.fn>
  let renameAgentSession: ReturnType<typeof vi.fn>
  let setActiveSessionId: ReturnType<typeof vi.fn>
  let notifyInfo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createSession = vi.fn()
    removeSession = vi.fn()
    renameSession = vi.fn()
    setPaneUserLabel = vi.fn()
    renameAgentSession = vi.fn().mockResolvedValue(undefined)
    setActiveSessionId = vi.fn()
    notifyInfo = vi.fn()
  })

  test(':close with no active tab shows message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          name: 'main',
        },
      ],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const closeCmd = commands.find((c) => c.id === 'close')

    closeCmd?.execute?.('')
    expect(notifyInfo).toHaveBeenCalledWith('No active tab to close')
    expect(removeSession).not.toHaveBeenCalled()
  })

  test(':rename with no active tab shows message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const renameCmd = commands.find((c) => c.id === 'rename-session')

    renameCmd?.execute?.('new-name')
    expect(notifyInfo).toHaveBeenCalledWith('No active tab to rename')
    expect(renameSession).not.toHaveBeenCalled()
  })

  test(':rename with whitespace-only args shows usage message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          name: 'main',
        },
      ],
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const renameCmd = commands.find((c) => c.id === 'rename-session')

    renameCmd?.execute?.('   ')
    expect(renameSession).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('Usage: :rename-session <name>')
  })

  test(':goto with no args shows usage message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('')
    expect(notifyInfo).toHaveBeenCalledWith('Usage: :goto <position or name>')
  })

  // The position-validation branch only runs when sessions is non-empty
  // (the C7-1 hoisted guard short-circuits the empty case to "No open
  // sessions"). These tests pass mockSessions to exercise the
  // positive-integer-only contract in isolation.
  test(':goto with zero shows invalid position message', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('0')
    expect(notifyInfo).toHaveBeenCalledWith(
      'Position must be a positive integer'
    )
  })

  // Negative-sign and decimal-point inputs fall through to fuzzy name
  // matching (so a session named "-1" or "1.5" stays reachable). When no
  // session matches, the user sees the standard "No tab matching X"
  // message — same UX as any other non-matching name query.
  test(':goto with negative input falls through to fuzzy match', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('-1')
    expect(notifyInfo).toHaveBeenCalledWith("No tab matching '-1'")
    expect(setActiveSessionId).not.toHaveBeenCalled()
  })

  test(':goto with decimal input falls through to fuzzy match', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('1.5')
    expect(notifyInfo).toHaveBeenCalledWith("No tab matching '1.5'")
    expect(setActiveSessionId).not.toHaveBeenCalled()
  })

  // `:goto 1.0` falls through to fuzzy-name matching (the position regex
  // is positive-integer-only). When no session matches, the standard
  // "No tab matching" message fires — the input does NOT silently
  // navigate to position 1, which was the C7-2 concern.
  test(':goto with N.0 form falls through to fuzzy match (does not silently navigate)', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('1.0')
    expect(setActiveSessionId).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith("No tab matching '1.0'")
  })

  // C11-1 pin: a session named with a number-like string ("-1", "1.5",
  // "2.0") MUST be reachable via :goto by exact-name fuzzy match. The
  // previous regex matched these inputs and trapped them in the
  // position-validation branch, so such tabs were unreachable.
  test(':goto reaches a session whose name looks like a number', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        ...mockSessions,
        { id: 'session-neg', name: '-1' },
        { id: 'session-dec', name: '1.5' },
      ],
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('-1')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-neg')

    setActiveSessionId.mockClear()
    gotoCmd?.execute?.('1.5')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-dec')
  })

  // C7-1 pin: `:goto 1` against an empty session list emits the same
  // "No open sessions" message as the name path, instead of the
  // less-helpful "No tab at position 1".
  test(':goto with numeric input against empty sessions shows "No open sessions"', () => {
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('1')
    expect(notifyInfo).toHaveBeenCalledWith('No open sessions')
  })

  test(':goto with out-of-range position shows message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          name: 'main',
        },
      ],
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('99')
    expect(notifyInfo).toHaveBeenCalledWith('No tab at position 99')
  })

  test(':goto with no name match shows message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          name: 'main',
        },
      ],
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('nonexistent')
    expect(notifyInfo).toHaveBeenCalledWith("No tab matching 'nonexistent'")
  })

  test(':goto with name against empty sessions shows "No open sessions"', () => {
    // Pinning Claude r6 finding C6-3: with sessions.length === 0 the
    // generic "No tab matching X" message is misleading (it implies tabs
    // exist but none match). The empty-list branch emits a distinct
    // message that matches the user's actual situation.
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('main')
    expect(notifyInfo).toHaveBeenCalledWith('No open sessions')
  })

  test(':next with stale active id selects first session', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          name: 'main',
        },
        {
          id: 'session-2',
          name: 'feature',
        },
      ],
      activeSessionId: 'stale-id',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const nextCmd = commands.find((c) => c.id === 'next')

    nextCmd?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-1')
  })

  test(':previous with stale active id selects last session', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          name: 'main',
        },
        {
          id: 'session-2',
          name: 'feature',
        },
      ],
      activeSessionId: 'stale-id',
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const prevCmd = commands.find((c) => c.id === 'previous')

    prevCmd?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-2')
  })

  // C9-1 pin: :next / :previous on an empty session list emit the same
  // "No open sessions" message as :goto, instead of silently no-oping.
  // Without this signal a user with zero tabs sees the palette close with
  // no acknowledgement.
  test(':next with no sessions shows "No open sessions"', () => {
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const nextCmd = commands.find((c) => c.id === 'next')

    nextCmd?.execute?.('')
    expect(notifyInfo).toHaveBeenCalledWith('No open sessions')
    expect(setActiveSessionId).not.toHaveBeenCalled()
  })

  test(':previous with no sessions shows "No open sessions"', () => {
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setPaneUserLabel,
      renameAgentSession,
      activePanePtyId: 'pty-active',
      setActiveSessionId,
      notifyInfo,
    })

    const prevCmd = commands.find((c) => c.id === 'previous')

    prevCmd?.execute?.('')
    expect(notifyInfo).toHaveBeenCalledWith('No open sessions')
    expect(setActiveSessionId).not.toHaveBeenCalled()
  })
})

describe('buildWorkspaceCommands - vim aliases (VIM-104 B1)', () => {
  const mockSessions: WorkspaceTab[] = [
    { id: 'session-1', name: 'main' },
    { id: 'session-2', name: 'feature-branch' },
    { id: 'session-3', name: 'bugfix' },
  ]

  const buildVimCommands = (
    overrides: Partial<WorkspaceCommandDeps> = {}
  ): ReturnType<typeof buildWorkspaceCommands> =>
    buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession: vi.fn(),
      removeSession: vi.fn(),
      renameSession: vi.fn(),
      setPaneUserLabel: vi.fn(),
      renameAgentSession: vi.fn().mockResolvedValue(undefined),
      activePanePtyId: 'pty-active',
      setActiveSessionId: vi.fn(),
      notifyInfo: vi.fn(),
      keymapPreset: 'vim',
      ...overrides,
    })

  test('vim aliases are absent when keymapPreset is not vim', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession: vi.fn(),
      removeSession: vi.fn(),
      renameSession: vi.fn(),
      setPaneUserLabel: vi.fn(),
      renameAgentSession: vi.fn().mockResolvedValue(undefined),
      activePanePtyId: 'pty-active',
      setActiveSessionId: vi.fn(),
      notifyInfo: vi.fn(),
      keymapPreset: 'vimeflow',
    })

    const vimIds = [
      'vim-write',
      'vim-quit',
      'vim-quit-all',
      'vim-tabnew',
      'vim-tabclose',
      'vim-tabnext',
      'vim-tabprev',
      'vim-vsplit',
      'vim-split',
      'vim-only',
      'vim-edit',
    ]

    for (const id of vimIds) {
      expect(commands.find((c) => c.id === id)).toBeUndefined()
    }
  })

  test('vim aliases are absent when keymapPreset is undefined', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession: vi.fn(),
      removeSession: vi.fn(),
      renameSession: vi.fn(),
      setPaneUserLabel: vi.fn(),
      renameAgentSession: vi.fn().mockResolvedValue(undefined),
      activePanePtyId: 'pty-active',
      setActiveSessionId: vi.fn(),
      notifyInfo: vi.fn(),
    })

    expect(commands.some((c) => c.id.startsWith('vim-'))).toBe(false)
  })

  test(':w calls saveActiveFile', () => {
    const saveActiveFile = vi.fn()
    const commands = buildVimCommands({ saveActiveFile })

    const cmd = commands.find((c) => c.id === 'vim-write')
    expect(cmd?.label).toBe(':w')

    cmd?.execute?.('')
    expect(saveActiveFile).toHaveBeenCalledOnce()
  })

  test(':w notifies when saveActiveFile is unavailable', () => {
    const notifyInfo = vi.fn()
    const commands = buildVimCommands({ notifyInfo, saveActiveFile: undefined })

    const cmd = commands.find((c) => c.id === 'vim-write')
    cmd?.execute?.('')

    expect(notifyInfo).toHaveBeenCalledWith('No file to save')
  })

  test(':q calls closeActivePane', () => {
    const closeActivePane = vi.fn()
    const commands = buildVimCommands({ closeActivePane })

    const cmd = commands.find((c) => c.id === 'vim-quit')
    expect(cmd?.label).toBe(':q')

    cmd?.execute?.('')
    expect(closeActivePane).toHaveBeenCalledOnce()
  })

  test(':q notifies when closeActivePane is unavailable', () => {
    const notifyInfo = vi.fn()

    const commands = buildVimCommands({
      notifyInfo,
      closeActivePane: undefined,
    })

    const cmd = commands.find((c) => c.id === 'vim-quit')
    cmd?.execute?.('')

    expect(notifyInfo).toHaveBeenCalledWith('No pane to close')
  })

  test(':qa removes the active session', () => {
    const removeSession = vi.fn()
    const commands = buildVimCommands({ removeSession })

    const cmd = commands.find((c) => c.id === 'vim-quit-all')
    expect(cmd?.label).toBe(':qa')

    cmd?.execute?.('')
    expect(removeSession).toHaveBeenCalledWith('session-1')
  })

  test(':qa guards missing active session', () => {
    const notifyInfo = vi.fn()
    const removeSession = vi.fn()

    const commands = buildVimCommands({
      sessions: mockSessions,
      activeSessionId: null,
      notifyInfo,
      removeSession,
    })

    commands.find((c) => c.id === 'vim-quit-all')?.execute?.('')
    expect(notifyInfo).toHaveBeenCalledWith('No active tab to close')
    expect(removeSession).not.toHaveBeenCalled()
  })

  test(':tabnew calls createSession', () => {
    const createSession = vi.fn()
    const commands = buildVimCommands({ createSession })

    const cmd = commands.find((c) => c.id === 'vim-tabnew')
    expect(cmd?.label).toBe(':tabnew')

    cmd?.execute?.('')
    expect(createSession).toHaveBeenCalledOnce()
  })

  test(':tabclose removes the active session', () => {
    const removeSession = vi.fn()
    const commands = buildVimCommands({ removeSession })

    const cmd = commands.find((c) => c.id === 'vim-tabclose')
    expect(cmd?.label).toBe(':tabclose')

    cmd?.execute?.('')
    expect(removeSession).toHaveBeenCalledWith('session-1')
  })

  test(':tabn activates the next session (wraps)', () => {
    const setActiveSessionId = vi.fn()

    const commands = buildVimCommands({
      activeSessionId: 'session-3',
      setActiveSessionId,
    })

    const cmd = commands.find((c) => c.id === 'vim-tabnext')
    expect(cmd?.label).toBe(':tabn')

    cmd?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-1')
  })

  test(':tabn skips active tab outside the navigable set', () => {
    const setActiveSessionId = vi.fn()

    const commands = buildVimCommands({
      navigableSessions: [mockSessions[0], mockSessions[2]],
      activeSessionId: 'session-2',
      setActiveSessionId,
    })

    commands.find((c) => c.id === 'vim-tabnext')?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-1')
  })

  test(':tabp activates the previous session', () => {
    const setActiveSessionId = vi.fn()

    const commands = buildVimCommands({
      activeSessionId: 'session-2',
      setActiveSessionId,
    })

    const cmd = commands.find((c) => c.id === 'vim-tabprev')
    expect(cmd?.label).toBe(':tabp')

    cmd?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-1')
  })

  test(':vsplit sets vsplit layout', () => {
    const setActiveSessionLayout = vi.fn()
    const commands = buildVimCommands({ setActiveSessionLayout })

    const cmd = commands.find((c) => c.id === 'vim-vsplit')
    expect(cmd?.label).toBe(':vsplit')

    cmd?.execute?.('')
    expect(setActiveSessionLayout).toHaveBeenCalledWith('vsplit')
  })

  test(':split sets hsplit layout', () => {
    const setActiveSessionLayout = vi.fn()
    const commands = buildVimCommands({ setActiveSessionLayout })

    const cmd = commands.find((c) => c.id === 'vim-split')
    expect(cmd?.label).toBe(':split')

    cmd?.execute?.('')
    expect(setActiveSessionLayout).toHaveBeenCalledWith('hsplit')
  })

  test(':only sets single layout', () => {
    const setActiveSessionLayout = vi.fn()
    const commands = buildVimCommands({ setActiveSessionLayout })

    const cmd = commands.find((c) => c.id === 'vim-only')
    expect(cmd?.label).toBe(':only')

    cmd?.execute?.('')
    expect(setActiveSessionLayout).toHaveBeenCalledWith('single')
  })

  test('vim split aliases use guarded layout picker when available', () => {
    const pickLayout = vi.fn((id: string) => id !== 'hsplit')
    const setActiveSessionLayout = vi.fn()
    const notifyInfo = vi.fn()

    const commands = buildVimCommands({
      pickLayout,
      setActiveSessionLayout,
      notifyInfo,
    })

    commands.find((c) => c.id === 'vim-vsplit')?.execute?.('')
    commands.find((c) => c.id === 'vim-split')?.execute?.('')

    expect(pickLayout).toHaveBeenCalledWith('vsplit')
    expect(pickLayout).toHaveBeenCalledWith('hsplit')
    expect(setActiveSessionLayout).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith("Layout 'HSplit' needs fewer panes")
  })

  test('layout commands notify when setActiveSessionLayout is unavailable', () => {
    const notifyInfo = vi.fn()

    const commands = buildVimCommands({
      notifyInfo,
      setActiveSessionLayout: undefined,
    })

    commands.find((c) => c.id === 'vim-vsplit')?.execute?.('')
    commands.find((c) => c.id === 'vim-split')?.execute?.('')
    commands.find((c) => c.id === 'vim-only')?.execute?.('')

    expect(notifyInfo).toHaveBeenCalledTimes(3)
    expect(notifyInfo).toHaveBeenCalledWith('Layout change unavailable')
  })

  test(':edit opens the trimmed path', () => {
    const openFileInEditor = vi.fn()
    const commands = buildVimCommands({ openFileInEditor })

    const cmd = commands.find((c) => c.id === 'vim-edit')
    expect(cmd?.label).toBe(':edit')

    cmd?.execute?.('  foo.ts  ')
    expect(openFileInEditor).toHaveBeenCalledWith('foo.ts')
  })

  test(':edit notifies on missing path', () => {
    const notifyInfo = vi.fn()
    const commands = buildVimCommands({ notifyInfo })

    commands.find((c) => c.id === 'vim-edit')?.execute?.('   ')
    expect(notifyInfo).toHaveBeenCalledWith('Usage: :edit <path>')
  })

  test(':edit notifies when editor is unavailable', () => {
    const notifyInfo = vi.fn()

    const commands = buildVimCommands({
      notifyInfo,
      openFileInEditor: undefined,
    })

    commands.find((c) => c.id === 'vim-edit')?.execute?.('foo.ts')
    expect(notifyInfo).toHaveBeenCalledWith('Editor unavailable')
  })

  test.each([
    { id: 'vim-write', primary: 'w', alias: 'write' },
    { id: 'vim-tabnew', primary: 'tabnew', alias: 'tabe' },
    { id: 'vim-tabclose', primary: 'tabclose', alias: 'tabc' },
    { id: 'vim-tabnext', primary: 'tabn', alias: 'tabnext' },
    { id: 'vim-tabprev', primary: 'tabp', alias: 'tabprev' },
    { id: 'vim-vsplit', primary: 'vsplit', alias: 'vs' },
    { id: 'vim-split', primary: 'split', alias: 'sp' },
    { id: 'vim-only', primary: 'only', alias: 'on' },
    { id: 'vim-edit', primary: 'edit', alias: 'e' },
  ])(
    ':$primary and :$alias both match the command palette query',
    ({ id, primary, alias }) => {
      const commands = buildVimCommands()
      const cmd = commands.find((c) => c.id === id)
      expect(cmd).toBeDefined()
      expect(cmd?.match?.(primary)).toBeGreaterThan(0)
      expect(cmd?.match?.(alias)).toBeGreaterThan(0)
    }
  )

  test(':q and :qa do not define a custom match function', () => {
    const commands = buildVimCommands()

    expect(commands.find((c) => c.id === 'vim-quit')?.match).toBeUndefined()
    expect(commands.find((c) => c.id === 'vim-quit-all')?.match).toBeUndefined()
  })
})

const baseDeps = (): WorkspaceCommandDeps => ({
  sessions: [{ id: 'session-1', name: 'main' }],
  activeSessionId: 'session-1',
  activePanePtyId: 'pty-active',
  createSession: vi.fn(),
  removeSession: vi.fn(),
  renameSession: vi.fn(),
  setPaneUserLabel: vi.fn(),
  renameAgentSession: vi.fn().mockResolvedValue(undefined),
  setActiveSessionId: vi.fn(),
  notifyInfo: vi.fn(),
})

describe('buildWorkspaceCommands - net-new wired commands', () => {
  beforeEach(() => {
    vi.mocked(isMacPlatform).mockReturnValue(false)
  })

  test(':restart restarts the active session', () => {
    const restartSession = vi.fn()
    const commands = buildWorkspaceCommands({ ...baseDeps(), restartSession })

    const cmd = commands.find((c) => c.id === 'restart')
    expect(cmd?.label).toBe(':restart')

    cmd?.execute?.('')
    expect(restartSession).toHaveBeenCalledWith('session-1')
  })

  test(':restart with no active session notifies', () => {
    const restartSession = vi.fn()
    const notifyInfo = vi.fn()

    const commands = buildWorkspaceCommands({
      ...baseDeps(),
      activeSessionId: null,
      notifyInfo,
      restartSession,
    })

    commands.find((c) => c.id === 'restart')?.execute?.('')
    expect(restartSession).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('No active session to restart')
  })

  test(':open-editor opens the editor dock', () => {
    const openEditor = vi.fn()
    const commands = buildWorkspaceCommands({ ...baseDeps(), openEditor })

    commands.find((c) => c.id === 'open-editor')?.execute?.('')
    expect(openEditor).toHaveBeenCalledOnce()
  })

  test(':open-diff opens the diff dock', () => {
    const openDiff = vi.fn()
    const commands = buildWorkspaceCommands({ ...baseDeps(), openDiff })

    commands.find((c) => c.id === 'open-diff')?.execute?.('')
    expect(openDiff).toHaveBeenCalledOnce()
  })

  test(':toggle-dock toggles the dock', () => {
    const toggleDock = vi.fn()
    const commands = buildWorkspaceCommands({ ...baseDeps(), toggleDock })

    commands.find((c) => c.id === 'toggle-dock')?.execute?.('')
    expect(toggleDock).toHaveBeenCalledOnce()
  })

  test(':toggle-activity toggles the activity panel', () => {
    const toggleActivityPanel = vi.fn()

    const commands = buildWorkspaceCommands({
      ...baseDeps(),
      toggleActivityPanel,
    })

    commands.find((c) => c.id === 'toggle-activity')?.execute?.('')
    expect(toggleActivityPanel).toHaveBeenCalledOnce()
  })

  test(':show-sessions and :show-files select sidebar tabs', () => {
    const showSidebarTab = vi.fn()
    const commands = buildWorkspaceCommands({ ...baseDeps(), showSidebarTab })

    commands.find((c) => c.id === 'show-sessions')?.execute?.('')
    expect(showSidebarTab).toHaveBeenCalledWith('sessions')

    commands.find((c) => c.id === 'show-files')?.execute?.('')
    expect(showSidebarTab).toHaveBeenCalledWith('files')
  })

  test(':focus-terminal focuses the terminal', () => {
    const focusTerminal = vi.fn()
    const commands = buildWorkspaceCommands({ ...baseDeps(), focusTerminal })

    commands.find((c) => c.id === 'focus-terminal')?.execute?.('')
    expect(focusTerminal).toHaveBeenCalledOnce()
  })

  test(':settings is a namespace with an Open Settings entry', () => {
    const openSettings = vi.fn()
    const commands = buildWorkspaceCommands({ ...baseDeps(), openSettings })

    const settingsCmd = commands.find((c) => c.id === 'settings')
    expect(settingsCmd?.label).toBe(':settings')
    expect(settingsCmd?.children?.[0]?.id).toBe('settings-open')

    settingsCmd?.children?.[0]?.execute?.('')
    expect(openSettings).toHaveBeenCalledWith()
  })

  test(':settings lists available settings sections as children', () => {
    const openSettings = vi.fn()
    const commands = buildWorkspaceCommands({ ...baseDeps(), openSettings })

    const settingsCmd = commands.find((c) => c.id === 'settings')
    expect(settingsCmd?.children).toHaveLength(
      AVAILABLE_SETTINGS_SECTIONS.length + 1
    )

    const children = settingsCmd?.children ?? []
    for (const section of AVAILABLE_SETTINGS_SECTIONS) {
      const child = children.find((c) => c.id === `settings-${section.id}`)
      expect(child?.label).toBe(section.label)
      expect(child?.description).toContain(section.label)

      child?.execute?.('')
      expect(openSettings).toHaveBeenCalledWith(section.id)
    }

    expect(openSettings).toHaveBeenCalledTimes(
      AVAILABLE_SETTINGS_SECTIONS.length
    )
  })

  test(':settings is omitted when openSettings is absent', () => {
    const commands = buildWorkspaceCommands(baseDeps())

    expect(commands.find((c) => c.id === 'settings')).toBeUndefined()
  })

  test(':open-file opens an absolute path, preserving spaces', () => {
    const openFile = vi.fn()
    const commands = buildWorkspaceCommands({ ...baseDeps(), openFile })

    commands.find((c) => c.id === 'open-file')?.execute?.('/tmp/notes file.md')
    expect(openFile).toHaveBeenCalledWith('/tmp/notes file.md')
  })

  test(':open-file with no path notifies usage', () => {
    const openFile = vi.fn()
    const notifyInfo = vi.fn()

    const commands = buildWorkspaceCommands({
      ...baseDeps(),
      notifyInfo,
      openFile,
    })

    commands.find((c) => c.id === 'open-file')?.execute?.('   ')
    expect(openFile).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('Usage: :open-file <absolute path>')
  })

  test('net-new commands are omitted when their dep is absent', () => {
    const commands = buildWorkspaceCommands(baseDeps())

    const omitted = [
      'restart',
      'open-editor',
      'open-diff',
      'toggle-dock',
      'layout',
      'dock-position',
      'toggle-activity',
      'show-sessions',
      'show-files',
      'focus-terminal',
      'open-file',
      'settings',
    ]

    for (const id of omitted) {
      expect(commands.find((c) => c.id === id)).toBeUndefined()
    }
  })
})

describe('buildWorkspaceCommands - layout and dock-position namespaces', () => {
  test(':layout is a namespace whose children pick a layout', () => {
    const pickLayout = vi.fn(() => true)

    const commands = buildWorkspaceCommands({
      ...baseDeps(),
      pickLayout,
      availableLayouts: [
        { id: SINGLE_PANE_FOCUS_LAYOUT_ID, title: 'Single' },
        { id: 'vsplit', title: 'Vertical Split' },
      ],
    })

    const layout = commands.find((c) => c.id === 'layout')
    expect(layout?.label).toBe(':layout')
    expect(layout?.children?.map((c) => c.label)).toEqual([
      SINGLE_PANE_FOCUS_LABEL,
      'Vertical Split',
    ])

    layout?.children?.find((c) => c.id === 'layout-vsplit')?.execute?.('')
    expect(pickLayout).toHaveBeenCalledWith('vsplit')
  })

  test(':layout child notifies when the layout cannot fit the panes', () => {
    const pickLayout = vi.fn(() => false)
    const notifyInfo = vi.fn()

    const commands = buildWorkspaceCommands({
      ...baseDeps(),
      notifyInfo,
      pickLayout,
      availableLayouts: [{ id: SINGLE_PANE_FOCUS_LAYOUT_ID, title: 'Single' }],
    })

    const singleLayoutCommandId = `layout-${SINGLE_PANE_FOCUS_LAYOUT_ID}`

    commands
      .find((c) => c.id === 'layout')
      ?.children?.find((c) => c.id === singleLayoutCommandId)
      ?.execute?.('')

    expect(notifyInfo).toHaveBeenCalledWith("Layout 'Single' needs fewer panes")
  })

  test(':layout single child advertises the active-pane focus shortcut', () => {
    vi.mocked(isMacPlatform).mockReturnValue(false)

    const commands = buildWorkspaceCommands({
      ...baseDeps(),
      pickLayout: vi.fn(() => true),
      availableLayouts: [
        { id: SINGLE_PANE_FOCUS_LAYOUT_ID, title: 'Single' },
        { id: 'vsplit', title: 'Vertical Split' },
      ],
    })

    const layout = commands.find((c) => c.id === 'layout')
    const singleLayoutCommandId = `layout-${SINGLE_PANE_FOCUS_LAYOUT_ID}`

    expect(
      layout?.children?.find((c) => c.id === singleLayoutCommandId)?.shortcut
    ).toEqual(['Ctrl', 'Z'])

    expect(
      layout?.children?.find((c) => c.id === singleLayoutCommandId)?.description
    ).toBe('Toggle active-pane focus')

    expect(
      layout?.children?.find((c) => c.id === 'layout-vsplit')?.shortcut
    ).toBeUndefined()
  })

  test(':dock-position children move the dock and mark the current edge', () => {
    const setDockPosition = vi.fn()

    const commands = buildWorkspaceCommands({
      ...baseDeps(),
      setDockPosition,
      dockPosition: 'bottom',
    })

    const dock = commands.find((c) => c.id === 'dock-position')
    expect(dock?.children?.map((c) => c.id)).toEqual([
      'dock-position-bottom',
      'dock-position-top',
      'dock-position-left',
      'dock-position-right',
    ])

    const bottom = dock?.children?.find((c) => c.id === 'dock-position-bottom')
    expect(bottom?.description).toBe('Dock is at bottom')

    dock?.children?.find((c) => c.id === 'dock-position-right')?.execute?.('')
    expect(setDockPosition).toHaveBeenCalledWith('right')
  })

  test(':dock-position is omitted without setDockPosition', () => {
    const commands = buildWorkspaceCommands({
      ...baseDeps(),
      dockPosition: 'bottom',
    })

    expect(commands.find((c) => c.id === 'dock-position')).toBeUndefined()
  })
})

describe('buildWorkspaceCommands - shortcut chips', () => {
  const chipDeps = (): WorkspaceCommandDeps => ({
    ...baseDeps(),
    toggleSidebar: vi.fn(),
    openEditor: vi.fn(),
    openDiff: vi.fn(),
    toggleDock: vi.fn(),
  })

  const buildWithChips = (mac: boolean): Command[] => {
    vi.mocked(isMacPlatform).mockReturnValue(mac)

    return buildWorkspaceCommands(chipDeps())
  }

  const chip = (commands: Command[], id: string): string[] | undefined =>
    commands.find((c) => c.id === id)?.shortcut

  test('macOS chips match the wired accelerators', () => {
    const commands = buildWithChips(true)
    expect(chip(commands, 'new')).toEqual(['⌘', 'N'])
    expect(chip(commands, 'toggle-sidebar')).toEqual(['⌘', 'B'])
    expect(chip(commands, 'open-editor')).toEqual(['⌘', 'E'])
    expect(chip(commands, 'open-diff')).toEqual(['⌘', 'G'])
    expect(chip(commands, 'toggle-dock')).toEqual(['⌘', '0'])
    expect(chip(commands, 'next')).toEqual(['⌘', ']'])
    expect(chip(commands, 'previous')).toEqual(['⌘', '['])
    expect(chip(commands, 'burner')).toEqual(['⌃', '`'])
  })

  test('Linux chips match the wired accelerators', () => {
    const commands = buildWithChips(false)
    expect(chip(commands, 'new')).toEqual(['Ctrl', '⇧', 'N'])
    expect(chip(commands, 'toggle-sidebar')).toEqual(['Ctrl', '⇧', 'B'])
    expect(chip(commands, 'open-editor')).toEqual(['Ctrl', 'E'])
    expect(chip(commands, 'open-diff')).toEqual(['Ctrl', 'G'])
    expect(chip(commands, 'toggle-dock')).toEqual(['Ctrl', '0'])
    expect(chip(commands, 'next')).toEqual(['Ctrl', '⇧', ']'])
    expect(chip(commands, 'previous')).toEqual(['Ctrl', '⇧', '['])
    expect(chip(commands, 'burner')).toEqual(['Ctrl', '`'])
  })

  test('only commands with registered accelerators carry chips', () => {
    vi.mocked(isMacPlatform).mockReturnValue(true)

    const commands = buildWorkspaceCommands({
      ...chipDeps(),
      restartSession: vi.fn(),
      focusTerminal: vi.fn(),
      toggleBurner: vi.fn(),
    })

    const withChips = commands
      .filter((c) => c.shortcut !== undefined)
      .map((c) => c.id)
      .sort()

    expect(withChips).toEqual(
      [
        'new',
        'next',
        'open-diff',
        'open-editor',
        'previous',
        'burner',
        'toggle-dock',
        'toggle-sidebar',
      ].sort()
    )
  })

  test('uses resolved registry chips when supplied', () => {
    const commands = buildWorkspaceCommands({
      ...chipDeps(),
      toggleActivityPanel: vi.fn(),
      showSidebarTab: vi.fn(),
      keybindingShortcut: (id) => ['custom', id],
    })

    expect(chip(commands, 'new')).toEqual(['custom', 'new-session'])
    expect(chip(commands, 'toggle-sidebar')).toEqual([
      'custom',
      'sidebar-toggle',
    ])

    expect(chip(commands, 'toggle-activity')).toEqual([
      'custom',
      'activity-panel-toggle',
    ])

    expect(chip(commands, 'show-sessions')).toEqual([
      'custom',
      'sidebar-sessions',
    ])
  })
})
