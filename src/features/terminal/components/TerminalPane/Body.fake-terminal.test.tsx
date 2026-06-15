import { render, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Body } from './Body'
import { createTerminalInstance } from './terminalInstance'
import { useTerminal, type UseTerminalReturn } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import type {
  TerminalDisposable,
  TerminalInstance,
  TerminalParser,
  TerminalRendererHandle,
  TerminalSurface,
  TerminalViewportReader,
} from '../../types'

vi.mock('./terminalInstance', () => ({
  createTerminalInstance: vi.fn(),
}))

vi.mock('../../hooks/useTerminal', () => ({
  useTerminal: vi.fn(),
}))

interface FakeTerminalControls {
  instance: TerminalInstance
  terminal: TerminalSurface
  parser: TerminalParser
  rendererHandle: TerminalRendererHandle
  viewportReader: TerminalViewportReader
  emitOsc: (identifier: number, data: string) => boolean | undefined
}

const createDisposable = (): TerminalDisposable => ({
  dispose: vi.fn(),
})

const createFakeTerminalInstance = (): FakeTerminalControls => {
  const element = document.createElement('div')
  const oscHandlers = new Map<number, (data: string) => boolean>()

  const terminal: TerminalSurface = {
    cols: 120,
    rows: 40,
    element,
    open: vi.fn((): void => undefined),
    focus: vi.fn((): void => undefined),
    dispose: vi.fn((): void => undefined),
    clear: vi.fn((): void => undefined),
    write: vi.fn((data: string, callback?: () => void): void => {
      void data
      callback?.()
    }),
    refresh: vi.fn((): void => undefined),
    onData: vi.fn((): TerminalDisposable => createDisposable()),
    onResize: vi.fn((): TerminalDisposable => createDisposable()),
    hasSelection: vi.fn((): boolean => false),
    getSelection: vi.fn((): string => ''),
    paste: vi.fn((): void => undefined),
    selectAll: vi.fn((): void => undefined),
    onSelectionChange: vi.fn((): TerminalDisposable => createDisposable()),
    attachKeyEventHandler: vi.fn((): void => undefined),
    applyTheme: vi.fn((): void => undefined),
  }

  const parser: TerminalParser = {
    registerOscHandler: vi.fn(
      (
        identifier: number,
        handler: (data: string) => boolean
      ): TerminalDisposable => {
        oscHandlers.set(identifier, handler)

        return createDisposable()
      }
    ),
  }

  const viewportReader: TerminalViewportReader = {
    readVisibleText: vi.fn((): string => 'fake visible text'),
  }

  const rendererHandle: TerminalRendererHandle = {
    dispose: vi.fn((): void => undefined),
  }

  const instance: TerminalInstance = {
    terminal,
    parser,
    viewportReader,
    fitController: { fit: vi.fn((): void => undefined) },
    attachRenderer: vi.fn((): TerminalRendererHandle => rendererHandle),
  }

  return {
    instance,
    terminal,
    parser,
    rendererHandle,
    viewportReader,
    emitOsc: (identifier, data): boolean | undefined =>
      oscHandlers.get(identifier)?.(data),
  }
}

const createService = (): ITerminalService =>
  ({
    spawn: vi.fn().mockResolvedValue({ sessionId: 'pty-1', pid: 1 }),
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn(
      (): Promise<() => void> => Promise.resolve((): void => undefined)
    ),
    onExit: vi.fn(
      (): Promise<() => void> => Promise.resolve((): void => undefined)
    ),
    onError: vi.fn(
      (): Promise<() => void> => Promise.resolve((): void => undefined)
    ),
    onBurnerForeground: vi.fn(
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
    killEphemeralPtys: vi.fn().mockResolvedValue([]),
    setWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
  }) as ITerminalService

test('Body can run against a non-xterm TerminalInstance contract', async () => {
  const fake = createFakeTerminalInstance()
  const onCwdChange = vi.fn()

  const useTerminalReturn: UseTerminalReturn = {
    session: null,
    status: 'idle',
    error: null,
    resize: vi.fn(),
  }

  vi.mocked(createTerminalInstance).mockReturnValue(fake.instance)
  vi.mocked(useTerminal).mockReturnValue(useTerminalReturn)

  const { unmount } = render(
    <Body
      sessionId="fake-session"
      cwd="/home/user"
      service={createService()}
      onCwdChange={onCwdChange}
    />
  )

  await waitFor(() => {
    expect(fake.terminal.open).toHaveBeenCalledWith(expect.any(HTMLElement))
  })

  expect(fake.instance.attachRenderer).toHaveBeenCalledOnce()
  expect(fake.parser.registerOscHandler).toHaveBeenCalledWith(
    7,
    expect.any(Function)
  )

  expect(useTerminal).toHaveBeenCalledWith(
    expect.objectContaining({ terminal: fake.terminal })
  )

  expect(fake.emitOsc(7, 'file://localhost/tmp/fake-project')).toBe(true)
  expect(onCwdChange).toHaveBeenCalledWith('/tmp/fake-project')

  unmount()

  expect(fake.rendererHandle.dispose).toHaveBeenCalledOnce()
  expect(fake.terminal.dispose).toHaveBeenCalledOnce()
})
