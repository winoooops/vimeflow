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
  'load_review_state',
  'save_review_state',
  'delete_review_owner_state',
  'load_app_settings',
  'save_app_settings',
  'list_system_fonts',
  'load_agent_aliases',
  'save_agent_aliases',
  'set_kimi_usage_consent',
  'get_kimi_usage_consent',
  'refresh_kimi_usage',
  'detect_agent_in_session',
  'start_agent_watcher',
  'stop_agent_watcher',
  'recover_agent_replies',
  'recover_agent_reviews',
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
  'stage_file',
  'unstage_file',
  'discard_file',
])

const e2eBackendMethods = new Set([
  'list_active_pty_sessions',
  'e2e_agent_bridge_info',
  'e2e_seed_live_agent',
  'e2e_start_codex_watcher',
  'e2e_start_kimi_watcher',
  'e2e_emit_agent_status',
])

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
