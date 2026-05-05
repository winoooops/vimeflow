import { describe, test, expect, vi, beforeEach } from 'vitest'
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
  const mockSessions: WorkspaceTab[] = [
    { id: 'session-1', name: 'main' },
    { id: 'session-2', name: 'feature-branch' },
    { id: 'session-3', name: 'bugfix' },
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
          name: 'main',
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
      setActiveSessionId,
      notifyInfo,
    })

    const prevCmd = commands.find((c) => c.id === 'previous')

    prevCmd?.execute?.('')
    expect(notifyInfo).toHaveBeenCalledWith('No open sessions')
    expect(setActiveSessionId).not.toHaveBeenCalled()
  })
})
