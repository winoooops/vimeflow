import type { TerminalInstance, TerminalRendererAdapter } from '../../types'
import { xtermTerminalRenderer } from './xtermInstance'

const terminalRendererAdapters = new Map<string, TerminalRendererAdapter>([
  [xtermTerminalRenderer.id, xtermTerminalRenderer],
])

let activeTerminalRendererId = xtermTerminalRenderer.id
let hasConfiguredTerminalRendererFromEnvironment = false

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

export const setTerminalRendererAdapter = (rendererId: string): void => {
  if (!terminalRendererAdapters.has(rendererId)) {
    throw new Error(`Unknown terminal renderer adapter: ${rendererId}`)
  }

  activeTerminalRendererId = rendererId
}

export const configureTerminalRendererFromEnvironment = (): void => {
  const rendererId = readEnvironmentRendererId()

  if (!rendererId) {
    hasConfiguredTerminalRendererFromEnvironment = true

    return
  }

  setTerminalRendererAdapter(rendererId)
  hasConfiguredTerminalRendererFromEnvironment = true
}

const ensureTerminalRendererConfigured = (): void => {
  if (hasConfiguredTerminalRendererFromEnvironment) {
    return
  }

  configureTerminalRendererFromEnvironment()
}

export const getTerminalRendererAdapter = (): TerminalRendererAdapter => {
  ensureTerminalRendererConfigured()

  const adapter = terminalRendererAdapters.get(activeTerminalRendererId)

  if (!adapter) {
    throw new Error(
      `Active terminal renderer adapter is unavailable: ${activeTerminalRendererId}`
    )
  }

  return adapter
}

export const createConfiguredTerminalInstance = (): TerminalInstance => {
  ensureTerminalRendererConfigured()

  return getTerminalRendererAdapter().createInstance()
}

export const _resetTerminalRendererRegistryForTest = (): void => {
  terminalRendererAdapters.clear()
  terminalRendererAdapters.set(xtermTerminalRenderer.id, xtermTerminalRenderer)
  activeTerminalRendererId = xtermTerminalRenderer.id
  hasConfiguredTerminalRendererFromEnvironment = false
}
