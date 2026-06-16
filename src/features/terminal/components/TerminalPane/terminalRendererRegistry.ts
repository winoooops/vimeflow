import type { TerminalInstance, TerminalRendererAdapter } from '../../types'
import { xtermTerminalRenderer } from './xtermInstance'

const terminalRendererAdapters = new Map<string, TerminalRendererAdapter>([
  [xtermTerminalRenderer.id, xtermTerminalRenderer],
])

let activeTerminalRendererId = xtermTerminalRenderer.id

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

export const getTerminalRendererAdapter = (): TerminalRendererAdapter => {
  const adapter = terminalRendererAdapters.get(activeTerminalRendererId)

  if (!adapter) {
    throw new Error(
      `Active terminal renderer adapter is unavailable: ${activeTerminalRendererId}`
    )
  }

  return adapter
}

export const createConfiguredTerminalInstance = (): TerminalInstance =>
  getTerminalRendererAdapter().createInstance()

export const _resetTerminalRendererRegistryForTest = (): void => {
  terminalRendererAdapters.clear()
  terminalRendererAdapters.set(xtermTerminalRenderer.id, xtermTerminalRenderer)
  activeTerminalRendererId = xtermTerminalRenderer.id
}
