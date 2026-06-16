import type { TerminalInstance, TerminalRendererAdapter } from '../../types'
import { PLAIN_TEXT_TERMINAL_RENDERER_ID } from './plainTextRendererMetadata'
import { xtermTerminalRenderer } from './xtermInstance'

const terminalRendererAdapters = new Map<string, TerminalRendererAdapter>([
  [xtermTerminalRenderer.id, xtermTerminalRenderer],
])

let activeTerminalRendererId = xtermTerminalRenderer.id
let hasConfiguredTerminalRendererFromEnvironment = false
let bundledPlainTextRenderer: TerminalRendererAdapter | null = null
const initialEnvironmentRendererId = import.meta.env.VITE_TERMINAL_RENDERER

const shouldRegisterBundledPlainTextRenderer =
  typeof initialEnvironmentRendererId === 'string' &&
  initialEnvironmentRendererId.trim() === PLAIN_TEXT_TERMINAL_RENDERER_ID

const readEnvironmentRendererId = (): string | null => {
  const rendererId = import.meta.env.VITE_TERMINAL_RENDERER

  if (typeof rendererId !== 'string') {
    return null
  }

  const normalizedRendererId = rendererId.trim()

  return normalizedRendererId.length > 0 ? normalizedRendererId : null
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

const registerBundledEnvironmentRenderer = async (): Promise<void> => {
  if (
    !shouldRegisterBundledPlainTextRenderer ||
    terminalRendererAdapters.has(PLAIN_TEXT_TERMINAL_RENDERER_ID)
  ) {
    return
  }

  const { plainTextTerminalRenderer } = await import('./plainTextInstance')

  bundledPlainTextRenderer = plainTextTerminalRenderer
  registerTerminalRendererAdapter(plainTextTerminalRenderer)
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

  await configureTerminalRendererFromEnvironment()
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
  terminalRendererAdapters.set(xtermTerminalRenderer.id, xtermTerminalRenderer)

  if (bundledPlainTextRenderer) {
    terminalRendererAdapters.set(
      bundledPlainTextRenderer.id,
      bundledPlainTextRenderer
    )
  }

  activeTerminalRendererId = xtermTerminalRenderer.id
  hasConfiguredTerminalRendererFromEnvironment = false
}
