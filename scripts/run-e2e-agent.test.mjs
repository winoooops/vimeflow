import { afterEach, describe, expect, test, vi } from 'vitest'
import { runAgentSuite } from './run-e2e-agent.mjs'

describe('run-e2e-agent script', () => {
  const originalCi = process.env.CI

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalCi === undefined) {
      delete process.env.CI
    } else {
      process.env.CI = originalCi
    }
  })

  test('runs the agent WDIO suite with the E2E renderer bridge enabled', () => {
    delete process.env.CI
    const spawner = vi.fn(() => ({ status: 0 }))

    expect(runAgentSuite(spawner)).toBe(0)
    expect(spawner).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['wdio', 'tests/e2e/agent/wdio.conf.ts'],
      expect.objectContaining({
        env: expect.objectContaining({ VITE_E2E: '1' }),
        stdio: 'inherit',
      })
    )
  })

  test('frees CI cargo intermediates before and after the agent suite', () => {
    process.env.CI = 'true'
    const calls = []
    const spawner = vi.fn(() => {
      calls.push('wdio')

      return { status: 0 }
    })
    const rmSync = vi.fn((targetPath) => {
      calls.push(targetPath)
    })

    expect(runAgentSuite(spawner, rmSync)).toBe(0)
    expect(rmSync).toHaveBeenCalledTimes(6)
    expect(spawner).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      expect.stringContaining('target/debug/build'),
      expect.stringContaining('target/debug/deps'),
      expect.stringContaining('target/debug/incremental'),
      'wdio',
      expect.stringContaining('target/debug/build'),
      expect.stringContaining('target/debug/deps'),
      expect.stringContaining('target/debug/incremental'),
    ])
  })

  test('preserves the WDIO exit status', () => {
    delete process.env.CI
    const spawner = vi.fn(() => ({ status: 7 }))

    expect(runAgentSuite(spawner)).toBe(7)
  })
})
