const backendMethods = new Set([
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
