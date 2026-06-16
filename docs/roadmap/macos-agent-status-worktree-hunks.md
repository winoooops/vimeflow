# macOS Agent Status, Worktree Header, and Hunk Roadmap

Tracking file for the macOS delivery work requested on 2026-05-26. Keep this
list current whenever implementation or verification changes. Cross-reference
`docs/roadmap/macos-agent-status-worktree-hunks-blockers.md` before marking a
step complete.

## Findings

- [x] Confirmed the current agent detector is Linux-only: `detector.rs` reads
      `/proc/<pid>/task/<pid>/children` and `/proc/<pid>/cmdline`. macOS has no
      compatible procfs, so `detect_agent_in_session` returns no live agent.
- [x] Confirmed both requested UI failures share that dependency:
      `useAgentStatus` only starts the watcher after detection succeeds, and
      `WorkspaceView` only stamps pane agent type / cwd when `agentStatus.isActive`
      is true.
- [x] Confirmed Claude Code status source is Vimeflow-owned:
      `<pty spawn cwd>/.vimeflow/sessions/<pty session id>/status.json`;
      transcript paths reported inside that file are validated under `~/.claude`.
      The live macOS sample showed a session spawned in `~` and later `cd`'d into
      the repo, so the bridge path stayed under `~/.vimeflow` while `PWD` became
      `/Users/winoooops/projects/vimeflow`.
- [x] Confirmed Codex status source is Codex-owned:
      `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, resolved primarily through
      schema-discovered SQLite DBs under `~/.codex`.
- [x] Confirmed Kimi Code status source is Kimi-owned:
      `~/.kimi-code/session_index.jsonl` resolves the active cwd to a session
      directory, and `agents/main/wire.jsonl` is both the status and transcript
      source. The detector must match both `kimi` and `kimi-code`.
- [x] Confirmed Codex Linux implementation has `/proc` fast paths:
      resume argv and open rollout fd discovery. These are not portable to macOS
      without a Darwin process source or a non-proc fallback.
- [x] Confirmed hunk operations are not delivered in the desktop path:
      `DesktopGitService.stageFile`, `unstageFile`, and `discardChanges` still
      reject with `not implemented`.

## Agent Adapter Lifecycle Audit

- [x] Frontend detection entry:
      `useAgentStatus(activePanePtyId)` polls `detect_agent_in_session` with the
      PTY id from `ptySessionMap`. No watcher starts until detection returns an
      `AgentDetectedEvent`.
- [x] Backend detection entry:
      `detect_agent_in_session_inner` reads the PTY root process id from
      `PtyState::get_pid` and calls `detector::detect_agent`.
- [x] Process-tree walk:
      the detector checks the PTY root and all descendants, then maps argv[0]
      binary names: `claude` -> `ClaudeCode`, `codex` -> `Codex`, `kimi` /
      `kimi-code` -> `Kimi`, and `aider` -> `Aider`.
- [x] Watcher start:
      after detection succeeds, `useAgentStatus` invokes `start_agent_watcher`.
      The backend re-detects server-side in `resolve_bind_inputs` so the frontend
      cannot spoof the agent type.
- [x] Adapter selection:
      `AgentBindings::for_attach` returns `ClaudeCodeAdapter` for Claude Code,
      `CodexAdapter` for Codex CLI, `KimiAdapter` for Kimi Code, and `NoOpAdapter`
      for unsupported agents.
- [x] Shared watcher runtime:
      `base::start_for` resolves a provider `StatusSource`, validates it under the
      provider trust root, reads it inline, watches it through notify plus polling,
      emits `agent-status`, and starts/replaces the transcript tailer when the
      parsed status reports a transcript path.
- [x] Claude Code status source:
      `ClaudeCodeAdapter::status_source` points at
      `<pty spawn cwd>/.vimeflow/sessions/<pty session id>/status.json`. This is a
      Vimeflow bridge file, not Claude's own database. The app creates the bridge
      directory when spawning PTYs with the agent bridge enabled; later shell `cd`
      or transcript `agent-cwd` changes do not move this bridge path.
- [x] Claude Code transcript source:
      the status JSON can report a transcript path, and
      `claude_code::transcript::validate_transcript_path` canonicalizes it under
      `~/.claude`. The transcript tailer emits tool calls, test runs, turn counts,
      `agent-cwd`, and `agent-session-title`.
- [x] Codex status source:
      `CodexAdapter::status_source` resolves a rollout JSONL under
      `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. It discovers the SQLite DBs
      by schema under `~/.codex`, not by fixed filename suffix.
- [x] Codex primary bind:
      the logs DB maps `process_uuid LIKE pid:<agent_pid>:%` to a thread id after
      the PTY start time; the state DB maps that thread id to `rollout_path`.
- [x] Codex fallback bind:
      Linux may bind early through resume argv or open rollout fds under `/proc`,
      but those paths fail soft. When logs are not ready, the recent-state
      heuristic can still choose a single current `threads` row matching cwd/start
      time; schema drift falls back to scanning recent rollout files.
- [x] Codex transcript source:
      the rollout file is both status source and transcript source. Status parsing
      folds `session_meta`, `turn_context`, and `event_msg`; transcript parsing
      emits tool calls, test runs, turns, `agent-cwd`, and title sync from
      `session_index.jsonl`.
- [x] Kimi Code transcript source:
      `agents/main/wire.jsonl` is both status source and transcript source.
      Status parsing folds `metadata`, `config.update`, and `usage.record`;
      transcript parsing emits turns, lifecycle, tool calls, cwd, and sub-agent
      activity from sibling `agents/<subagent>/wire.jsonl` files. Kimi plan-usage
      fetching is opt-in because it calls the Kimi API with the user's configured
      credential.
- [x] Pane header worktree reflection:
      transcript `agent-cwd` updates `agentStatus.cwd`; `WorkspaceView` mirrors it
      into `pane.cwd` only while the agent is active; `TerminalPane` then runs
      `useGitWorktree(pane.cwd)` and `useGitBranch(pane.cwd)` to render the chip.
- [x] Bottom status bar:
      `WorkspaceView` computes `isStatusBarAgentActive` from active pane PTY id,
      `agentStatus.sessionId`, `agentStatus.isActive`, and session status. If
      detection fails, the status bar intentionally suppresses agent segments.

## Linux vs macOS Differences To Handle

- [x] Process children: Linux reads `/proc/<pid>/task/<pid>/children`; macOS
      must use Darwin process inspection (`libproc`/`sysctl`) or a bounded command
      fallback such as `pgrep -P`.
- [x] Process argv: Linux reads null-separated `/proc/<pid>/cmdline`; macOS
      must use Darwin process inspection or a bounded command fallback such as
      `ps -p <pid> -o command=`.
- [x] Open file descriptors: Linux reads `/proc/<pid>/fd/*`; macOS has no
      equivalent procfs path. Codex binding must not depend on fd discovery on
      macOS.
- [x] Claude transcript root: both Linux and macOS should resolve
      `~/.claude`; the risk is path canonicalization and spaces in home/workspace
      paths, not a different root.
- [x] Codex session root: both Linux and macOS should resolve `~/.codex`; the
      risk is schema drift and the loss of Linux fd fast paths, not a different
      root.
- [x] Codex SQLite path discovery: Linux and macOS both scan `~/.codex` for
      `.sqlite` files containing `logs` and `threads` tables. Numeric suffixes such
      as `logs_2.sqlite` and `state_5.sqlite` are not stable contracts.
- [x] Codex rollout path parsing: Linux and macOS share the
      `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` shape. The current parser
      ignores `turn_context.cwd` because observed Codex rollouts pin it to the
      session-start cwd; mid-session worktree movement comes from
      `response_item.payload.arguments.workdir` for `exec_command`.
- [x] Kimi Code session binding: Linux can use proc-derived process context when
      available; macOS falls back to `~/.kimi-code/session_index.jsonl` and the
      cwd hash bucket. Two same-cwd Kimi sessions can still be ambiguous on macOS
      without a stronger Darwin process source.
- [x] Claude bridge path parsing: Linux and macOS share the
      `<pty spawn cwd>/.vimeflow/sessions/<sid>/status.json` bridge path. The
      macOS risk is not a different Claude root; it is whether the PTY spawn path
      creates the bridge directory in workspaces with spaces/symlinks and whether
      the Claude statusline script writes the same path.
- [x] Claude bridge path quoting: the generated statusline script now has test
      coverage that executes the script with `VIMEFLOW_STATUS_FILE` pointing at a
      status path containing spaces and quote characters, proving the bridge write
      path does not depend on unsafe shell interpolation.
- [x] Claude bridge PTY propagation: `spawn_pty` now has test coverage that
      enables the agent bridge in a cwd containing spaces and quote characters,
      then writes through the spawned shell to `$VIMEFLOW_STATUS_FILE` and verifies
      the expected `.vimeflow/sessions/<sid>/status.json` file is created.
- [x] Claude wrapper injection: the generated shell init now has test coverage
      with a fake `claude` binary proving `claude ...` is rewritten to
      `command claude --settings "$VIMEFLOW_CLAUDE_SETTINGS" ...`, including when
      the settings path contains spaces and quote characters.
- [x] Live macOS Claude sample root cause: the running Vimeflow session uses
      `/bin/zsh`, and the live `claude --dangerously-skip-permissions` process had
      `VIMEFLOW_CLAUDE_SETTINGS`/`VIMEFLOW_STATUS_FILE` in its environment but no
      `--settings` argument in argv. That proves the bash-only `BASH_ENV` injection
      did not install the wrapper for zsh, so Claude never ran the generated
      statusline command.
- [x] Shell command paths in tests differ: `/bin/true` is not guaranteed on
      macOS; this blocked the adapter lifecycle suite until the fixture used
      `/usr/bin/true` on macOS.
- [x] Verify actual Codex macOS rollout shape against local files:
      `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` uses top-level
      `payload`/`timestamp`/`type` entries with `session_meta`, `turn_context`,
      `event_msg`, and `response_item` event types; current cwd transitions are
      present through `response_item` exec workdir arguments.
- [x] Verify actual Claude macOS transcript shape against local files:
      `~/.claude/projects/.../*.jsonl` entries include `cwd`, `gitBranch`,
      `message`, `sessionId`, `timestamp`, `type`, `uuid`, and `version`.
- [ ] Verify a live macOS Claude CLI invocation writes the bridge status file
      at `<pty spawn cwd>/.vimeflow/sessions/<sid>/status.json` after rebuilding
      or restarting Vimeflow with the zsh wrapper fix. The Vimeflow PTY/env path
      and wrapper path are now covered by tests; this remaining item is
      specifically the external Claude CLI honoring the generated `--settings`
      overlay and running its statusline command.

## macOS Failure Suspicions

- [x] Primary confirmed suspicion: agent detection failed before any adapter
      lifecycle started because the detector required Linux `/proc`.
- [x] Confirmed knock-on suspicion: pane header worktree chips failed because
      structured `agent-cwd` is emitted only after the watcher starts, and watcher
      startup was gated by detection.
- [x] Codex-specific suspicion: Linux fd fast paths cannot work on macOS.
      Resolution: they are optional; macOS must rely on SQLite/recent-state/FS-scan
      binding. This is covered by tests but still needs live Codex verification for
      current CLI versions.
- [x] Claude-specific suspicion: status source is a Vimeflow bridge file under
      the PTY spawn cwd, so macOS path failures are most likely shell startup
      injection, bridge creation, canonicalization, or path quoting issues rather
      than a different Claude transcript root. The live sample confirmed shell
      startup injection was the failing piece for zsh.
- [x] Hunk-specific suspicion: Electron production had no Rust/IPC path while
      Vite dev did. Resolution: desktop hunk commands now use Rust git handlers.

## Implementation Plan

- [x] Read existing agent adapter, cwd, worktree, and hunk design docs.
- [x] Create this maintained roadmap and the matching blocker log.
- [x] Add a platform-neutral process-inspection abstraction for agent
      detection.
- [x] Preserve current Linux `/proc` implementation behind the abstraction.
- [x] Add macOS detection support for descendant process traversal and argv
      matching (`claude`, `codex`, `aider`).
- [x] Review Codex locator macOS behavior: Linux `/proc` fast paths already
      fail soft when `/proc` is absent, and the SQLite/recent-state/FS-scan paths
      remain available for macOS binding.
- [x] Re-check Claude Code watcher lifecycle after macOS detection works:
      detection -> adapter selection -> status source -> transcript validation ->
      `agent-status`/`agent-cwd`/`agent-session-title` events.
- [x] Re-check Codex watcher lifecycle after macOS detection works:
      detection -> adapter selection -> rollout location -> status parse ->
      transcript tail -> `agent-cwd` worktree transitions.
- [x] Wire desktop hunk operations through Electron IPC and Rust git handlers.
- [x] Ensure hunk patch extraction uses current raw git unified diff text, not
      a re-rendered or Pierre-derived approximation.
- [x] Verify pane header worktree reflection after structured `agent-cwd`
      events update `pane.cwd` and `useGitWorktree`/`useGitBranch` refresh.

## Verification Checklist

- [x] Rust unit tests cover detector behavior through the injectable process
      source and the current platform command-line reader.
- [x] Add Linux-only procfs coverage for the retained `/proc` child reader.
      This machine cannot run the Linux-only test, but the coverage is present
      behind `#[cfg(target_os = "linux")]`.
- [x] Run macOS process-reader coverage against real spawned shell child
      processes through the `pgrep -P` and `ps -p -o command=` paths.
- [x] Run Claude bridge script coverage against status paths containing spaces
      and quote characters.
- [x] Run PTY-level Claude bridge coverage proving `spawn_pty` propagates the
      bridge environment into a real shell and the shell can write
      `.vimeflow/sessions/<sid>/status.json`.
- [x] Run shell-wrapper coverage proving the generated `claude` function passes
      `--settings "$VIMEFLOW_CLAUDE_SETTINGS"` through to the underlying binary.
- [x] Run zsh startup coverage proving macOS default zsh reads the generated
      bridge startup files and wraps `claude` with the settings overlay.
- [x] Rust tests cover Codex locator behavior when proc fast paths are absent
      or not decisive via the recent-state heuristic.
- [x] Frontend tests cover agent status bar visibility for detected Claude and
      Codex sessions.
- [x] Frontend tests cover `agent-cwd` updating pane cwd and header metadata.
- [x] Frontend service tests cover desktop stage, unstage, and discard invoke
      calls, including hunk indexes.
- [x] Runtime IPC tests cover `stage_file`, `unstage_file`, and `discard_file`
      camelCase `hunkIndex` decoding and whole-file payload decoding.
- [x] Backend tests cover per-hunk stage, unstage, and discard behavior against
      real git repositories.
- [x] Run targeted test suites for agent, terminal header/worktree, and diff
      hunk behavior.
- [ ] If approved on this machine, manually verify macOS Electron runtime with
      a live Claude Code or Codex PTY session.

## References

- `crates/backend/src/agent/README.md`
- `docs/superpowers/specs/2026-04-12-agent-status-sidebar/`
- `docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md`
- `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`
- `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`
- `docs/superpowers/specs/2026-05-19-live-head-branch-worktree-design.md`
- `docs/superpowers/specs/2026-05-22-codex-transcript-cwd-parser-design.md`
- `docs/superpowers/specs/2026-05-24-pierre-diffs-integration-design.md`
