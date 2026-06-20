// cspell:ignore ghostty
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  BackendApi,
  GhosttyRenderStateBridgeDriver,
} from '../../../../lib/backend'
import type {
  TerminalInstance,
  TerminalRendererAdapter,
  TerminalRendererCapabilities,
} from '../../types'
import type {
  GhosttyVtRenderStateDriver,
  GhosttyVtRenderStateDriverFactory,
} from './ghosttyVtRenderStateDriver'

type TerminalRendererRegistryModule =
  typeof import('./terminalRendererRegistry')

const xtermRendererMocks = vi.hoisted(() => ({
  createInstance: vi.fn(),
}))

const plainTextRendererMocks = vi.hoisted(() => ({
  createInstance: vi.fn(),
  moduleLoaded: vi.fn(),
}))

const ghosttyRendererMocks = vi.hoisted(() => ({
  createInstance: vi.fn(),
  createTerminalRenderer: vi.fn(),
  moduleLoaded: vi.fn(),
}))

const rendererCapabilities = vi.hoisted(() => ({
  text: {
    preferredOutputInputMode: 'text',
    acceptsText: true,
    acceptsBytes: false,
  } as const,
  bytes: {
    preferredOutputInputMode: 'bytes',
    acceptsText: true,
    acceptsBytes: true,
  } as const,
}))

const textRendererCapabilities: TerminalRendererCapabilities =
  rendererCapabilities.text

vi.mock('./plainTextInstance', () => {
  plainTextRendererMocks.moduleLoaded()

  return {
    plainTextTerminalRenderer: {
      id: 'plain-text',
      capabilities: rendererCapabilities.text,
      createInstance: plainTextRendererMocks.createInstance,
    },
  }
})

vi.mock('./ghosttyInstance', () => {
  ghosttyRendererMocks.moduleLoaded()

  const ghosttyTerminalRenderer: TerminalRendererAdapter = {
    id: 'ghostty',
    capabilities: rendererCapabilities.bytes,
    createInstance: ghosttyRendererMocks.createInstance,
  }

  ghosttyRendererMocks.createTerminalRenderer.mockImplementation(
    (): TerminalRendererAdapter => ghosttyTerminalRenderer
  )

  return {
    ghosttyTerminalRenderer,
    createGhosttyTerminalRenderer: ghosttyRendererMocks.createTerminalRenderer,
  }
})

vi.mock('./xtermInstance', () => ({
  xtermTerminalRenderer: {
    id: 'xterm',
    capabilities: rendererCapabilities.text,
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
  capabilities: textRendererCapabilities,
  createInstance: vi.fn((): TerminalInstance => instance),
})

interface GhosttyTerminalRendererFactoryOptions {
  readonly createVtRenderStateDriver: GhosttyVtRenderStateDriverFactory
}

const installVimeflowBridge = (api: BackendApi): void => {
  Object.defineProperty(window, 'vimeflow', {
    configurable: true,
    value: api,
  })
}

const readGhosttyRendererFactoryOptions =
  (): GhosttyTerminalRendererFactoryOptions => {
    const options = ghosttyRendererMocks.createTerminalRenderer.mock
      .calls[0]?.[0] as GhosttyTerminalRendererFactoryOptions | undefined

    if (!options) {
      throw new Error('Expected ghostty renderer factory options')
    }

    return options
  }

describe('terminalRendererRegistry', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'vimeflow')
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

  test('loads the bundled ghostty renderer only when selected by environment', async () => {
    const instance = createTerminalInstance()

    ghosttyRendererMocks.createInstance.mockReturnValue(instance)
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'ghostty')

    const registry = await importTerminalRendererRegistry()

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'ghostty' })
    )
    expect(await registry.createConfiguredTerminalInstance()).toBe(instance)
    expect(ghosttyRendererMocks.moduleLoaded).toHaveBeenCalledOnce()
    expect(ghosttyRendererMocks.createTerminalRenderer).not.toHaveBeenCalled()
    expect(ghosttyRendererMocks.createInstance).toHaveBeenCalledOnce()
    expect(plainTextRendererMocks.moduleLoaded).not.toHaveBeenCalled()
    expect(xtermRendererMocks.createInstance).not.toHaveBeenCalled()
  })

  test('keeps the Ghostty render-state provider gate off by default', async () => {
    vi.stubEnv('VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER', 'native-test')

    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()

    const createVtRenderStateDriver = vi.fn(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({ rows: [] }),
      })
    )

    xtermRendererMocks.createInstance.mockReturnValue(instance)
    registry.registerGhosttyRenderStateDriverProvider({
      id: 'native-test',
      createVtRenderStateDriver,
    })

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'xterm' })
    )
    expect(await registry.createConfiguredTerminalInstance()).toBe(instance)
    expect(ghosttyRendererMocks.moduleLoaded).not.toHaveBeenCalled()
    expect(ghosttyRendererMocks.createTerminalRenderer).not.toHaveBeenCalled()
    expect(createVtRenderStateDriver).not.toHaveBeenCalled()
  })

  test('creates the bundled ghostty renderer with a selected render-state provider', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'ghostty')
    vi.stubEnv('VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER', 'native-test')

    const registry = await importTerminalRendererRegistry()
    const instance = createTerminalInstance()

    const createVtRenderStateDriver = vi.fn(
      (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({ rows: [] }),
      })
    )

    ghosttyRendererMocks.createInstance.mockReturnValue(instance)
    registry.registerGhosttyRenderStateDriverProvider({
      id: ' native-test ',
      createVtRenderStateDriver,
    })

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({
        id: 'ghostty',
        capabilities: rendererCapabilities.bytes,
      })
    )
    expect(await registry.createConfiguredTerminalInstance()).toBe(instance)
    expect(ghosttyRendererMocks.createTerminalRenderer).toHaveBeenCalledWith({
      createVtRenderStateDriver,
    })
    expect(ghosttyRendererMocks.createInstance).toHaveBeenCalledOnce()
    expect(xtermRendererMocks.createInstance).not.toHaveBeenCalled()
  })

  test('fails closed when a selected Ghostty render-state provider is unavailable', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'ghostty')
    vi.stubEnv('VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER', 'missing-native')

    const registry = await importTerminalRendererRegistry()

    await expect(registry.getTerminalRendererAdapter()).rejects.toThrow(
      'Unavailable Ghostty render-state driver provider: missing-native'
    )
    expect(ghosttyRendererMocks.moduleLoaded).not.toHaveBeenCalled()
    expect(ghosttyRendererMocks.createTerminalRenderer).not.toHaveBeenCalled()
  })

  test('fails closed when the built-in native Ghostty provider has no preload bridge', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'ghostty')
    vi.stubEnv('VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER', 'native')

    const registry = await importTerminalRendererRegistry()

    await expect(registry.getTerminalRendererAdapter()).rejects.toThrow(
      'Ghostty native render-state bridge is unavailable'
    )
    expect(ghosttyRendererMocks.moduleLoaded).not.toHaveBeenCalled()
    expect(ghosttyRendererMocks.createTerminalRenderer).not.toHaveBeenCalled()
  })

  test('creates the bundled ghostty renderer with the built-in native bridge provider', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'ghostty')
    vi.stubEnv('VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER', 'native')

    const nativeWriteBytes = vi.fn()
    const nativeReset = vi.fn()
    const nativeResize = vi.fn()
    const nativeDispose = vi.fn()

    const nativeCreateDriver = vi.fn(
      (): GhosttyRenderStateBridgeDriver => ({
        writeBytes: nativeWriteBytes,
        readSnapshot: (): unknown => ({
          rows: ['native row'],
          cursor: {
            rowIndex: 0,
            columnOffset: 6,
          },
        }),
        reset: nativeReset,
        resize: nativeResize,
        dispose: nativeDispose,
      })
    )

    installVimeflowBridge({
      invoke: vi.fn(),
      listen: vi.fn(),
      ghosttyRenderState: {
        createDriver: nativeCreateDriver,
      },
    })

    const registry = await importTerminalRendererRegistry()

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({
        id: 'ghostty',
        capabilities: rendererCapabilities.bytes,
      })
    )

    const { createVtRenderStateDriver } = readGhosttyRendererFactoryOptions()
    const onCwdChange = vi.fn()
    const driver = createVtRenderStateDriver({ onCwdChange })
    const bytes = new Uint8Array([0x67, 0x68])

    driver.writeBytes(bytes)
    driver.resize?.({ cols: 100, rows: 30 })
    driver.reset?.()
    driver.dispose?.()

    expect(nativeCreateDriver).toHaveBeenCalledWith({
      onCwdChange,
    })
    expect(nativeWriteBytes).toHaveBeenCalledWith(bytes)
    expect(driver.readSnapshot()).toEqual({
      rows: ['native row'],
      cursor: {
        rowIndex: 0,
        columnOffset: 6,
      },
    })
    expect(nativeResize).toHaveBeenCalledWith({ cols: 100, rows: 30 })
    expect(nativeReset).toHaveBeenCalledOnce()
    expect(nativeDispose).toHaveBeenCalledOnce()
    expect(ghosttyRendererMocks.createTerminalRenderer).toHaveBeenCalledWith({
      createVtRenderStateDriver,
    })
  })

  test('rejects empty Ghostty render-state provider ids', async () => {
    const registry = await importTerminalRendererRegistry()

    expect(() =>
      registry.registerGhosttyRenderStateDriverProvider({
        id: ' ',
        createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
          writeBytes: vi.fn(),
          readSnapshot: () => ({ rows: [] }),
        }),
      })
    ).toThrow('Ghostty render-state driver provider id is required')
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

  test('resets registered Ghostty render-state driver providers', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'ghostty')
    vi.stubEnv('VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER', 'native-test')

    const registry = await importTerminalRendererRegistry()

    registry.registerGhosttyRenderStateDriverProvider({
      id: 'native-test',
      createVtRenderStateDriver: (): GhosttyVtRenderStateDriver => ({
        writeBytes: vi.fn(),
        readSnapshot: () => ({ rows: [] }),
      }),
    })
    registry._resetTerminalRendererRegistryForTest()

    await expect(registry.getTerminalRendererAdapter()).rejects.toThrow(
      'Unavailable Ghostty render-state driver provider: native-test'
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

  test('retains the environment-loaded ghostty adapter after reset', async () => {
    vi.stubEnv('VITE_TERMINAL_RENDERER', 'ghostty')

    const registry = await importTerminalRendererRegistry()

    await registry.configureTerminalRendererFromEnvironment()
    registry._resetTerminalRendererRegistryForTest()
    registry.setTerminalRendererAdapter('ghostty')

    expect(await registry.getTerminalRendererAdapter()).toEqual(
      expect.objectContaining({ id: 'ghostty' })
    )
  })
})
