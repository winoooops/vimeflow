---
id: authoritative-completion-guard
category: correctness
created: 2026-06-16
last_updated: 2026-06-16
ref_count: 0
---

# Authoritative Completion Guard

## Summary

When a state machine or lifecycle tracks an in-flight operation, multiple events may arrive that *could* signal completion. Only one of them is authoritative. Adding a fallback or convenience completion path must not bypass the authoritative guard: premature finalization from a non-authoritative event can report success before the real outcome is known, hide failures, or leave downstream observers with stale active-state. Keep the authoritative event as the sole terminator for its completion mode, and make fallback paths narrowly scoped to the modes they are intended to cover.

## Findings

### 1. Preserve patch completion mode until patch_apply_end

- **Source:** github-codex-connector | PR #475 round 1 | 2026-06-16
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs` L598
- **Finding:** `process_output_completion` treated `custom_tool_call_output` as a terminal completion signal for every in-flight call, including `apply_patch` calls whose `completion_mode` is `PatchApplyEnd`. In transcripts where `custom_tool_call_output` precedes the authoritative `event_msg.patch_apply_end`, the patch was removed from `in_flight` and reported as done before the real patch status arrived, allowing a failed patch to clear the active NOW card incorrectly.
- **Fix:** Added an early return in `process_output_completion` when `is_custom_tool_output` is true and the matched call uses `CompletionMode::PatchApplyEnd`, leaving the call in `in_flight` until `process_patch_apply_end` handles the authoritative event. Added a regression test proving `custom_tool_call_output` does not finalize `apply_patch` and that a subsequent failed `patch_apply_end` still emits the correct failed status.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
