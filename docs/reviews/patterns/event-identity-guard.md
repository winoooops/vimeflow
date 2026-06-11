---
id: event-identity-guard
category: backend
created: 2026-06-11
last_updated: 2026-06-11
ref_count: 0
---

# Event Identity Guard

## Summary

Events that carry an identity field for deduplication, stale-event rejection, or downstream correlation must never be emitted until that identity is populated. If the identity is derived from an external stream (transcript tail, session metadata, handshake), the emission path must be gated on a non-empty/valid identity, or the phase must be queued and flushed only after the identity arrives. Emitting with an empty or default identity silently bypasses the guard the identity was meant to enforce.

## Findings

### 1. Codex lifecycle events emitted with empty agent_session_id

- **Source:** github-codex-connector | PR #421 round 1 | 2026-06-11
- **Severity:** HIGH
- **File:** `crates/backend/src/agent/adapter/codex/transcript.rs`
- **Finding:** `CodexTranscriptDecoder` starts `codex_agent_session_id` as an empty string, emits `replay_phase` in `on_caught_up` without checking it, and `record_lifecycle` is called for `EventMsg` before any `SessionMeta` has populated the ID. If live tailing or truncated replay observes lifecycle events before `session_meta`, the frontend receives `agent_session_id: ""`, weakening the stale-event correlation guard.
- **Fix:** Guarded both live `record_lifecycle` and replay flush so lifecycle events are emitted only after `codex_agent_session_id` is non-empty.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
