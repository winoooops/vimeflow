import { afterEach, describe, expect, test } from 'vitest'
import { isAllowedBackendMethod } from './backend-methods'

const originalViteE2e = process.env.VITE_E2E

afterEach(() => {
  if (originalViteE2e === undefined) {
    delete process.env.VITE_E2E

    return
  }

  process.env.VITE_E2E = originalViteE2e
})

describe('isAllowedBackendMethod', () => {
  test.each([
    'spawn_pty',
    'write_pty',
    'resize_pty',
    'kill_pty',
    'list_sessions',
    'set_active_session',
    'reorder_sessions',
    'update_session_cwd',
    'detect_agent_in_session',
    'start_agent_watcher',
    'stop_agent_watcher',
    'list_dir',
    'read_file',
    'write_file',
    'git_status',
    'git_branch',
    'get_git_diff',
    'start_git_watcher',
    'stop_git_watcher',
  ])('allows %s', (method) => {
    expect(isAllowedBackendMethod(method)).toBe(true)
  })

  test('rejects unknown methods', () => {
    expect(isAllowedBackendMethod('open_shell')).toBe(false)
  })

  test('rejects e2e-only methods by default', () => {
    delete process.env.VITE_E2E

    expect(isAllowedBackendMethod('list_active_pty_sessions')).toBe(false)
  })

  test('allows e2e-only methods when e2e mode is enabled', () => {
    process.env.VITE_E2E = '1'

    expect(isAllowedBackendMethod('list_active_pty_sessions')).toBe(true)
  })
})
