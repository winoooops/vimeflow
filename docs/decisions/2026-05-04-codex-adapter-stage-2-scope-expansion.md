# Codex Adapter Stage 2 — Scope expansion (transcript tailer + /proc as chooser + agent-PID bind)

**Date:** 2026-05-04
**Status:** Accepted
**Scope:** Three deviations from `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md` that landed during implementation on `feat/codex-adapter-stage-2-impl` and are now part of the merged Stage 2 surface. This record supersedes the relevant Non-Goals and rules in that spec for the items listed below; everything else in the spec stands.

## Context

The Stage 2 spec locked three rules:

1. **Non-Goal #2 (line 32):** "No Codex transcript tailer in v1. `tail_transcript` returns an explicit not-implemented error... activity-feed parity is a follow-up spec."
2. **/proc rule (line 123):** "/proc/&lt;pid&gt;/fd/\* as the chooser — one live codex PID can hold multiple historical rollout JSONL files open simultaneously. Linux `/proc` is fine as a _verifier_ for a chosen rollout, never as the chooser."
3. **`BindContext.pid` semantics (line 528):** built from `pty_state.get_pid(sid)` — the shell PID at the PTY root.

Implementation diverged from each on the way to landing a working Codex attach (commits `879f12a`, `65374f2`, `d27759d`):

- Codex commits its rollout JSONL file open and the `threads` row before (and sometimes well before) the corresponding `logs` row arrives. The spec's 500ms `start_for` retry budget proved too narrow under realistic conditions, leaving sessions visibly stuck on "binding…" past the user's 2s detection re-poll.
- `pty_state.get_pid(sid)` returns the shell PID, but Codex's `logs.process_uuid` indexes by the codex child PID. With the shell PID, the logs query always returned zero rows.
- A status-only Codex panel without an activity feed or test-run signals reads as broken next to the same panel for Claude. Manual testing made the disparity stark enough that shipping without it was uncomfortable.

The Stage 2 PR has been functionally verified end to end (fresh `codex` start; `codex resume`; mid-turn token_count updates; activity feed fires on `function_call` / `function_call_output`; test runs surface from `exec_command_end` / `patch_apply_end`; Claude path unchanged). The question this ADR answers is **whether to roll back the deviations to honor the spec, split them into a follow-up PR, or accept and document**.

## Options considered

1. **Roll back to spec** — revert the transcript tailer, narrow `/proc` back to verifier-only, widen the `start_for` retry budget instead, leave `BindContext.pid` as the shell PID and add a separate "agent_pid" field. Re-ship later.
2. **Split into follow-up PR** — keep the spec-aligned attach in this PR; move the transcript tailer (999 LOC), the `/proc`-chooser additions (414 LOC), and the agent-PID rewire into a second PR with its own design note.
3. **Accept and document** — ratify the deviations in this ADR, update the spec and plan to reflect what shipped, merge as one Stage 2 PR.

## Decision

Choose option 3.

The implementation landed clean (reuses `claude_code/test_runners/*` for the transcript tailer; the `/proc` paths cross-check against the `threads.rollout_path` column, so a wrong-fd choice cannot bind to a thread row that doesn't actually own the rollout; `resolve_bind_inputs` cleanly threads the detected agent PID through `start_agent_watcher` without touching any other call site). The functional payoff — activity feed parity, robust cold-start binding — outweighs the cost of holding a follow-up spec in flight. The remaining doc work to make the PR review-clean is small and self-contained, captured below as the changes this ADR mandates.

## Justification

1. **Activity-feed parity is load-bearing for Codex's user-visible UX.** Without the tailer, the panel for Codex sessions silently misses turn count, tool calls, and test results — visible regressions next to Claude. Shipping an empty activity feed and following up with a separate spec optimizes for spec discipline at the expense of the user's mental model. Ship the parity.

2. **`/proc` as a fallback chooser is constrained enough to be safe.** The implementation never returns a rollout from `/proc/<pid>/fd/*` without round-tripping through `threads WHERE rollout_path = ?`. If a stale fd points at a rollout whose `threads` row does not exist or whose `cwd` no longer matches, the path is rejected. Multi-fd disambiguation (the original concern behind the spec's "verifier-only" rule) is handled by the SQLite cross-check, not by trusting the fd list. The `/proc` path runs only when the `logs` table is empty for this PID — it does not weaken the SQLite-primary path.

3. **`BindContext.pid` was wrong, not just unspecified.** Codex's `logs` table indexes by the codex process PID, not the shell PID; the spec's choice of `pty_state.get_pid(sid)` would have made every Codex attach return zero rows on the first SQLite query. The fix is necessary for the spec to function at all, not a stylistic preference. The plan's reuse of the existing `get_pid` getter was a mistake the implementation caught.

4. **The follow-up spec for the transcript tailer would have a small, contained design surface.** The implementation reuses Claude's existing `test_runners` module wholesale (no duplication) and emits the existing `AgentToolCallEvent` / `AgentTurnEvent` types with no IPC bump. The biggest design question — what to do with `process_response_item` for Codex's specific `function_call` / `custom_tool_call` payload shapes — is in the diff today. A separate spec would re-derive that. Doc-trail debt is the better cost.

5. **Rollback would push the cold-start race into a worse spot.** Widening the `start_for` retry budget past 1s would overlap the 2000ms frontend re-poll, which the spec specifically chose to avoid (`useAgentStatus.ts:19` + spec line ~ "DETECTION_POLL_MS"). The `/proc`-driven fast-paths sidestep the budget question entirely by binding before the SQLite logs row arrives, which is the actual race we're racing.

## Alternatives rejected

### Option 1 — Roll back to spec

Rejected because: (a) the empty activity feed for Codex is a visible UX regression vs. Claude that defeats the spec's "parity with Claude's behavior" goal (spec line 16); (b) widening the `start_for` budget to handle the bind race would overlap the frontend's 2000ms re-poll, contradicting the spec's own safety margin; (c) splitting `BindContext.pid` into a separate `BindContext.agent_pid` field would leak detection details into the trait surface for marginal gain — the existing `pid` slot just needs to mean "the PID the adapter actually wants to look up", which for Codex is the agent PID.

### Option 2 — Split into follow-up PR

Rejected because the three deviations are not independent of the in-scope work:

- The `/proc`-chooser logic in `879f12a` is what makes the SQLite-primary attach robust enough to ship. Pulling it out leaves the spec-aligned attach functionally fragile under realistic codex bootstrap timing.
- The agent-PID fix in `65374f2` is required for the SQLite logs query to ever return a row. Pulling it out leaves the spec-aligned attach **non-functional** for codex.
- Only the transcript tailer in `d27759d` is genuinely separable — but at that point the PR's reviewable surface is roughly halved and the savings don't repay the split overhead.

A future engineer reverting Stage 2 wholesale because of an unrelated bug still has a single PR to revert. Splitting only `d27759d` would optimize for "could revert just the tailer" — a scenario not currently anticipated.

## Specific changes this ADR mandates

To bring the documentation in line with what shipped:

1. Spec line 32 (Non-Goal #2) — replace with: "Codex transcript tailer **landed in v1.** See `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`. Re-uses `claude_code/test_runners/*` to emit `AgentToolCallEvent` / `AgentTurnEvent` and test-run signals."
2. Spec line 123 (`/proc` rule) — revise to permit `/proc` as a chooser **when the SQLite logs path returns no rows** AND the resolved fd path is cross-checked against `threads.rollout_path`. Keep the warning that `/proc` alone (without the SQLite cross-check) must not pick the rollout.
3. Spec line 324 ("Optional Linux verifier") — rename to "Linux fast-paths" and document the three fallback strategies (`resume_thread_id_from_proc` from cmdline; `resolve_from_proc_fds` from open fds; `resolve_recent_state_candidate` from threads-table recency).
4. Spec line 528 (`BindContext` build) — change `pty_state.get_pid(sid)` to "the detected agent PID returned by `detect_agent`, not the shell PID at the PTY root".
5. Plan Task 5 (BindContext) — add a one-line note that `BindContext.pid` is the detected agent PID, with the rationale.
6. Plan Task 8 (codex skeleton) and Task 14 (CodexAdapter trait impl) — note that `transcript.rs` shipped a real tailer (not a stub) per this ADR.
7. CHANGELOG entry under Phase 4 listing the Stage 2 merge with cross-links to the spec, this ADR, and the plan.

## Known risks & mitigations

- **Risk:** A future codex CLI version stops opening rollout files via long-lived fds (e.g., switches to `O_DIRECT` or holds them only briefly). The `/proc`-chooser fast-path silently stops contributing, leaving us back on the SQLite-primary path with the original race window.
  **Mitigation:** the SQLite path is still primary; falling back to it on stale `/proc` data is the existing behavior. Add a `log::info!` in `resolve_from_proc_fds` so we can detect "/proc fd cohort is empty" in production telemetry. Spec the version range and re-test with each codex update (the existing `~/.codex/version.json` log line at adapter init is the trigger).
- **Risk:** Schema-drift dispatch in `CompositeLocator::resolve_rollout` matches on the substring `"schema drift"` in the error reason. A typo or refactor could silently disable FS fallback.
  **Mitigation:** noted as a follow-up in the next stage's tech-debt list (file: `docs/superpowers/plans/<future>.md`). The current implementation is correct; the fragility is structural. A small refactor adds a typed `LocatorError::SchemaDrift` variant and removes the substring match. Tracking, not blocking.
- **Risk:** `ValidateTranscriptError::OutsideRoot` Display message says "outside Claude directory" even when triggered by codex's `validate_transcript_path` (`agent/adapter/types.rs`). Cosmetic — log scrapers keying on the prefix get a misleading agent attribution.
  **Mitigation:** track as a one-line follow-up in the next code-review pass; rename to "outside agent root" or thread the agent name through the error.
- **Risk:** The `Mutex<Option<PathBuf>>` shared between `CodexAdapter::status_source` (writer) and `CodexAdapter::parse_status` (reader) introduces a lifecycle invariant that `parse_status` must run after `status_source` on the same instance. Contention is not the concern (single attach, infrequent writes); the concern is that `parse_status` was previously a pure function of `(sid, raw)` and is no longer.
  **Mitigation:** the `Arc<CodexAdapter>` lifetime is one attach per `for_type` call (see ADR `2026-05-03-claude-parser-json-boundary.md`'s discovery-cache reasoning), so the invariant holds by construction. Document in the `CodexAdapter` doc-comment.

## References

- `docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md` — Stage 2 spec (this ADR amends Non-Goal #2, the `/proc` rule, the optional-Linux-verifier section, and the `BindContext.pid` build).
- `docs/superpowers/plans/2026-05-04-codex-adapter-stage-2.md` — Stage 2 plan (Tasks 5, 8, 14 updated alongside this ADR).
- `docs/decisions/2026-05-03-claude-parser-json-boundary.md` — predecessor ADR, still load-bearing for the parser-internals decision.
- Implementation commits: `879f12a` (`/proc` fast-paths in locator), `65374f2` (agent-PID bind), `d27759d` (transcript tailer).
- `src-tauri/src/agent/adapter/codex/locator.rs` — `resolve_from_proc_fds`, `resume_thread_id_from_proc`, `resolve_recent_state_candidate`, `query_thread_by_rollout_path`.
- `src-tauri/src/agent/adapter/codex/transcript.rs` — `start_tailing`, `process_response_item`, `process_event_msg`.
- `src-tauri/src/agent/adapter/mod.rs` — `resolve_bind_inputs` helper.
