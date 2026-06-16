import { expect, test, vi } from 'vitest'
import { createTerminalInstance } from './terminalInstance'
import { createConfiguredTerminalInstance } from './terminalRendererRegistry'

vi.mock('./terminalRendererRegistry', () => ({
  createConfiguredTerminalInstance: vi.fn(),
}))

test('creates the configured terminal renderer instance', () => {
  const instance = {
    terminal: {},
    parser: {},
    viewportReader: {},
    fitController: {},
    attachRenderer: vi.fn(),
  }
  vi.mocked(createConfiguredTerminalInstance).mockReturnValue(instance as never)

  expect(createTerminalInstance()).toBe(instance)
})
