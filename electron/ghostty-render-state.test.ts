// cspell:ignore ghostty
import { describe, expect, test, vi } from 'vitest'
import {
  createGhosttyRenderStateBridge,
  type GhosttyNativeBindings,
} from './ghostty-render-state'

interface TestNativeTerminal {
  feed: ReturnType<typeof vi.fn<(bytes: Uint8Array) => void>>
  resize: ReturnType<typeof vi.fn<(cols: number, rows: number) => void>>
  snapshot: ReturnType<
    typeof vi.fn<
      () => {
        rows: number
        cursorRow: number
        cursorCol: number
        visibleLines: readonly { row: number; text: string }[]
      }
    >
  >
  dispose: ReturnType<typeof vi.fn<() => void>>
}

const createNativeBindings = (): {
  bindings: GhosttyNativeBindings
  terminals: TestNativeTerminal[]
} => {
  const terminals: TestNativeTerminal[] = []

  const bindings: GhosttyNativeBindings = {
    createTerminal: vi.fn(({ rows }) => {
      const terminal: TestNativeTerminal = {
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: vi.fn(() => ({
          rows,
          cursorRow: 1,
          cursorCol: 2,
          visibleLines: [
            { row: 0, text: 'prompt' },
            { row: 1, text: 'output' },
          ],
        })),
        dispose: vi.fn(),
      }

      terminals.push(terminal)

      return terminal
    }),
  }

  return { bindings, terminals }
}

describe('ghostty render-state bridge', () => {
  test('feeds bytes into the native terminal and normalizes snapshots', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = createGhosttyRenderStateBridge(bindings)
    const driver = bridge.createDriver({ onCwdChange: vi.fn() })
    const bytes = new Uint8Array([0x68, 0x69])

    driver.writeBytes(bytes)

    expect(terminals[0]?.feed).toHaveBeenCalledWith(bytes)
    expect(driver.readSnapshot()).toEqual({
      rows: ['prompt', 'output', ...Array.from({ length: 22 }, () => '')],
      cursor: {
        rowIndex: 1,
        columnOffset: 2,
      },
    })
  })

  test('preserves OSC7 cwd effects across byte chunks before feeding native state', () => {
    const { bindings, terminals } = createNativeBindings()
    const onCwdChange = vi.fn()
    const bridge = createGhosttyRenderStateBridge(bindings)
    const driver = bridge.createDriver({ onCwdChange })
    const encoder = new TextEncoder()

    driver.writeBytes(encoder.encode('\u001b]7;file://localhost/Users'))
    driver.writeBytes(encoder.encode('/user/project\u0007prompt'))

    expect(onCwdChange).toHaveBeenCalledWith(
      'file://localhost/Users/user/project'
    )
    expect(onCwdChange).toHaveBeenCalledOnce()
    expect(terminals[0]?.feed).toHaveBeenCalledTimes(2)
  })

  test('resizes native state and resets by recreating the terminal at the current size', () => {
    const { bindings, terminals } = createNativeBindings()
    const bridge = createGhosttyRenderStateBridge(bindings)
    const driver = bridge.createDriver({ onCwdChange: vi.fn() })

    driver.resize({ cols: 120, rows: 32 })
    driver.reset()

    expect(terminals[0]?.resize).toHaveBeenCalledWith(120, 32)
    expect(terminals[0]?.dispose).toHaveBeenCalledOnce()
    expect(bindings.createTerminal).toHaveBeenLastCalledWith({
      cols: 120,
      rows: 32,
      scrollbackLimit: 10_000,
    })
    expect(terminals).toHaveLength(2)
  })

  test('rejects invalid native snapshots at the bridge boundary', () => {
    const bridge = createGhosttyRenderStateBridge({
      createTerminal: () => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: (): {
          rows: number
          cursorRow: number
          cursorCol: number
          visibleLines: readonly { row: number; text: string }[]
        } => ({
          rows: 1,
          cursorRow: 0,
          cursorCol: 0,
          visibleLines: [{ row: 4, text: 'outside viewport' }],
        }),
        dispose: vi.fn(),
      }),
    })
    const driver = bridge.createDriver({ onCwdChange: vi.fn() })

    expect(() => driver.readSnapshot()).toThrow(
      'Ghostty native render-state snapshot rows are invalid'
    )
  })

  test('fails closed when terminal recreation throws during reset', () => {
    const terminals: TestNativeTerminal[] = []

    const bindings: GhosttyNativeBindings = {
      createTerminal: vi.fn(({ rows }) => {
        if (terminals.length === 1) {
          throw new Error('native create failed')
        }

        const terminal: TestNativeTerminal = {
          feed: vi.fn(),
          resize: vi.fn(),
          snapshot: vi.fn(() => ({
            rows,
            cursorRow: 1,
            cursorCol: 2,
            visibleLines: [
              { row: 0, text: 'prompt' },
              { row: 1, text: 'output' },
            ],
          })),
          dispose: vi.fn(),
        }

        terminals.push(terminal)

        return terminal
      }),
    }

    const bridge = createGhosttyRenderStateBridge(bindings)
    const driver = bridge.createDriver({ onCwdChange: vi.fn() })

    driver.writeBytes(new Uint8Array([0x61]))

    expect(() => driver.reset()).toThrow('native create failed')
    expect(() => driver.readSnapshot()).toThrow(
      'Ghostty native render-state driver has been disposed'
    )
    expect(terminals[0]?.dispose).toHaveBeenCalledOnce()
  })

  test('rejects cursor rows outside the snapshot viewport', () => {
    const bridge = createGhosttyRenderStateBridge({
      createTerminal: () => ({
        feed: vi.fn(),
        resize: vi.fn(),
        snapshot: (): {
          rows: number
          cursorRow: number
          cursorCol: number
          visibleLines: readonly { row: number; text: string }[]
        } => ({
          rows: 2,
          cursorRow: 2,
          cursorCol: 0,
          visibleLines: [{ row: 0, text: 'line 0' }],
        }),
        dispose: vi.fn(),
      }),
    })
    const driver = bridge.createDriver({ onCwdChange: vi.fn() })

    expect(() => driver.readSnapshot()).toThrow(
      'Ghostty native render-state snapshot cursor is invalid'
    )
  })
})
