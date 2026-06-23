import { describe, expect, test } from 'vitest'
import {
  VIMEFLOW_NO_SANDBOX_ENV,
  VIMEFLOW_USER_DATA_DIR_ENV,
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

  test('isolates userData via --user-data-dir when requested', () => {
    expect(
      electronStartupArgs({ [VIMEFLOW_USER_DATA_DIR_ENV]: '/tmp/vimeflow-dev' })
    ).toEqual(['.', '--user-data-dir=/tmp/vimeflow-dev'])
  })

  test('combines no-sandbox and an isolated userData dir', () => {
    expect(
      electronStartupArgs({
        [VIMEFLOW_NO_SANDBOX_ENV]: '1',
        [VIMEFLOW_USER_DATA_DIR_ENV]: '/tmp/vimeflow-dev',
      })
    ).toEqual(['.', '--no-sandbox', '--user-data-dir=/tmp/vimeflow-dev'])
  })
})
