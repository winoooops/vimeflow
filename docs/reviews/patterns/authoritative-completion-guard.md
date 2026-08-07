---
id: authoritative-completion-guard
category: correctness
created: 2026-06-16
last_updated: 2026-08-07
ref_count: 10
---

# Authoritative Completion Guard

## Summary

When a state machine or lifecycle tracks an in-flight operation, multiple events may arrive that _could_ signal completion. Only one of them is authoritative. Adding a fallback or convenience completion path must not bypass the authoritative guard: premature finalization from a non-authoritative event can report success before the real outcome is known, hide failures, or leave downstream observers with stale active-state. Keep the authoritative event as the sole terminator for its completion mode, and make fallback paths narrowly scoped to the modes they are intended to cover.

## Findings

### 1. Preserve patch completion mode until patch_apply_end

- **Source:** github-codex-connector | PR #475 round 1 | 2026-06-16
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs` L598
- **Finding:** `process_output_completion` treated `custom_tool_call_output` as a terminal completion signal for every in-flight call, including `apply_patch` calls whose `completion_mode` is `PatchApplyEnd`. In transcripts where `custom_tool_call_output` precedes the authoritative `event_msg.patch_apply_end`, the patch was removed from `in_flight` and reported as done before the real patch status arrived, allowing a failed patch to clear the active NOW card incorrectly.
- **Fix:** Added an early return in `process_output_completion` when `is_custom_tool_output` is true and the matched call uses `CompletionMode::PatchApplyEnd`, leaving the call in `in_flight` until `process_patch_apply_end` handles the authoritative event. Added a regression test proving `custom_tool_call_output` does not finalize `apply_patch` and that a subsequent failed `patch_apply_end` still emits the correct failed status.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Keep exec commands pending for `exec_command_end`

- **Source:** github-codex-connector | PR #517 round 10 | 2026-06-17
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs` L634
- **Finding:** `process_output_completion` removed an in-flight `exec_command`
  call when `function_call_output` arrived, even though the authoritative
  completion event is `exec_command_end`. In rollouts where both events are
  emitted and `function_call_output` is seen first, the later
  `exec_command_end` became a no-op, so non-zero exit codes and test-run output
  could be lost and failed commands were reported as done.
- **Fix:** Generalized the existing `PatchApplyEnd` guard so that
  `process_output_completion` keeps any call whose `completion_mode` is
  `ExecCommandEnd` or `PatchApplyEnd` in `in_flight` until the matching
  authoritative end event is processed. Updated affected unit tests and added a
  regression test for `function_call_output` without an exit-code line.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. Dead exec snapshot path blocked by the ExecCommandEnd guard

- **Source:** github-claude | PR #517 round 11 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs` L628
- **Finding:** `process_output_completion` returns early whenever an in-flight
  call's `completion_mode` is `ExecCommandEnd`, keeping the call pending for the
  authoritative `exec_command_end` event. A later `ExecCommandEnd` branch, the
  corresponding arm in `output_completion_status`, the `emit_exec_test_run_snapshot`
  helper, and its supporting `exec_function_output_exit_code` parser were all
  added below that guard and therefore never executed, leaving a half-refactor
  that could mislead maintainers.
- **Fix:** Removed the unreachable `ExecCommandEnd` branch from
  `process_output_completion`, the unreachable arm from `output_completion_status`,
  and the now-unused `emit_exec_test_run_snapshot` and
  `exec_function_output_exit_code` helpers. Left `process_exec_command_end` as the
  sole authoritative path for exec snapshots.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 4. Model-side completion emitted success before authoritative process exit

- **Source:** github-claude | PR #588 round 2 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/opencode/transcript.rs`
- **Finding:** The opencode decoder treated `message.part.updated[completed]`
  as a terminal Done event even when a prior `tool.before` meant a later
  `tool.after` was expected. If the command then exited non-zero, the decoder
  emitted both Done and Failed for one tool call.
- **Fix:** Made `tool.after` the authoritative terminal source for calls with
  cached `tool.before` metadata, and retained a resolved-by-`tool.after` guard
  after metadata cleanup so delayed terminal part updates stay suppressed. Added
  regression tests for completed part updates before and after non-zero
  `tool.after`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 5. Tab completion ignored the only visible fuzzy result

- **Source:** github-claude | PR #629 round 1 | 2026-06-26
- **Severity:** MEDIUM
- **File:** `src/features/command-palette/hooks/useCommandPalette.ts`
- **Finding:** The command palette showed fuzzy matches, but Tab completion
  re-filtered those results by strict prefix before computing a completion.
  A query such as `:ft` could show `:focus-terminal` as the only actionable
  result while Tab silently did nothing.
- **Fix:** Kept prefix completion as the primary path, then fell back to the
  sole visible fuzzy result when no prefix candidates exist and the user is not
  typing args. Added a regression test for `:ft` completing to
  `:focus-terminal`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 6. Tab completion ignored multiple visible fuzzy results

- **Source:** github-codex-connector | PR #629 round 1 | 2026-06-27
- **Severity:** MEDIUM
- **File:** `src/features/command-palette/hooks/useCommandPalette.ts`
- **Finding:** Tab completion fell back to fuzzy-only results only when exactly
  one visible result remained. Queries such as `:oe` could show multiple
  actionable fuzzy matches like `:open-editor` and `:open-diff`, but pressing
  Tab did nothing even though those visible results share the useful common
  prefix `:open-`.
- **Fix:** Kept strict prefix matches as the primary candidate set, then fell
  back to all visible filtered results whenever strict prefix candidates are
  empty and the user is not typing args. The existing longest-common-prefix
  guard still no-ops when the fuzzy results do not share an extension. Added a
  regression test for `:oe` completing to `:open-`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 7. Agent replies consumed before attach succeeded

- **Source:** github-codex-connector | PR #662 round 1 | 2026-07-05
- **Severity:** P2 / MEDIUM
- **File:** `src/features/diff/hooks/useAgentReply.ts`
- **Finding:** The agent reply hook deleted a pending review handle and could
  clear the pending record even when `addAnnotationForOwner` reported
  `cap-reached`. A reply event that did not actually attach could therefore be
  treated as complete, losing the agent answer.
- **Fix:** Made successful attachment the authoritative completion signal:
  matched handles are consumed only when the add returns `ok`, and agent-authored
  annotations bypass the pending-comment cap because they are not user feedback
  awaiting dispatch. Added regression coverage for cap-blocked replies.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 8. Promoted code-mode exec finalized before authoritative process exit

- **Source:** github-codex-connector | PR #720 round 1 | 2026-07-21
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs`
- **Finding:** Code-mode `exec` calls that contained a single nested
  `tools.exec_command(...)` were promoted to the `exec_command` UI label but
  still used the generic output completion mode. A `custom_tool_call_output`
  could therefore finalize the Bash card as done before the authoritative
  `exec_command_end` event carried a non-zero exit code.
- **Fix:** Coupled promoted code-mode exec calls to `CompletionMode::ExecCommandEnd`
  so their output event is ignored until the authoritative command-end event
  arrives. Added a regression test proving a failed nested exec stays in-flight
  through `custom_tool_call_output` and emits failed on `exec_command_end`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 9. Promoted code-mode apply_patch finalized before patch_apply_end

- **Source:** github-codex-connector | PR #720 round 2 | 2026-07-21
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs`
- **Finding:** Code-mode `exec` calls that contained only a nested
  `tools.apply_patch(...)` were promoted to the `apply_patch` UI label, but
  completion-mode selection still checked the raw payload name. A
  `custom_tool_call_output` could remove the in-flight call before
  `patch_apply_end` reported the authoritative patch success or failure.
- **Fix:** Selected `CompletionMode::PatchApplyEnd` from the resolved semantic
  tool name so both direct and code-mode-promoted `apply_patch` calls wait for
  `patch_apply_end`. Added a regression test proving the promoted call remains
  pending through generic output and emits failed when `patch_apply_end` fails.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 10. OpenCode session errors left lifecycle running

- **Source:** github-codex-connector | PR #772 round 1 | 2026-08-02
- **Severity:** P1 / HIGH
- **File:** `crates/backend/src/agent/adapter/opencode/transcript.rs`
- **Finding:** OpenCode `session.error` emitted an alert while leaving `turn_active` true, even though the bridge documents that error-ending turns do not receive a later idle event.
- **Fix:** Treat `session.error` as a terminal lifecycle edge for the active OpenCode turn by clearing `turn_active` and recording Idle immediately after emitting the error notification.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 11. OpenCode status-idle completions were dropped

- **Source:** github-codex-connector | PR #784 round 1 | 2026-08-05
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/notification.rs`
- **Finding:** The notification classifier ignored OpenCode `session.status` records with `status.type == "idle"`, even though the bridge treats that as a real idle transition and some streams may not append a separate `session.idle` line.
- **Fix:** Added a status-idle completion signal that emits when assistant text is already buffered, while preserving the existing later `session.idle` path for streams where idle status arrives before final text.
- **Commit:** same commit as this entry

### 12. Live completions were rejected when registration occurred mid-turn

- **Source:** github-codex-connector | PR #788 round 1 | 2026-08-06
- **Severity:** P1 / HIGH
- **File:** `crates/backend/src/agent/notification.rs`
- **Finding:** Registrations start at EOF with `turn_active` false, so a live
  Claude Stop or OpenCode idle record was rejected when its start record
  predated watcher registration. The first background completion notification
  disappeared even though the terminal record was after the replay boundary.
- **Fix:** Initialize the completion latch as eligible at registration and
  truncation boundaries, while retaining the terminal transition back to false
  so sibling OpenCode idle records cannot double-emit. Added mid-turn coverage
  for Codex, Claude, and OpenCode.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 13. Background Kimi watcher teardown removed its completion producer

- **Source:** github-codex-connector | PR #788 follow-up | 2026-08-07
- **Severity:** P1 / HIGH
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** After a background Kimi pane captured its first agent identity,
  the auto-start owner stopped the full transcript watcher. Kimi has no
  notification-only watcher, so this also removed the relocation-following
  supervisor that emits its authoritative completion and idle events.
- **Fix:** Retain the auto-start ownership while a live Kimi pane is in the
  background, and add a regression proving its first status snapshot does not
  issue `stop_agent_watcher`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 14. Active Kimi ownership was dropped before a pane switch

- **Source:** github-codex-connector | PR #788 follow-up | 2026-08-07
- **Severity:** P1 / HIGH
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** When an active Kimi pane captured its agent identity, the
  auto-start owner was released because the active status hook temporarily
  owned the watcher. Switching panes then made that hook stop Kimi's only full
  transcript watcher, dropping authoritative completion and idle events.
- **Fix:** Track manager-retained watchers by PTY, retain Kimi ownership as soon
  as its watcher auto-starts, and make active-hook cleanup defer to that owner
  until manager terminal or unmount cleanup stops it. Added regressions for the
  ownership handoff and active-to-background pane switch.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 15. Exact-ID Kimi restart retained a watcher that never started

- **Source:** github-codex-connector | PR #788 follow-up | 2026-08-07
- **Severity:** P1 / HIGH
- **File:** `src/features/sessions/hooks/useSessionManager.ts`
- **Finding:** An exact-ID Kimi restart could commit after its pane moved to the
  background, mark the replacement PTY watcher as retained, and skip the
  attachment path because the pane already had an agent identity. No watcher
  was running to emit the authoritative completion and idle transitions.
- **Fix:** Route exact-ID Kimi restarts through the existing retrying watcher
  attachment path, which records retained ownership only after watcher startup
  succeeds. Added a regression that keeps the pane backgrounded while restart
  commits and holds watcher startup pending to verify the ownership ordering.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
