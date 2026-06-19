// cspell:ignore worktree
import { describe, expect, test } from 'vitest'
import { isAllowedBackendMethod } from './backend-methods'

describe('isAllowedBackendMethod', () => {
  test.each([
    'spawn_pty',
    'write_pty',
    'rename_agent_session',
    'resize_pty',
    'kill_pty',
    'list_sessions',
    'set_active_session',
    'reorder_sessions',
    'update_session_cwd',
    'set_session_activity_panel_collapsed',
    'set_workspace_sessions',
    'set_kimi_usage_consent',
    'get_kimi_usage_consent',
    'refresh_kimi_usage',
    'detect_agent_in_session',
    'start_agent_watcher',
    'stop_agent_watcher',
    'list_dir',
    'read_file',
    'write_file',
    'rename_path',
    'delete_path',
    'git_status',
    'git_branch',
    'git_worktree_name',
    'get_git_diff',
    'stage_file',
    'unstage_file',
    'discard_file',
    'start_git_watcher',
    'stop_git_watcher',
  ])('allows %s', (method) => {
    expect(isAllowedBackendMethod(method)).toBe(true)
  })

  test('rejects unknown methods', () => {
    expect(isAllowedBackendMethod('open_shell')).toBe(false)
  })

  test('rejects e2e-only methods by default', () => {
    expect(isAllowedBackendMethod('list_active_pty_sessions')).toBe(false)
    expect(isAllowedBackendMethod('e2e_agent_bridge_info')).toBe(false)
    expect(isAllowedBackendMethod('e2e_seed_live_agent')).toBe(false)
  })

  test.each([
    'list_active_pty_sessions',
    'e2e_agent_bridge_info',
    'e2e_seed_live_agent',
  ])('allows e2e-only method %s when explicitly enabled', (method) => {
    expect(isAllowedBackendMethod(method, { allowE2eMethods: true })).toBe(true)
  })
})
