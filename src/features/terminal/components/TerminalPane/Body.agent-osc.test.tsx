// cspell:ignore worktree worktrees
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { type ReactElement, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { Body, clearTerminalCache } from './Body'
import type { RestoreData } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(),
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(),
}))

vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: vi.fn(),
}))

type DataCallback = Parameters<ITerminalService['onData']>[0]
type ExitCallback = Parameters<ITerminalService['onExit']>[0]
type OscHandler = (data: string) => boolean

let deferWriteCallbacks = false
let skipOscParsing = false
const pendingWriteCallbacks: (() => void)[] = []

interface ControlledTerminalService extends ITerminalService {
  emitData(sessionId: string, data: string, offsetStart?: number): void
  emitExit(sessionId: string, code?: number | null): void
}

const flushPendingWriteCallbacks = (): void => {
  const callbacks = pendingWriteCallbacks.splice(0)

  callbacks.forEach((callback) => {
    callback()
  })
}

class FakeTerminal {
  readonly cols = 80
  readonly rows = 24
  readonly open = vi.fn()
  readonly loadAddon = vi.fn()
  readonly dispose = vi.fn()
  readonly focus = vi.fn()
  readonly clear = vi.fn()
  readonly onResize = vi.fn((): { dispose: () => void } => ({
    dispose: vi.fn(),
  }))
  readonly onData = vi.fn(
    (handler: (data: string) => void): { dispose: () => void } => {
      this.inputHandlers.add(handler)

      return {
        dispose: vi.fn(() => {
          this.inputHandlers.delete(handler)
        }),
      }
    }
  )
  readonly parser = {
    registerOscHandler: vi.fn(
      (identifier: number, handler: OscHandler): { dispose: () => void } => {
        this.oscHandlers.set(identifier, handler)

        return { dispose: vi.fn() }
      }
    ),
  }

  private readonly oscHandlers = new Map<number, OscHandler>()
  private readonly inputHandlers = new Set<(data: string) => void>()
  private oscBuffer = ''

  readonly write = vi.fn((data: string, callback?: () => void): void => {
    this.parseOsc(data)
    if (deferWriteCallbacks && callback) {
      pendingWriteCallbacks.push(callback)

      return
    }

    callback?.()
  })

  emitInput(data: string): void {
    this.inputHandlers.forEach((handler) => {
      handler(data)
    })
  }

  private parseOsc(data: string): void {
    if (skipOscParsing) {
      return
    }

    this.oscBuffer += data
    const oscPattern = /\x1b\](\d+);([\s\S]*?)(?:\x07|\x1b\\)/g
    let lastMatchEnd = 0

    for (const match of this.oscBuffer.matchAll(oscPattern)) {
      const handler = this.oscHandlers.get(Number(match[1]))
      handler?.(match[2] ?? '')
      lastMatchEnd = (match.index ?? 0) + match[0].length
    }

    const remaining = this.oscBuffer.slice(lastMatchEnd)
    const partialOscStart = remaining.lastIndexOf('\x1b]')
    this.oscBuffer =
      partialOscStart === -1 ? '' : remaining.slice(partialOscStart)
  }
}

const createService = (): ControlledTerminalService => {
  const dataCallbacks = new Set<DataCallback>()
  const exitCallbacks = new Set<ExitCallback>()
  const nextOffsets = new Map<string, number>()

  return {
    spawn: vi.fn().mockResolvedValue({
      sessionId: 'spawned-pty',
      pid: 999,
      cwd: '/old',
    }),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn((callback: DataCallback): Promise<() => void> => {
      dataCallbacks.add(callback)

      return Promise.resolve((): void => {
        dataCallbacks.delete(callback)
      })
    }),
    onExit: vi.fn((callback: ExitCallback): Promise<() => void> => {
      exitCallbacks.add(callback)

      return Promise.resolve((): void => {
        exitCallbacks.delete(callback)
      })
    }),
    onError: vi.fn(
      (): Promise<() => void> => Promise.resolve((): void => undefined)
    ),
    listSessions: vi.fn().mockResolvedValue({
      activeSessionId: null,
      sessions: [],
    }),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    reorderSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionCwd: vi.fn().mockResolvedValue(undefined),
    setSessionActivityPanelCollapsed: vi.fn().mockResolvedValue(undefined),
    setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
    emitData(sessionId: string, data: string, offsetStart?: number): void {
      const offset = offsetStart ?? nextOffsets.get(sessionId) ?? 0
      const byteLen = new TextEncoder().encode(data).length
      nextOffsets.set(sessionId, offset + byteLen)

      dataCallbacks.forEach((callback) => {
        callback(sessionId, data, offset, byteLen)
      })
    },
    emitExit(sessionId: string, code: number | null = 0): void {
      exitCallbacks.forEach((callback) => {
        callback(sessionId, code)
      })
    },
  }
}

const restoreData = (sessionId: string, cwd: string): RestoreData => ({
  sessionId,
  cwd,
  pid: 123,
  replayData: '',
  replayEndOffset: 0,
  bufferedEvents: [],
})

const bufferedEvent = (
  data: string,
  offsetStart = 0
): RestoreData['bufferedEvents'][number] => ({
  data,
  offsetStart,
  byteLen: new TextEncoder().encode(data).length,
})

const getLatestTerminal = (): FakeTerminal => {
  const results = vi.mocked(Terminal).mock.results
  const terminal = results[results.length - 1]?.value

  if (!terminal) {
    throw new Error('Expected terminal to be created')
  }

  return terminal as FakeTerminal
}

const StatefulBody = ({
  initialCwd,
  service,
  onCwdChange,
}: {
  initialCwd: string
  service: ITerminalService
  onCwdChange: (cwd: string) => void
}): ReactElement => {
  const [cwd, setCwd] = useState(initialCwd)

  return (
    <Body
      sessionId="pty-agent"
      cwd={cwd}
      service={service}
      restoredFrom={restoreData('pty-agent', initialCwd)}
      mode="attach"
      onCwdChange={(nextCwd): void => {
        setCwd(nextCwd)
        onCwdChange(nextCwd)
      }}
    />
  )
}

describe('Body agent-emitted OSC 7', () => {
  beforeEach(() => {
    deferWriteCallbacks = false
    skipOscParsing = false
    pendingWriteCallbacks.length = 0
    vi.mocked(Terminal).mockImplementation(() => new FakeTerminal() as never)
    vi.mocked(FitAddon).mockImplementation(
      () =>
        ({
          fit: vi.fn(),
        }) as never
    )

    vi.mocked(WebglAddon).mockImplementation(() => {
      throw new Error('WebGL unavailable in this test')
    })

    vi.mocked(CanvasAddon).mockImplementation(
      () =>
        ({
          dispose: vi.fn(),
        }) as never
    )
  })

  afterEach(() => {
    deferWriteCallbacks = false
    skipOscParsing = false
    pendingWriteCallbacks.length = 0
    vi.clearAllMocks()
    clearTerminalCache()
  })

  test('updates cwd when OSC 7 arrives through PTY output', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'agent switched worktree\r\n\x1b]7;file://host/tmp/worktree\x07'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('updates cwd when Claude EnterWorktree output arrives through PTY output', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        '● Entering worktree(/home/will/projects/vimeflow/.claude/worktrees/dummy)\r\n' +
          '  ⎿  Switched to worktree on branch dummy\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith(
        '/home/will/projects/vimeflow/.claude/worktrees/dummy'
      )
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('reassembles split Claude EnterWorktree output before updating cwd', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData('pty-agent', '● Entering worktree(/tmp/')
      service.emitData('pty-agent', 'dummy)\r\n')
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/dummy')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('ignores cwd hints overwritten by carriage-return progress output', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'Entering worktree(/tmp/fake)\rprogress 50%\n'
      )
    })

    expect(onCwdChange).not.toHaveBeenCalled()
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('tracks Claude Bash cd commands across worktree-relative paths', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/home/will/projects/vimeflow"
        service={service}
        restoredFrom={restoreData('pty-agent', '/home/will/projects/vimeflow')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        '! cd .claude/worktrees/\r\n' + '(Bash completed with no output)\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith(
        '/home/will/projects/vimeflow/.claude/worktrees'
      )
    })

    act(() => {
      service.emitData(
        'pty-agent',
        '! cd codex-agent-osc7-cwd\r\n' + '(Bash completed with no output)\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith(
        '/home/will/projects/vimeflow/.claude/worktrees/codex-agent-osc7-cwd'
      )
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('uses Claude startup cwd before tracking worktree-relative cd commands', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/home/will"
        service={service}
        restoredFrom={restoreData('pty-agent', '/home/will')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'Claude Code v2.1.145\r\n' +
          'Opus 4.7 with max effort\r\n' +
          '~/projects/vimeflow\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/home/will/projects/vimeflow')
    })

    act(() => {
      service.emitData(
        'pty-agent',
        '! cd .claude/worktrees/\r\n' + '(Bash completed with no output)\r\n'
      )

      service.emitData(
        'pty-agent',
        '! cd codex-agent-osc7-cwd\r\n' + '(Bash completed with no output)\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith(
        '/home/will/projects/vimeflow/.claude/worktrees/codex-agent-osc7-cwd'
      )
    })

    expect(onCwdChange).not.toHaveBeenCalledWith(
      '/home/will/.claude/worktrees/codex-agent-osc7-cwd'
    )
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('detects worktree anchor + path when they arrive in separate PTY chunks', async () => {
    // Regression: in real-world `EnterWorktree` runs the agent prints the
    // anchor line ("Switched to worktree on branch X") in one PTY chunk
    // and the absolute path on a following chunk. The cwd-hint context
    // buffer must preserve the anchor so the path's chunk can complete
    // the match.
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/home/will/projects/vimeflow-agent-cwd-regression"
        service={service}
        restoredFrom={restoreData(
          'pty-agent',
          '/home/will/projects/vimeflow-agent-cwd-regression'
        )}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'Creating worktree(dummy)\r\n' +
          '  Switched to worktree on branch worktree-dummy\r\n'
      )
    })

    expect(onCwdChange).not.toHaveBeenCalled()

    act(() => {
      service.emitData(
        'pty-agent',
        '    /home/will/projects/vimeflow/.claude/worktrees/dummy\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith(
        '/home/will/projects/vimeflow/.claude/worktrees/dummy'
      )
    })
  })

  test('preserves Claude startup context across PTY chunk boundaries', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/home/will"
        service={service}
        restoredFrom={restoreData('pty-agent', '/home/will')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData('pty-agent', 'Claude Code v2.1.145\r\n')
    })

    expect(onCwdChange).not.toHaveBeenCalled()

    act(() => {
      service.emitData(
        'pty-agent',
        'Opus 4.7 with max effort\r\n' + '~/projects/vimeflow\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/home/will/projects/vimeflow')
    })

    act(() => {
      service.emitData('pty-agent', '! cd .claude/worktrees/\r\n')
      service.emitData('pty-agent', '! cd codex-agent-osc7-cwd\r\n')
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith(
        '/home/will/projects/vimeflow/.claude/worktrees/codex-agent-osc7-cwd'
      )
    })

    expect(onCwdChange).not.toHaveBeenCalledWith(
      '/home/will/projects/vimeflow/.claude/worktrees/.claude/worktrees/codex-agent-osc7-cwd'
    )
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('resolves agent cd hints against a preceding OSC 7 cwd update', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/tmp/worktree\x07! cd child\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree/child')
    })

    expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree')
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('does not roll back an agent-advanced cwd when the parent commits an earlier cwd', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    const { rerender } = render(
      <Body
        sessionId="pty-agent"
        cwd="/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/tmp/worktree\x07! cd child\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree/child')
    })

    rerender(
      <Body
        sessionId="pty-agent"
        cwd="/tmp/worktree"
        service={service}
        restoredFrom={restoreData('pty-agent', '/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    act(() => {
      service.emitData('pty-agent', '! cd grandchild\r\n')
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree/child/grandchild')
    })

    expect(onCwdChange).not.toHaveBeenCalledWith('/tmp/worktree/grandchild')
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('does not roll back an agent-advanced cwd when shell OSC 7 reports an ancestor cwd', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/repo"
        service={service}
        restoredFrom={restoreData('pty-agent', '/repo')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'Entering worktree(/repo/.claude/worktrees/feat)\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/.claude/worktrees/feat')
    })

    onCwdChange.mockClear()

    act(() => {
      service.emitData('pty-agent', '\x1b]7;file://host/repo\x07')
    })

    expect(onCwdChange).not.toHaveBeenCalled()
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('does not roll back an agent-advanced cwd when shell OSC 7 reports a sibling worktree', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/repo/.claude/worktrees/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/repo/.claude/worktrees/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'Entering worktree(/repo/.claude/worktrees/feat)\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/.claude/worktrees/feat')
    })

    onCwdChange.mockClear()

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/repo/.claude/worktrees/old\x07'
      )
    })

    expect(onCwdChange).not.toHaveBeenCalled()
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('accepts sibling OSC 7 outside the Claude worktree directory', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/app"
        service={service}
        restoredFrom={restoreData('pty-agent', '/app')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'Entering worktree(/app/worktrees/service-a)\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/app/worktrees/service-a')
    })

    onCwdChange.mockClear()

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/app/worktrees/service-b\x07'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/app/worktrees/service-b')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('accepts sibling worktree OSC 7 after user shell input', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/repo/.claude/worktrees/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/repo/.claude/worktrees/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
      expect(getLatestTerminal().onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'Entering worktree(/repo/.claude/worktrees/feat)\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/.claude/worktrees/feat')
    })

    onCwdChange.mockClear()

    act(() => {
      getLatestTerminal().emitInput('cd /repo/.claude/worktrees/old\r')
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/repo/.claude/worktrees/old\x07'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/.claude/worktrees/old')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('does not treat a no-op text hint as agent-owned before shell OSC 7 arrives', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/repo/.claude/worktrees/feat"
        service={service}
        restoredFrom={restoreData('pty-agent', '/repo/.claude/worktrees/feat')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'Entering worktree(/repo/.claude/worktrees/feat)\r\n'
      )
    })

    expect(onCwdChange).not.toHaveBeenCalled()

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/repo/.claude/worktrees/old\x07'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/.claude/worktrees/old')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('accepts sibling worktree OSC 7 after the shell confirms the current cwd', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/repo/.claude/worktrees/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/repo/.claude/worktrees/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        'Entering worktree(/repo/.claude/worktrees/feat)\r\n'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/.claude/worktrees/feat')
    })

    onCwdChange.mockClear()

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/repo/.claude/worktrees/feat\x07'
      )

      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/repo/.claude/worktrees/old\x07'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/.claude/worktrees/old')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('ignores OSC 7 updates for the current cwd', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/tmp/worktree"
        service={service}
        restoredFrom={restoreData('pty-agent', '/tmp/worktree')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData('pty-agent', '\x1b]7;file://host/tmp/worktree\x07')
    })

    expect(onCwdChange).not.toHaveBeenCalled()
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('ignores OSC 7 updates replayed from restored terminal history', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    const replayData =
      '\x1b]7;file://host/repo/old\x07' +
      'historical output\r\n' +
      '\x1b]7;file://host/repo/intermediate\x07'
    const replayEndOffset = new TextEncoder().encode(replayData).length

    render(
      <Body
        sessionId="pty-agent"
        cwd="/repo/current"
        service={service}
        restoredFrom={{
          ...restoreData('pty-agent', '/repo/current'),
          replayData,
          replayEndOffset,
        }}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    expect(onCwdChange).not.toHaveBeenCalled()

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/repo/live\x07',
        replayEndOffset
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/live')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('ignores OSC 7 updates split across restored buffered events', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    const replayData = '\x1b]7;file://host/repo/buffered'
    const bufferedData = '\x07'
    const replayEndOffset = new TextEncoder().encode(replayData).length

    const bufferedEndOffset =
      replayEndOffset + new TextEncoder().encode(bufferedData).length

    render(
      <Body
        sessionId="pty-agent"
        cwd="/repo/current"
        service={service}
        restoredFrom={{
          ...restoreData('pty-agent', '/repo/current'),
          replayData,
          replayEndOffset,
          bufferedEvents: [bufferedEvent(bufferedData, replayEndOffset)],
        }}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    expect(onCwdChange).not.toHaveBeenCalled()

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/repo/live\x07',
        bufferedEndOffset
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/live')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('clears restore OSC 7 suppression after restore writes finish without parser events', async () => {
    skipOscParsing = true

    const service = createService()
    const onCwdChange = vi.fn()
    const replayData = '\x1b]7;file://host/repo/restored\x07'
    const replayEndOffset = new TextEncoder().encode(replayData).length

    render(
      <Body
        sessionId="pty-old"
        cwd="/repo/old"
        service={service}
        restoredFrom={{
          ...restoreData('pty-old', '/repo/old'),
          replayData,
          replayEndOffset,
        }}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    skipOscParsing = false

    act(() => {
      getLatestTerminal().write('\x1b]7;file://host/repo/live\x07')
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/repo/live')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('normalizes OSC 7 cwd paths before comparing repeated updates', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/tmp/foo/../worktree\x07'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree')
    })

    onCwdChange.mockClear()

    act(() => {
      service.emitData('pty-agent', '\x1b]7;file://host/tmp/worktree\x07')
    })

    expect(onCwdChange).not.toHaveBeenCalled()
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('clears partial text-hint buffers when OSC 7 moves to another cwd', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/old"
        service={service}
        restoredFrom={restoreData('pty-agent', '/old')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData('pty-agent', '! cd stale')
    })

    act(() => {
      service.emitData('pty-agent', '\x1b]7;file://host/tmp/worktree\x07\r\n')
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree')
    })

    expect(onCwdChange).not.toHaveBeenCalledWith('/tmp/worktree/stale')
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('clears a partial agent cd hint when cwd prop changes to an unrelated path', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    const { rerender } = render(
      <Body
        sessionId="pty-agent"
        cwd="/tmp/worktree"
        service={service}
        restoredFrom={restoreData('pty-agent', '/tmp/worktree')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData('pty-agent', '! cd child')
    })

    rerender(
      <Body
        sessionId="pty-agent"
        cwd="/unrelated"
        service={service}
        restoredFrom={restoreData('pty-agent', '/tmp/worktree')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    act(() => {
      service.emitData('pty-agent', '\r\n')
    })

    expect(onCwdChange).not.toHaveBeenCalledWith('/unrelated/child')
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('clears a partial agent cd hint when cwd prop becomes empty', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    const { rerender } = render(
      <Body
        sessionId="pty-agent"
        cwd="/tmp/worktree"
        service={service}
        restoredFrom={restoreData('pty-agent', '/tmp/worktree')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData('pty-agent', '! cd child')
    })

    rerender(
      <Body
        sessionId="pty-agent"
        cwd=""
        service={service}
        restoredFrom={restoreData('pty-agent', '/tmp/worktree')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    act(() => {
      service.emitData('pty-agent', '\r\n')
    })

    expect(onCwdChange).not.toHaveBeenCalledWith('/tmp/worktree/child')
    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('preserves a split agent cd hint across an OSC cwd prop update', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <StatefulBody
        initialCwd="/old"
        service={service}
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
    })

    act(() => {
      service.emitData(
        'pty-agent',
        '\x1b]7;file://host/tmp/worktree\x07! cd child'
      )
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree')
    })

    act(() => {
      service.emitData('pty-agent', '\r\n')
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree/child')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('flushes a buffered cwd hint when the PTY exits without a newline', async () => {
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/tmp/worktree"
        service={service}
        restoredFrom={restoreData('pty-agent', '/tmp/worktree')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
      expect(service.onExit).toHaveBeenCalled()
    })

    act(() => {
      service.emitData('pty-agent', '! cd child')
    })

    expect(onCwdChange).not.toHaveBeenCalled()

    act(() => {
      service.emitExit('pty-agent')
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree/child')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('flushes a late write callback cwd hint after PTY exit', async () => {
    deferWriteCallbacks = true
    const service = createService()
    const onCwdChange = vi.fn()

    render(
      <Body
        sessionId="pty-agent"
        cwd="/tmp/worktree"
        service={service}
        restoredFrom={restoreData('pty-agent', '/tmp/worktree')}
        mode="attach"
        onCwdChange={onCwdChange}
      />
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalled()
      expect(service.onExit).toHaveBeenCalled()
    })

    act(() => {
      service.emitData('pty-agent', '! cd child')
    })

    act(() => {
      service.emitExit('pty-agent')
    })

    expect(onCwdChange).not.toHaveBeenCalled()

    act(() => {
      flushPendingWriteCallbacks()
    })

    await waitFor(() => {
      expect(onCwdChange).toHaveBeenCalledWith('/tmp/worktree/child')
    })

    expect(service.updateSessionCwd).not.toHaveBeenCalled()
  })

  test('keeps agent OSC 7 updates isolated to the receiving pane', async () => {
    const service = createService()
    const onFirstCwdChange = vi.fn()
    const onSecondCwdChange = vi.fn()

    render(
      <>
        <Body
          sessionId="pty-a"
          cwd="/old/a"
          service={service}
          restoredFrom={restoreData('pty-a', '/old/a')}
          mode="attach"
          onCwdChange={onFirstCwdChange}
        />
        <Body
          sessionId="pty-b"
          cwd="/old/b"
          service={service}
          restoredFrom={restoreData('pty-b', '/old/b')}
          mode="attach"
          onCwdChange={onSecondCwdChange}
        />
      </>
    )

    await waitFor(() => {
      expect(service.onData).toHaveBeenCalledTimes(2)
    })

    act(() => {
      service.emitData('pty-b', '\x1b]7;file://host/tmp/second-worktree\x07')
    })

    await waitFor(() => {
      expect(onSecondCwdChange).toHaveBeenCalledWith('/tmp/second-worktree')
    })

    expect(onFirstCwdChange).not.toHaveBeenCalled()
  })
})
