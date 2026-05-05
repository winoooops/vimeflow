import { describe, test, expect, vi, beforeEach } from 'vitest'
import { buildWorkspaceCommands } from './buildWorkspaceCommands'
import type { Session } from '../types'

describe('buildWorkspaceCommands - happy paths', () => {
  const mockSessions: Session[] = [
    {
      id: 'session-1',
      projectId: 'proj-1',
      name: 'main',
      status: 'running',
      workingDirectory: '/home/user/project',
      agentType: 'claude-code',
      createdAt: '2024-01-01T00:00:00Z',
      lastActivityAt: '2024-01-01T00:00:00Z',
      activity: {
        fileChanges: [],
        toolCalls: [],
        testResults: [],
        contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
        usage: {
          sessionDuration: 0,
          turnCount: 0,
          messages: { sent: 0, limit: 200 },
          tokens: { input: 0, output: 0, total: 0 },
        },
      },
    },
    {
      id: 'session-2',
      projectId: 'proj-1',
      name: 'feature-branch',
      status: 'running',
      workingDirectory: '/home/user/project',
      agentType: 'claude-code',
      createdAt: '2024-01-01T01:00:00Z',
      lastActivityAt: '2024-01-01T01:00:00Z',
      activity: {
        fileChanges: [],
        toolCalls: [],
        testResults: [],
        contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
        usage: {
          sessionDuration: 0,
          turnCount: 0,
          messages: { sent: 0, limit: 200 },
          tokens: { input: 0, output: 0, total: 0 },
        },
      },
    },
    {
      id: 'session-3',
      projectId: 'proj-1',
      name: 'bugfix',
      status: 'running',
      workingDirectory: '/home/user/project',
      agentType: 'claude-code',
      createdAt: '2024-01-01T02:00:00Z',
      lastActivityAt: '2024-01-01T02:00:00Z',
      activity: {
        fileChanges: [],
        toolCalls: [],
        testResults: [],
        contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
        usage: {
          sessionDuration: 0,
          turnCount: 0,
          messages: { sent: 0, limit: 200 },
          tokens: { input: 0, output: 0, total: 0 },
        },
      },
    },
  ]

  let createSession: ReturnType<typeof vi.fn>
  let removeSession: ReturnType<typeof vi.fn>
  let renameSession: ReturnType<typeof vi.fn>
  let setActiveSessionId: ReturnType<typeof vi.fn>
  let notifyInfo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createSession = vi.fn()
    removeSession = vi.fn()
    renameSession = vi.fn()
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
      setActiveSessionId,
      notifyInfo,
    })

    const closeCmd = commands.find((c) => c.id === 'close')
    expect(closeCmd).toBeDefined()

    closeCmd?.execute?.('')
    expect(removeSession).toHaveBeenCalledWith('session-2')
  })

  test(':rename command renames active session', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    })

    const renameCmd = commands.find((c) => c.id === 'rename')
    expect(renameCmd).toBeDefined()

    renameCmd?.execute?.('new-name')
    expect(renameSession).toHaveBeenCalledWith('session-1', 'new-name')
  })

  test(':next command wraps to first session', () => {
    const commands = buildWorkspaceCommands({
      sessions: mockSessions,
      activeSessionId: 'session-3',
      createSession,
      removeSession,
      renameSession,
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
  let createSession: ReturnType<typeof vi.fn>
  let removeSession: ReturnType<typeof vi.fn>
  let renameSession: ReturnType<typeof vi.fn>
  let setActiveSessionId: ReturnType<typeof vi.fn>
  let notifyInfo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createSession = vi.fn()
    removeSession = vi.fn()
    renameSession = vi.fn()
    setActiveSessionId = vi.fn()
    notifyInfo = vi.fn()
  })

  test(':close with no active tab shows message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          projectId: 'proj-1',
          name: 'main',
          status: 'running',
          workingDirectory: '/home/user',
          agentType: 'claude-code',
          createdAt: '2024-01-01T00:00:00Z',
          lastActivityAt: '2024-01-01T00:00:00Z',
          activity: {
            fileChanges: [],
            toolCalls: [],
            testResults: [],
            contextWindow: {
              used: 0,
              total: 200000,
              percentage: 0,
              emoji: '😊',
            },
            usage: {
              sessionDuration: 0,
              turnCount: 0,
              messages: { sent: 0, limit: 200 },
              tokens: { input: 0, output: 0, total: 0 },
            },
          },
        },
      ],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
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
      setActiveSessionId,
      notifyInfo,
    })

    const renameCmd = commands.find((c) => c.id === 'rename')

    renameCmd?.execute?.('new-name')
    expect(notifyInfo).toHaveBeenCalledWith('No active tab to rename')
    expect(renameSession).not.toHaveBeenCalled()
  })

  test(':rename with whitespace-only args shows usage message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          projectId: 'proj-1',
          name: 'main',
          status: 'running',
          workingDirectory: '/home/user',
          agentType: 'claude-code',
          createdAt: '2024-01-01T00:00:00Z',
          lastActivityAt: '2024-01-01T00:00:00Z',
          activity: {
            fileChanges: [],
            toolCalls: [],
            testResults: [],
            contextWindow: {
              used: 0,
              total: 200000,
              percentage: 0,
              emoji: '😊',
            },
            usage: {
              sessionDuration: 0,
              turnCount: 0,
              messages: { sent: 0, limit: 200 },
              tokens: { input: 0, output: 0, total: 0 },
            },
          },
        },
      ],
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    })

    const renameCmd = commands.find((c) => c.id === 'rename')

    renameCmd?.execute?.('   ')
    expect(renameSession).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('Usage: :rename <name>')
  })

  test(':goto with no args shows usage message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('')
    expect(notifyInfo).toHaveBeenCalledWith('Usage: :goto <position or name>')
  })

  test(':goto with zero shows invalid position message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('0')
    expect(notifyInfo).toHaveBeenCalledWith(
      'Position must be a positive integer'
    )
  })

  test(':goto with negative shows invalid position message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('-1')
    expect(notifyInfo).toHaveBeenCalledWith(
      'Position must be a positive integer'
    )
  })

  test(':goto with decimal shows invalid position message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [],
      activeSessionId: null,
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('1.5')
    expect(notifyInfo).toHaveBeenCalledWith(
      'Position must be a positive integer'
    )
  })

  test(':goto with out-of-range position shows message', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          projectId: 'proj-1',
          name: 'main',
          status: 'running',
          workingDirectory: '/home/user',
          agentType: 'claude-code',
          createdAt: '2024-01-01T00:00:00Z',
          lastActivityAt: '2024-01-01T00:00:00Z',
          activity: {
            fileChanges: [],
            toolCalls: [],
            testResults: [],
            contextWindow: {
              used: 0,
              total: 200000,
              percentage: 0,
              emoji: '😊',
            },
            usage: {
              sessionDuration: 0,
              turnCount: 0,
              messages: { sent: 0, limit: 200 },
              tokens: { input: 0, output: 0, total: 0 },
            },
          },
        },
      ],
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
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
          projectId: 'proj-1',
          name: 'main',
          status: 'running',
          workingDirectory: '/home/user',
          agentType: 'claude-code',
          createdAt: '2024-01-01T00:00:00Z',
          lastActivityAt: '2024-01-01T00:00:00Z',
          activity: {
            fileChanges: [],
            toolCalls: [],
            testResults: [],
            contextWindow: {
              used: 0,
              total: 200000,
              percentage: 0,
              emoji: '😊',
            },
            usage: {
              sessionDuration: 0,
              turnCount: 0,
              messages: { sent: 0, limit: 200 },
              tokens: { input: 0, output: 0, total: 0 },
            },
          },
        },
      ],
      activeSessionId: 'session-1',
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    })

    const gotoCmd = commands.find((c) => c.id === 'goto')

    gotoCmd?.execute?.('nonexistent')
    expect(notifyInfo).toHaveBeenCalledWith("No tab matching 'nonexistent'")
  })

  test(':next with stale active id selects first session', () => {
    const commands = buildWorkspaceCommands({
      sessions: [
        {
          id: 'session-1',
          projectId: 'proj-1',
          name: 'main',
          status: 'running',
          workingDirectory: '/home/user',
          agentType: 'claude-code',
          createdAt: '2024-01-01T00:00:00Z',
          lastActivityAt: '2024-01-01T00:00:00Z',
          activity: {
            fileChanges: [],
            toolCalls: [],
            testResults: [],
            contextWindow: {
              used: 0,
              total: 200000,
              percentage: 0,
              emoji: '😊',
            },
            usage: {
              sessionDuration: 0,
              turnCount: 0,
              messages: { sent: 0, limit: 200 },
              tokens: { input: 0, output: 0, total: 0 },
            },
          },
        },
        {
          id: 'session-2',
          projectId: 'proj-1',
          name: 'feature',
          status: 'running',
          workingDirectory: '/home/user',
          agentType: 'claude-code',
          createdAt: '2024-01-01T01:00:00Z',
          lastActivityAt: '2024-01-01T01:00:00Z',
          activity: {
            fileChanges: [],
            toolCalls: [],
            testResults: [],
            contextWindow: {
              used: 0,
              total: 200000,
              percentage: 0,
              emoji: '😊',
            },
            usage: {
              sessionDuration: 0,
              turnCount: 0,
              messages: { sent: 0, limit: 200 },
              tokens: { input: 0, output: 0, total: 0 },
            },
          },
        },
      ],
      activeSessionId: 'stale-id',
      createSession,
      removeSession,
      renameSession,
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
          projectId: 'proj-1',
          name: 'main',
          status: 'running',
          workingDirectory: '/home/user',
          agentType: 'claude-code',
          createdAt: '2024-01-01T00:00:00Z',
          lastActivityAt: '2024-01-01T00:00:00Z',
          activity: {
            fileChanges: [],
            toolCalls: [],
            testResults: [],
            contextWindow: {
              used: 0,
              total: 200000,
              percentage: 0,
              emoji: '😊',
            },
            usage: {
              sessionDuration: 0,
              turnCount: 0,
              messages: { sent: 0, limit: 200 },
              tokens: { input: 0, output: 0, total: 0 },
            },
          },
        },
        {
          id: 'session-2',
          projectId: 'proj-1',
          name: 'feature',
          status: 'running',
          workingDirectory: '/home/user',
          agentType: 'claude-code',
          createdAt: '2024-01-01T01:00:00Z',
          lastActivityAt: '2024-01-01T01:00:00Z',
          activity: {
            fileChanges: [],
            toolCalls: [],
            testResults: [],
            contextWindow: {
              used: 0,
              total: 200000,
              percentage: 0,
              emoji: '😊',
            },
            usage: {
              sessionDuration: 0,
              turnCount: 0,
              messages: { sent: 0, limit: 200 },
              tokens: { input: 0, output: 0, total: 0 },
            },
          },
        },
      ],
      activeSessionId: 'stale-id',
      createSession,
      removeSession,
      renameSession,
      setActiveSessionId,
      notifyInfo,
    })

    const prevCmd = commands.find((c) => c.id === 'previous')

    prevCmd?.execute?.('')
    expect(setActiveSessionId).toHaveBeenCalledWith('session-2')
  })
})
