import { expect, test, vi } from 'vitest'
import { createTerminalInstance } from './terminalInstance'
import { createConfiguredTerminalInstance } from './terminalRendererRegistry'

vi.mock('./terminalRendererRegistry', () => ({
  createConfiguredTerminalInstance: vi.fn(),
}))

test('creates the configured terminal renderer instance', async () => {
  const instance = {
    terminal: {},
    output: {},
    parser: {},
    viewportReader: {},
    fitController: {},
    attachRenderer: vi.fn(),
  }
  vi.mocked(createConfiguredTerminalInstance).mockResolvedValue(
    instance as never
  )

  await expect(createTerminalInstance()).resolves.toBe(instance)
})
