import { afterEach, describe, expect, test, vi } from 'vitest'
import type { TerminalInstance, TerminalRendererAdapter } from '../../types'

type TerminalRendererRegistryModule =
  typeof import('./terminalRendererRegistry')

const xtermRendererMocks = vi.hoisted(() => ({
  createInstance: vi.fn(),
}))

const plainTextRendererMocks = vi.hoisted(() => ({
  createInstance: vi.fn(),
  moduleLoaded: vi.fn(),
}))

vi.mock('./plainTextInstance', () => {
  plainTextRendererMocks.moduleLoaded()

  return {
    plainTextTerminalRenderer: {
      id: 'plain-text',
      createInstance: plainTextRendererMocks.createInstance,
    },
  }
})

vi.mock('./xtermInstance', () => ({
  xtermTerminalRenderer: {
    id: 'xterm',
    createInstance: xtermRendererMocks.createInstance,
  },
}))

const importTerminalRendererRegistry =
  async (): Promise<TerminalRendererRegistryModule> =>
    import('./terminalRendererRegistry')

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
  output: {
    writeOutput: vi.fn(),
  },
  parser: {
    onEvent: vi.fn(() => ({ dispose: vi.fn() })),
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
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.clearAllMocks()
  })

  test('uses the xterm renderer adapter by default without loading the plain-text module', async () => {
    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()

    xtermRendererMocks.createInstance.mockReturnValue(instance)

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'xterm' })
    )
    expect(await registry.createConfiguredTerminalInstance()).toBe(instance)
    expect(xtermRendererMocks.createInstance).toHaveBeenCalledOnce()
    expect(plainTextRendererMocks.moduleLoaded).not.toHaveBeenCalled()
  })

  test('does not expose the bundled plain-text renderer on the default path', async () => {
    const registry = await importTerminalRendererRegistry()

    expect(() => registry.setTerminalRendererAdapter('plain-text')).toThrow(
      'Unknown terminal renderer adapter: plain-text'
    )
    expect(plainTextRendererMocks.moduleLoaded).not.toHaveBeenCalled()
  })

  test('creates instances through a registered non-xterm renderer adapter', async () => {
    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter('custom', instance)

    registry.registerTerminalRendererAdapter(customRenderer)
    registry.setTerminalRendererAdapter('custom')

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'custom' })
    )
    expect(await registry.createConfiguredTerminalInstance()).toBe(instance)
    expect(customRenderer.createInstance).toHaveBeenCalledOnce()
    expect(xtermRendererMocks.createInstance).not.toHaveBeenCalled()
  })

  test('creates instances through the renderer selected by environment', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'custom')

    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter('custom', instance)

    registry.registerTerminalRendererAdapter(customRenderer)

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'custom' })
    )
    expect(await registry.createConfiguredTerminalInstance()).toBe(instance)
    expect(customRenderer.createInstance).toHaveBeenCalledOnce()
    expect(xtermRendererMocks.createInstance).not.toHaveBeenCalled()
  })

  test('loads the bundled plain-text renderer only when selected by environment', async () => {
    const instance = createTerminalInstance()

    plainTextRendererMocks.createInstance.mockReturnValue(instance)
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'plain-text')

    const registry = await importTerminalRendererRegistry()

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'plain-text' })
    )
    expect(await registry.createConfiguredTerminalInstance()).toBe(instance)
    expect(plainTextRendererMocks.moduleLoaded).toHaveBeenCalledOnce()
    expect(plainTextRendererMocks.createInstance).toHaveBeenCalledOnce()
    expect(xtermRendererMocks.createInstance).not.toHaveBeenCalled()
  })

  test('keeps xterm as the default when environment selection is blank', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', ' ')

    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter('custom', instance)

    xtermRendererMocks.createInstance.mockReturnValue(instance)
    registry.registerTerminalRendererAdapter(customRenderer)
    registry.setTerminalRendererAdapter('xterm')

    expect(await registry.createConfiguredTerminalInstance()).toBe(instance)
    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'xterm' })
    )
    expect(customRenderer.createInstance).not.toHaveBeenCalled()
    expect(xtermRendererMocks.createInstance).toHaveBeenCalledOnce()
  })

  test('rejects unknown environment renderer selection', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'missing')

    const registry = await importTerminalRendererRegistry()

    await expect(registry.createConfiguredTerminalInstance()).rejects.toThrow(
      'Unknown terminal renderer adapter: missing'
    )
  })

  test('allows explicit environment configuration after adapter registration', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', ' custom ')

    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter(' custom ', instance)

    registry.registerTerminalRendererAdapter(customRenderer)

    await registry.configureTerminalRendererFromEnvironment()

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'custom' })
    )
  })

  test('rejects unknown renderer adapters', async () => {
    const registry = await importTerminalRendererRegistry()

    expect(() => registry.setTerminalRendererAdapter('missing')).toThrow(
      'Unknown terminal renderer adapter: missing'
    )
  })

  test('normalizes registered renderer adapter ids', async () => {
    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()
    const renderer = createTerminalRendererAdapter(' custom ', instance)

    registry.registerTerminalRendererAdapter(renderer)
    registry.setTerminalRendererAdapter('custom')

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'custom' })
    )
  })

  test('rejects empty renderer adapter ids', async () => {
    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()
    const renderer = createTerminalRendererAdapter(' ', instance)

    expect(() => registry.registerTerminalRendererAdapter(renderer)).toThrow(
      'Terminal renderer adapter id is required'
    )
  })

  test('resets to the default renderer adapter', async () => {
    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()
    const customRenderer = createTerminalRendererAdapter('custom', instance)

    registry.registerTerminalRendererAdapter(customRenderer)
    registry.setTerminalRendererAdapter('custom')

    registry._resetTerminalRendererRegistryForTest()

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'xterm' })
    )

    expect(() => registry.setTerminalRendererAdapter('custom')).toThrow(
      'Unknown terminal renderer adapter: custom'
    )
  })

  test('retains environment-loaded bundled adapters after reset', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'plain-text')

    const registry = await importTerminalRendererRegistry()

    await registry.configureTerminalRendererFromEnvironment()
    registry._resetTerminalRendererRegistryForTest()
    registry.setTerminalRendererAdapter('plain-text')

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'plain-text' })
    )
  })
})
