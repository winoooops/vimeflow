// cspell:ignore ghostty
import type { TerminalInstance, TerminalRendererAdapter } from '../../types'
import { GHOSTTY_TERMINAL_RENDERER_ID } from './ghosttyRendererMetadata'
import type { GhosttyVtRenderStateDriverFactory } from './ghosttyVtRenderStateDriver'
import { PLAIN_TEXT_TERMINAL_RENDERER_ID } from './plainTextRendererMetadata'
import { xtermTerminalRenderer } from './xtermInstance'

export interface GhosttyRenderStateDriverProvider {
  readonly id: string
  readonly createVtRenderStateDriver: GhosttyVtRenderStateDriverFactory
}

const terminalRendererAdapters = new Map<string, TerminalRendererAdapter>([
  [xtermTerminalRenderer.id, xtermTerminalRenderer],
])

const ghosttyRenderStateDriverProviders = new Map<
  string,
  GhosttyRenderStateDriverProvider
>()

let activeTerminalRendererId = xtermTerminalRenderer.id
let hasConfiguredTerminalRendererFromEnvironment = false
let bundledPlainTextRenderer: TerminalRendererAdapter | null = null
let bundledGhosttyRenderer: TerminalRendererAdapter | null = null
let configureTerminalRendererPromise: Promise<void> | null = null
const initialEnvironmentRendererId = import.meta.env.VITE_TERMINAL_RENDERER

const shouldRegisterBundledPlainTextRenderer =
  typeof initialEnvironmentRendererId === 'string' &&
  initialEnvironmentRendererId.trim() === PLAIN_TEXT_TERMINAL_RENDERER_ID

const shouldRegisterBundledGhosttyRenderer =
  typeof initialEnvironmentRendererId === 'string' &&
  initialEnvironmentRendererId.trim() === GHOSTTY_TERMINAL_RENDERER_ID

const readEnvironmentRendererId = (): string | null => {
  const rendererId = import.meta.env.VITE_TERMINAL_RENDERER

  if (typeof rendererId !== 'string') {
    return null
  }

  const normalizedRendererId = rendererId.trim()

  return normalizedRendererId.length > 0 ? normalizedRendererId : null
}

const readGhosttyRenderStateDriverProviderId = (): string | null => {
  const providerId = import.meta.env.VITE_GHOSTTY_RENDER_STATE_DRIVER_PROVIDER

  if (typeof providerId !== 'string') {
    return null
  }

  const normalizedProviderId = providerId.trim()

  return normalizedProviderId.length > 0 ? normalizedProviderId : null
}

export const registerTerminalRendererAdapter = (
  adapter: TerminalRendererAdapter
): void => {
  const rendererId = adapter.id.trim()

  if (rendererId.length === 0) {
    throw new Error('Terminal renderer adapter id is required')
  }

  terminalRendererAdapters.set(rendererId, {
    ...adapter,
    id: rendererId,
  })
}

export const registerGhosttyRenderStateDriverProvider = (
  provider: GhosttyRenderStateDriverProvider
): void => {
  const providerId = provider.id.trim()

  if (providerId.length === 0) {
    throw new Error('Ghostty render-state driver provider id is required')
  }

  ghosttyRenderStateDriverProviders.set(providerId, {
    ...provider,
    id: providerId,
  })
}

const loadBundledGhosttyRenderer =
  async (): Promise<TerminalRendererAdapter> => {
    const providerId = readGhosttyRenderStateDriverProviderId()

    if (!providerId) {
      const { ghosttyTerminalRenderer } = await import('./ghosttyInstance')

      return ghosttyTerminalRenderer
    }

    const provider = ghosttyRenderStateDriverProviders.get(providerId)

    if (!provider) {
      throw new Error(
        `Unavailable Ghostty render-state driver provider: ${providerId}`
      )
    }

    const { createGhosttyTerminalRenderer } = await import('./ghosttyInstance')

    return createGhosttyTerminalRenderer({
      createVtRenderStateDriver: provider.createVtRenderStateDriver,
    })
  }

const registerBundledEnvironmentRenderer = async (): Promise<void> => {
  if (
    shouldRegisterBundledPlainTextRenderer &&
    !terminalRendererAdapters.has(PLAIN_TEXT_TERMINAL_RENDERER_ID)
  ) {
    const { plainTextTerminalRenderer } = await import('./plainTextInstance')

    bundledPlainTextRenderer = plainTextTerminalRenderer
    registerTerminalRendererAdapter(plainTextTerminalRenderer)
  }

  if (
    shouldRegisterBundledGhosttyRenderer &&
    !terminalRendererAdapters.has(GHOSTTY_TERMINAL_RENDERER_ID)
  ) {
    const ghosttyTerminalRenderer = await loadBundledGhosttyRenderer()

    bundledGhosttyRenderer = ghosttyTerminalRenderer
    registerTerminalRendererAdapter(ghosttyTerminalRenderer)
  }
}

export const setTerminalRendererAdapter = (rendererId: string): void => {
  if (!terminalRendererAdapters.has(rendererId)) {
    throw new Error(`Unknown terminal renderer adapter: ${rendererId}`)
  }

  activeTerminalRendererId = rendererId
}

export const configureTerminalRendererFromEnvironment =
  async (): Promise<void> => {
    const rendererId = readEnvironmentRendererId()

    if (!rendererId) {
      hasConfiguredTerminalRendererFromEnvironment = true

      return
    }

    await registerBundledEnvironmentRenderer()
    setTerminalRendererAdapter(rendererId)
    hasConfiguredTerminalRendererFromEnvironment = true
  }

const ensureTerminalRendererConfigured = async (): Promise<void> => {
  if (hasConfiguredTerminalRendererFromEnvironment) {
    return
  }

  configureTerminalRendererPromise ??=
    configureTerminalRendererFromEnvironment()

  try {
    await configureTerminalRendererPromise
  } catch (error) {
    configureTerminalRendererPromise = null

    throw error
  }
}

export const getTerminalRendererAdapter =
  async (): Promise<TerminalRendererAdapter> => {
    await ensureTerminalRendererConfigured()

    const adapter = terminalRendererAdapters.get(activeTerminalRendererId)

    if (!adapter) {
      throw new Error(
        `Active terminal renderer adapter is unavailable: ${activeTerminalRendererId}`
      )
    }

    return adapter
  }

export const createConfiguredTerminalInstance =
  async (): Promise<TerminalInstance> => {
    const adapter = await getTerminalRendererAdapter()

    return adapter.createInstance()
  }

export const _resetTerminalRendererRegistryForTest = (): void => {
  terminalRendererAdapters.clear()
  ghosttyRenderStateDriverProviders.clear()
  terminalRendererAdapters.set(xtermTerminalRenderer.id, xtermTerminalRenderer)

  if (bundledPlainTextRenderer) {
    terminalRendererAdapters.set(
      bundledPlainTextRenderer.id,
      bundledPlainTextRenderer
    )
  }

  if (bundledGhosttyRenderer) {
    terminalRendererAdapters.set(
      bundledGhosttyRenderer.id,
      bundledGhosttyRenderer
    )
  }

  activeTerminalRendererId = xtermTerminalRenderer.id
  hasConfiguredTerminalRendererFromEnvironment = false
  configureTerminalRendererPromise = null
}
