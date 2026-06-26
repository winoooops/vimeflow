import { afterEach, describe, expect, test, vi } from 'vitest'
import { resolveDefaultTerminalRendererMode } from './terminalRendererMode'

describe('resolveDefaultTerminalRendererMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('uses xterm when the renderer-side Ghostty WASM flag is off', () => {
    vi.stubEnv('VITE_RENDERER_GHOSTTY_WASM', '0')

    expect(resolveDefaultTerminalRendererMode()).toBe('xterm')
  })

  test('keeps tests on xterm unless a component overrides the renderer', () => {
    expect(resolveDefaultTerminalRendererMode()).toBe('xterm')
  })
})
