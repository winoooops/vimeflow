# Codex agent-status watcher relocation - Chinese note

**Date:** 2026-06-20
**Issue:** [VIM-188](https://linear.app/vimeflow/issue/VIM-188/codex-agent-status-sidebar-freezes-after-clear-or-resume-watcher)
**Status:** supporting note

The original visual HTML explainer is intentionally kept with the Linear issue
instead of in this repository. This file preserves the decision summary in a
token-efficient form; the authoritative implementation spec is
[`docs/superpowers/specs/2026-06-20-codex-watcher-relocate-design.md`](../superpowers/specs/2026-06-20-codex-watcher-relocate-design.md).

## Summary

Codex agent-status can freeze after `/clear` or in-session `resume` because the
backend watcher is pinned to the old rollout file. The process stays alive, but
Codex writes the new conversation to a different rollout, so the old watcher no
longer emits useful status events.

## Confirmed Cause

- The watcher resolves `target_path` once at attach time and keeps reading that
  file.
- `/clear` and in-session `resume` keep the same PID while moving to a new
  rollout.
- The frontend restarts the watcher only when the detected agent PID changes.
- Claude Code self-heals because its statusline updates carry a dynamic
  transcript path; Codex only provides a static transcript hint.

## Fix Direction

- Reattach by re-invoking the existing `start_agent_watcher(ptyId)` path.
- Let the backend perform its existing locate, spawn, and atomic watcher
  replacement sequence; do not stop then start from the frontend.
- Make open rollout file descriptors authoritative for Codex relocation, with
  `resume` argv and sqlite recency only as fallback when the provider runs
  successfully and finds no open rollout FD.
- Preserve the distinction between provider failure and an empty provider result
  so the UI does not report a false recovery.
- On `/clear`, keep the stale indicator until a fresh `agent-status` event proves
  recovery.
- For in-session `resume`, use periodic drift re-location only for the active
  live Codex pane, relying on backend idempotence when the rollout is unchanged.

## Key Risk

macOS cannot rely on Linux `/proc`, so the open-FD provider must support
`lsof -p <pid> -Fn` with bounded execution and explicit failure handling.

## References

- Linear umbrella issue: [VIM-188](https://linear.app/vimeflow/issue/VIM-188/codex-agent-status-sidebar-freezes-after-clear-or-resume-watcher)
- Implementation spec:
  [`2026-06-20-codex-watcher-relocate-design.md`](../superpowers/specs/2026-06-20-codex-watcher-relocate-design.md)
