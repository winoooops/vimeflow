import { render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Body } from './Body'
import { createTerminalInstance } from './terminalInstance'
import { useTerminal, type UseTerminalReturn } from '../../hooks/useTerminal'
import type { ITerminalService } from '../../services/terminalService'
import {
  TERMINAL_FOCUS_SCOPE_ATTRIBUTE,
  TERMINAL_FOCUS_SCOPE_VALUE,
} from '../../terminalFocusScope'
import type {
  TerminalDisposable,
  TerminalInstance,
  TerminalOutputChunk,
  TerminalParserEventHandler,
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
  parserEventDisposable: TerminalDisposable
  rendererHandle: TerminalRendererHandle
  viewportReader: TerminalViewportReader
  emitCwd: (uri: string) => void
}

const createDisposable = (): TerminalDisposable => ({
  dispose: vi.fn(),
})

const createFakeTerminalInstance = (): FakeTerminalControls => {
  const element = document.createElement('div')
  const parserEventHandlers = new Set<TerminalParserEventHandler>()
  let subscribedParserEventHandler: TerminalParserEventHandler | null = null

  const parserEventDisposable: TerminalDisposable = {
    dispose: vi.fn((): void => {
      if (subscribedParserEventHandler === null) {
        return
      }

      parserEventHandlers.delete(subscribedParserEventHandler)
      subscribedParserEventHandler = null
    }),
  }

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
    onEvent: vi.fn(
      (handler: TerminalParserEventHandler): TerminalDisposable => {
        parserEventHandlers.add(handler)
        subscribedParserEventHandler = handler

        return parserEventDisposable
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
    output: {
      writeOutput: vi.fn(
        (chunk: TerminalOutputChunk, callback?: () => void): void => {
          terminal.write(chunk.text, callback)
        }
      ),
    },
    parser,
    viewportReader,
    fitController: { fit: vi.fn((): void => undefined) },
    attachRenderer: vi.fn((): TerminalRendererHandle => rendererHandle),
  }

  return {
    instance,
    terminal,
    parser,
    parserEventDisposable,
    rendererHandle,
    viewportReader,
    emitCwd: (uri): void => {
      parserEventHandlers.forEach((handler) => {
        handler({
          type: 'cwd',
          source: 'osc7',
          uri,
          output: { offsetStart: 0, byteLen: uri.length, phase: 'live' },
        })
      })
    },
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
    scrollPty: vi.fn().mockResolvedValue(undefined),
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

  vi.mocked(createTerminalInstance).mockResolvedValue(fake.instance)
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
  expect(fake.parser.onEvent).toHaveBeenCalledWith(expect.any(Function))

  expect(useTerminal).toHaveBeenCalledWith(
    expect.objectContaining({ terminal: fake.terminal })
  )

  expect(screen.getByTestId('terminal-pane')).toHaveAttribute(
    TERMINAL_FOCUS_SCOPE_ATTRIBUTE,
    TERMINAL_FOCUS_SCOPE_VALUE
  )

  fake.emitCwd('file://localhost/tmp/fake-project')
  expect(onCwdChange).toHaveBeenCalledWith('/tmp/fake-project')

  unmount()

  expect(fake.parserEventDisposable.dispose).toHaveBeenCalledOnce()
  expect(fake.rendererHandle.dispose).toHaveBeenCalledOnce()
  expect(fake.terminal.dispose).toHaveBeenCalledOnce()
})
