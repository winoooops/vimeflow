import { expect, test, vi } from 'vitest'
import { createTerminalInstance } from './terminalInstance'
import { createXtermTerminal } from './xtermInstance'

vi.mock('./xtermInstance', () => ({
  createXtermTerminal: vi.fn(),
}))

test('creates the configured terminal renderer instance', () => {
  const instance = {
    terminal: {},
    parser: {},
    viewportReader: {},
    fitController: {},
    attachRenderer: vi.fn(),
  }
  vi.mocked(createXtermTerminal).mockReturnValue(instance as never)

  expect(createTerminalInstance()).toBe(instance)
})
