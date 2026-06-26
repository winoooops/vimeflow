import { afterEach, describe, expect, test, vi } from 'vitest'
import { resolveDefaultTerminalRendererMode } from './terminalRendererMode'

describe('resolveDefaultTerminalRendererMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('uses xterm when the renderer-side Ghostty WASM flag is unset', () => {
    expect(resolveDefaultTerminalRendererMode()).toBe('xterm')
  })

  test('uses xterm when the renderer-side Ghostty WASM flag is off', () => {
    vi.stubEnv('VITE_RENDERER_GHOSTTY_WASM', '0')

    expect(resolveDefaultTerminalRendererMode()).toBe('xterm')
  })

  test.each(['1', 'true'])(
    'uses Ghostty WASM only when explicitly enabled with %s',
    (flag) => {
      vi.stubEnv('VITE_RENDERER_GHOSTTY_WASM', flag)

      expect(resolveDefaultTerminalRendererMode()).toBe('ghostty-wasm')
    }
  )

  test.each(['false', 'unexpected'])(
    'keeps xterm for non-enabling flag value %s',
    (flag) => {
      vi.stubEnv('VITE_RENDERER_GHOSTTY_WASM', flag)

      expect(resolveDefaultTerminalRendererMode()).toBe('xterm')
    }
  )
})
