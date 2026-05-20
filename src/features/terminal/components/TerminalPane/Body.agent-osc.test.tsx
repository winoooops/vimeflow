// cspell:ignore worktree worktrees
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
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
type OscHandler = (data: string) => boolean

interface ControlledTerminalService extends ITerminalService {
  emitData(sessionId: string, data: string, offsetStart?: number): void
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
      void handler

      return {
        dispose: vi.fn(),
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

  readonly write = vi.fn((data: string, callback?: () => void): void => {
    this.parseOsc(data)
    callback?.()
  })

  private parseOsc(data: string): void {
    const oscPattern = /\x1b\](\d+);([\s\S]*?)(?:\x07|\x1b\\)/g

    for (const match of data.matchAll(oscPattern)) {
      const handler = this.oscHandlers.get(Number(match[1]))
      handler?.(match[2] ?? '')
    }
  }
}

const createService = (): ControlledTerminalService => {
  const dataCallbacks = new Set<DataCallback>()
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
    onExit: vi.fn(
      (): Promise<() => void> => Promise.resolve((): void => undefined)
    ),
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
    emitData(sessionId: string, data: string, offsetStart?: number): void {
      const offset = offsetStart ?? nextOffsets.get(sessionId) ?? 0
      const byteLen = new TextEncoder().encode(data).length
      nextOffsets.set(sessionId, offset + byteLen)

      dataCallbacks.forEach((callback) => {
        callback(sessionId, data, offset, byteLen)
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

describe('Body agent-emitted OSC 7', () => {
  beforeEach(() => {
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
