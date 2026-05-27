# macOS Agent Status, Worktree Header, and Hunk Blockers

Blocker and risk log for
`docs/roadmap/macos-agent-status-worktree-hunks.md`. Keep entries precise:
state, evidence, impact, and resolution. When an entry is resolved, mark it
resolved and update the roadmap checklist that depended on it.

## Active

- [ ] **Need a live macOS Claude bridge status sample for final parity.**
      Evidence: this machine has current Codex rollout files and a Claude
      transcript file, but no local
      `<pty spawn cwd>/.vimeflow/sessions/<sid>/status.json` bridge file produced
      by a live Claude CLI invocation. The live Vimeflow process tree was
      `Vimeflow.app -> vimeflow-backend -> /bin/zsh -> claude`, and the Claude
      process had `VIMEFLOW_CLAUDE_SETTINGS`/`VIMEFLOW_STATUS_FILE` in its
      environment but no `--settings` argument in argv, proving the bash-only
      wrapper was not sourced by zsh. Impact: the source fix is now implemented and
      covered by zsh tests, but final live Claude status-bar parity still needs a
      rebuilt/restarted Vimeflow session or a user-provided bridge sample produced
      after the fix. Roadmap link: "Verify a live macOS Claude CLI invocation
      writes the bridge status file".

## Resolved

- [x] **Root cause for macOS agent-status/pane-header failure identified.**
      Evidence: `crates/backend/src/agent/detector.rs` reads Linux `/proc` paths;
      macOS lacks those paths. Impact was total loss of agent detection, watcher
      startup, status bar activation, pane agent identity stamping, and structured
      cwd bridge. Resolution: roadmap now includes platform-neutral detection and
      macOS implementation work.

- [x] **Hunk feature delivery gap identified.** Evidence:
      `src/features/diff/services/gitService.ts` desktop implementation rejects
      `stageFile`, `unstageFile`, and `discardChanges` with `not implemented`.
      Impact was Electron runtime hunk controls could not work even though the
      service interface exists. Resolution: roadmap now includes Rust/Electron IPC
      and frontend wiring work.

- [x] **Desktop hunk operations were unwired.** Evidence: added Rust git
      handlers, runtime IPC match arms, Electron method allowlist entries, and
      desktop service invokes. Backend hunk tests now stage, unstage, and discard
      individual hunks against real git repositories; runtime IPC tests verify
      `hunkIndex` decode; frontend service tests verify the Electron invoke
      payloads. Resolution: roadmap hunk wiring and hunk test items are marked
      complete.

- [x] **Rust hunk extraction initially over-applied later hunks.** Evidence:
      `test_unstage_file_inner_unstages_single_hunk` failed because extracting
      hunk index 1 included hunk index 0 in the patch prefix. Impact: any later
      hunk operation could apply too much. Resolution: `extract_hunk_patch` now
      keeps the file header fixed at the first hunk offset and slices only the
      requested hunk.

- [x] **Agent lifecycle test used Linux-only `/bin/true`.** Evidence:
      `cargo test -p vimeflow agent::` failed on macOS because the PTY fixture
      spawned `/bin/true`; this environment provides `true` at `/usr/bin/true`.
      Impact: macOS could not verify the agent adapter lifecycle suite. Resolution:
      the test fixture now chooses `/usr/bin/true` on macOS and `/bin/true`
      elsewhere; the focused agent suite passes.

- [x] **Claude bridge path quoting risk reduced.** Evidence: added and ran a
      bridge test that executes the generated statusline script with
      `VIMEFLOW_STATUS_FILE` pointing at a path containing spaces and quote
      characters. Impact: this verifies the script writes the configured status
      file without unsafe shell interpolation. Resolution: the roadmap bridge
      quoting verification item is marked complete; live Vimeflow/Claude runtime
      parity remains listed separately because no active bridge file exists on this
      machine.

- [x] **Vimeflow PTY bridge propagation verified.** Evidence: added and ran a
      `spawn_pty` test with agent bridge enabled in a cwd containing spaces and
      quote characters; the spawned shell wrote through `$VIMEFLOW_STATUS_FILE` to
      `.vimeflow/sessions/<sid>/status.json`. Impact: the remaining live blocker
      is no longer Vimeflow path/env propagation; it is specifically the external
      Claude CLI consuming the generated settings overlay.

- [x] **Generated Claude wrapper verified.** Evidence: added and ran a shell
      init test with a fake `claude` binary; sourcing the generated init script
      invoked the fake binary with `--settings "$VIMEFLOW_CLAUDE_SETTINGS"` before
      the user arguments, including with path-sensitive settings locations. Impact:
      the remaining live blocker is no longer wrapper argument injection; it is
      specifically the real Claude CLI honoring the settings overlay.

- [x] **macOS zsh wrapper gap identified and fixed in source.** Evidence: the
      live Vimeflow Claude process uses `/bin/zsh`; `ps` showed the Claude process
      inherited Vimeflow bridge env vars but did not include `--settings`, and no
      `status.json` existed in the generated bridge directory. Resolution:
      generated bridge files now include zsh startup files, `spawn_pty` sets
      `ZDOTDIR` for zsh sessions, and a regression test proves zsh wraps `claude`
      with the settings overlay.
