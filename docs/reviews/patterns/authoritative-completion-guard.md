---
id: authoritative-completion-guard
category: correctness
created: 2026-06-16
last_updated: 2026-06-17
ref_count: 0
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
