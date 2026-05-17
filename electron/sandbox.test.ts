import { describe, expect, test } from 'vitest'
import {
  VIMEFLOW_NO_SANDBOX_ENV,
  electronStartupArgs,
  isElectronNoSandboxRequested,
} from './sandbox'

describe('Electron sandbox startup args', () => {
  test('keeps the renderer sandbox enabled by default', () => {
    expect(electronStartupArgs({})).toEqual(['.'])
  })

  test('adds no-sandbox only when explicitly requested', () => {
    const env = { [VIMEFLOW_NO_SANDBOX_ENV]: '1' }

    expect(isElectronNoSandboxRequested(env)).toBe(true)
    expect(electronStartupArgs(env)).toEqual(['.', '--no-sandbox'])
  })

  test('does not infer no-sandbox from CI or headless display vars', () => {
    expect(
      electronStartupArgs({
        CI: 'true',
        DISPLAY: undefined,
        WAYLAND_DISPLAY: undefined,
      })
    ).toEqual(['.'])
  })
})
