// cspell:ignore worktree
const backendMethods = new Set([
  'spawn_pty',
  'write_pty',
  'rename_agent_session',
  'resize_pty',
  'kill_pty',
  'kill_ephemeral_ptys',
  'list_sessions',
  'set_active_session',
  'reorder_sessions',
  'update_session_cwd',
  'set_session_activity_panel_collapsed',
  'set_workspace_sessions',
  'load_app_settings',
  'save_app_settings',
  'detect_agent_in_session',
  'start_agent_watcher',
  'stop_agent_watcher',
  'list_dir',
  'read_file',
  'write_file',
  'git_status',
  'git_branch',
  'git_worktree_name',
  'get_git_diff',
  'stage_file',
  'unstage_file',
  'discard_file',
  'start_git_watcher',
  'stop_git_watcher',
  'stage_file',
  'unstage_file',
  'discard_file',
])

const e2eBackendMethods = new Set(['list_active_pty_sessions'])

interface BackendMethodOptions {
  allowE2eMethods?: boolean
}

export const isAllowedBackendMethod = (
  method: string,
  options: BackendMethodOptions = {}
): boolean => {
  if (backendMethods.has(method)) {
    return true
  }

  return options.allowE2eMethods === true && e2eBackendMethods.has(method)
}
