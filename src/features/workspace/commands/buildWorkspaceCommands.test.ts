import { describe, test, expect, vi, beforeEach } from 'vitest'
import { AgentRenameError } from '../../../lib/backend'
import {
  buildWorkspaceCommands,
  type WorkspaceTab,
} from './buildWorkspaceCommands'

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
    createSession = vi.fn()
    removeSession = vi.fn()
    renameSession = vi.fn()
    setPaneUserLabel = vi.fn()
    renameAgentSession = vi.fn().mockResolvedValue(undefined)
    setActiveSessionId = vi.fn()
    notifyInfo = vi.fn()
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

  test(':rename-pane keeps a browser-pane label after the NoLiveAgent sync failure', async () => {
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
      activePanePtyId: 'browser:p1',
      activePaneAgentType: 'generic',
      setActiveSessionId,
      notifyInfo,
    })

    commands.find((c) => c.id === 'rename-pane')?.execute?.('web-tab')

    expect(setPaneUserLabel).toHaveBeenCalledWith('browser:p1', 'web-tab')

    await Promise.resolve()
    await Promise.resolve()

    // NoLiveAgent is suppressed for non-agent panes: label kept, no rollback.
    expect(setPaneUserLabel).toHaveBeenCalledTimes(1)
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

  test(':split-horizontal stub shows not-implemented message', () => {
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

    const splitHCmd = commands.find((c) => c.id === 'split-horizontal')
    expect(splitHCmd).toBeDefined()

    splitHCmd?.execute?.('')
    expect(notifyInfo).toHaveBeenCalledWith('Split panes not yet implemented')
  })

  test(':split-vertical stub shows not-implemented message', () => {
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

    const splitVCmd = commands.find((c) => c.id === 'split-vertical')
    expect(splitVCmd).toBeDefined()

    splitVCmd?.execute?.('')
    expect(notifyInfo).toHaveBeenCalledWith('Split panes not yet implemented')
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
