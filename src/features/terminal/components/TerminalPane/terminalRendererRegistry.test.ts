import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalInstance, TerminalRendererAdapter } from '../../types'
import {
  _resetTerminalRendererRegistryForTest,
  configureTerminalRendererFromEnvironment,
  createConfiguredTerminalInstance,
  getTerminalRendererAdapter,
  registerTerminalRendererAdapter,
  setTerminalRendererAdapter,
} from './terminalRendererRegistry'
import { plainTextTerminalRenderer } from './plainTextInstance'
import { xtermTerminalRenderer } from './xtermInstance'

const xtermRendererMocks = vi.hoisted(() => ({
  createInstance: vi.fn(),
}))

const plainTextRendererMocks = vi.hoisted(() => ({
  createInstance: vi.fn(),
}))

vi.mock('./plainTextInstance', () => ({
  plainTextTerminalRenderer: {
    id: 'plain-text',
    createInstance: plainTextRendererMocks.createInstance,
  },
}))

vi.mock('./xtermInstance', () => ({
  xtermTerminalRenderer: {
    id: 'xterm',
    createInstance: xtermRendererMocks.createInstance,
  },
}))

const createTerminalInstance = (): TerminalInstance => ({
  terminal: {
    cols: 80,
    rows: 24,
    element: undefined,
    open: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
    write: vi.fn(),
    refresh: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    hasSelection: vi.fn((): boolean => false),
    getSelection: vi.fn((): string => ''),
    paste: vi.fn(),
    selectAll: vi.fn(),
    onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
    attachKeyEventHandler: vi.fn(),
    applyTheme: vi.fn(),
  },
  parser: {
    registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })),
  },
  viewportReader: {
    readVisibleText: vi.fn((): string => ''),
  },
  fitController: {
    fit: vi.fn(),
  },
  attachRenderer: vi.fn(() => ({ dispose: vi.fn() })),
})

const createTerminalRendererAdapter = (
  id: string,
  instance: TerminalInstance
): TerminalRendererAdapter => ({
  id,
  createInstance: vi.fn((): TerminalInstance => instance),
})

describe('terminalRendererRegistry', () => {
  afterEach(() => {
    _resetTerminalRendererRegistryForTest()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  test('uses the xterm renderer adapter by default', () => {
    const instance = createTerminalInstance()
    xtermRendererMocks.createInstance.mockReturnValue(instance)

    expect(getTerminalRendererAdapter()).toBe(xtermTerminalRenderer)
    expect(createConfiguredTerminalInstance()).toBe(instance)
    expect(xtermRendererMocks.createInstance).toHaveBeenCalledOnce()
  })

  test('creates instances through a registered non-xterm renderer adapter', () => {
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter('custom', instance)

    registerTerminalRendererAdapter(customRenderer)
    setTerminalRendererAdapter('custom')

    expect(getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'custom' })
    )
    expect(createConfiguredTerminalInstance()).toBe(instance)
    expect(customRenderer.createInstance).toHaveBeenCalledOnce()
    expect(xtermRendererMocks.createInstance).not.toHaveBeenCalled()
  })

  test('creates instances through the renderer selected by environment', () => {
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter('custom', instance)

    registerTerminalRendererAdapter(customRenderer)
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'custom')

    expect(getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'custom' })
    )
    expect(createConfiguredTerminalInstance()).toBe(instance)
    expect(customRenderer.createInstance).toHaveBeenCalledOnce()
    expect(xtermRendererMocks.createInstance).not.toHaveBeenCalled()
  })

  test('creates instances through the bundled plain-text renderer when selected', () => {
    const instance = createTerminalInstance()
    plainTextRendererMocks.createInstance.mockReturnValue(instance)

    vi.stubEnv('VITE_TERMINAL_RENDERER', 'plain-text')

    expect(getTerminalRendererAdapter()).toBe(plainTextTerminalRenderer)
    expect(createConfiguredTerminalInstance()).toBe(instance)
    expect(plainTextRendererMocks.createInstance).toHaveBeenCalledOnce()
    expect(xtermRendererMocks.createInstance).not.toHaveBeenCalled()
  })

  test('keeps xterm as the default when environment selection is blank', () => {
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter('custom', instance)

    xtermRendererMocks.createInstance.mockReturnValue(instance)
    registerTerminalRendererAdapter(customRenderer)
    setTerminalRendererAdapter('xterm')
    vi.stubEnv('VITE_TERMINAL_RENDERER', ' ')

    expect(createConfiguredTerminalInstance()).toBe(instance)
    expect(getTerminalRendererAdapter()).toBe(xtermTerminalRenderer)
    expect(customRenderer.createInstance).not.toHaveBeenCalled()
    expect(xtermRendererMocks.createInstance).toHaveBeenCalledOnce()
  })

  test('rejects unknown environment renderer selection', () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'missing')

    expect(() => createConfiguredTerminalInstance()).toThrow(
      'Unknown terminal renderer adapter: missing'
    )
  })

  test('allows explicit environment configuration after adapter registration', () => {
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter(' custom ', instance)

    registerTerminalRendererAdapter(customRenderer)
    vi.stubEnv('VITE_TERMINAL_RENDERER', ' custom ')

    configureTerminalRendererFromEnvironment()

    expect(getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'custom' })
    )
  })

  test('rejects unknown renderer adapters', () => {
    expect(() => setTerminalRendererAdapter('missing')).toThrow(
      'Unknown terminal renderer adapter: missing'
    )
  })

  test('normalizes registered renderer adapter ids', () => {
    const instance = createTerminalInstance()
    const renderer = createTerminalRendererAdapter(' custom ', instance)

    registerTerminalRendererAdapter(renderer)
    setTerminalRendererAdapter('custom')

    expect(getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'custom' })
    )
  })

  test('rejects empty renderer adapter ids', () => {
    const instance = createTerminalInstance()
    const renderer = createTerminalRendererAdapter(' ', instance)

    expect(() => registerTerminalRendererAdapter(renderer)).toThrow(
      'Terminal renderer adapter id is required'
    )
  })

  test('resets to the default renderer adapter', () => {
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter('custom', instance)

    registerTerminalRendererAdapter(customRenderer)
    setTerminalRendererAdapter('custom')

    _resetTerminalRendererRegistryForTest()

    expect(getTerminalRendererAdapter()).toBe(xtermTerminalRenderer)
    expect(() => setTerminalRendererAdapter('custom')).toThrow(
      'Unknown terminal renderer adapter: custom'
    )

    setTerminalRendererAdapter('plain-text')

    expect(getTerminalRendererAdapter()).toBe(plainTextTerminalRenderer)
  })
})
