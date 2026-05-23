//! Attach-time context for the agent adapter.
//!
//! `AttachContext` carries the immutable facts known at the moment an agent
//! adapter is attached to a PTY session. It is constructed once in
//! `start_agent_watcher_inner` and will be threaded through the
//! adapter-binding / locator / decoder / streamer chain by later steps of
//! the refactor.
//!
//! Tracking: [#246](https://github.com/winoooops/vimeflow/issues/246)
//! (Step 0a of the `refactor/agent-adapter` v4-frozen plan).
//!
//! **Constraint (v4-frozen #5):** `initial_cwd` is a SNAPSHOT taken at
//! attach time. Runtime callers that need the live workspace cwd
//! (transcript replace, test-runner cwd resolution) MUST read it from
//! `PtyState` via the future `SessionRuntimeContext` (Step 0b), NOT from
//! `AttachContext`.

use std::path::PathBuf;
use std::time::SystemTime;

use crate::agent::types::AgentType;

/// Immutable attach-time facts. Built once per agent attach by
/// `start_agent_watcher_inner` and consumed by adapter-binding code.
///
/// Several fields (e.g. `codex_home`, `claude_home`, `proc_root`) are
/// populated up-front but unused until later refactor steps (B', C).
/// The `#[allow(dead_code)]` covers that interim — remove once every
/// field has at least one reader.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub(crate) struct AttachContext {
    /// Vimeflow PTY session id.
    pub(crate) session_id: String,
    /// CWD known at attach time. SNAPSHOT — see module-level note.
    pub(crate) initial_cwd: PathBuf,
    /// PID of the shell process the agent runs under.
    pub(crate) shell_pid: u32,
    /// PID of the detected agent process (distinct from `shell_pid`).
    pub(crate) agent_pid: u32,
    /// `SystemTime` when the PTY session started — used by Codex's
    /// locator to filter stale rows out of `logs.sqlite` / `state.sqlite`.
    pub(crate) pty_start: SystemTime,
    /// Which CLI agent is attached.
    pub(crate) agent_type: AgentType,
    /// Codex's home directory (e.g. `~/.codex`). Populated even when the
    /// attached agent is not Codex; the consumer chooses to ignore it.
    pub(crate) codex_home: PathBuf,
    /// Claude Code's home directory (e.g. `~/.claude`). Populated even
    /// when the attached agent is not Claude.
    pub(crate) claude_home: PathBuf,
    /// Filesystem path to `/proc`. Overridable for testing the Codex
    /// `/proc`-based fast-paths (`resume_thread_id_from_proc`,
    /// `open_rollout_paths_from_proc`).
    pub(crate) proc_root: PathBuf,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test: AttachContext is constructable with the full field set
    /// and field access works as expected. The semantic invariants
    /// (`agent_pid != shell_pid`, `initial_cwd` originates from PtyState,
    /// etc.) are exercised by `resolve_bind_inputs_*` tests in
    /// `adapter::mod`'s `noop_tests` module.
    #[test]
    fn attach_context_holds_all_attach_facts() {
        let attach = AttachContext {
            session_id: "sid-1".to_string(),
            initial_cwd: PathBuf::from("/workspace"),
            shell_pid: 100,
            agent_pid: 200,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::ClaudeCode,
            codex_home: PathBuf::from("/home/u/.codex"),
            claude_home: PathBuf::from("/home/u/.claude"),
            proc_root: PathBuf::from("/proc"),
        };

        assert_eq!(attach.session_id, "sid-1");
        assert_eq!(attach.initial_cwd, PathBuf::from("/workspace"));
        assert_eq!(attach.shell_pid, 100);
        assert_eq!(attach.agent_pid, 200);
        assert_ne!(attach.shell_pid, attach.agent_pid);
        assert_eq!(attach.pty_start, SystemTime::UNIX_EPOCH);
        assert!(matches!(attach.agent_type, AgentType::ClaudeCode));
        assert!(attach.codex_home.ends_with(".codex"));
        assert!(attach.claude_home.ends_with(".claude"));
        assert_eq!(attach.proc_root, PathBuf::from("/proc"));
    }

    /// Clone is needed because the attach facts get cloned into the
    /// `tokio::task::spawn_blocking` closure in
    /// `start_agent_watcher_inner`.
    #[test]
    fn attach_context_is_clone() {
        let original = AttachContext {
            session_id: "sid".to_string(),
            initial_cwd: PathBuf::from("/ws"),
            shell_pid: 1,
            agent_pid: 2,
            pty_start: SystemTime::UNIX_EPOCH,
            agent_type: AgentType::Codex,
            codex_home: PathBuf::from(".codex"),
            claude_home: PathBuf::from(".claude"),
            proc_root: PathBuf::from("/proc"),
        };

        let cloned = original.clone();
        assert_eq!(cloned.session_id, original.session_id);
        assert_eq!(cloned.agent_pid, original.agent_pid);
    }
}
