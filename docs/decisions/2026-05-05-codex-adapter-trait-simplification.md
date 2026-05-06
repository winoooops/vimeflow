# Codex adapter trait simplification - collapse BindContext + retry into CodexAdapter

**Date:** 2026-05-05
**Status:** Accepted
**Scope:** Round-3 review on PR #154 flagged that `BindContext` and the bounded retry inside `base::start_for` leak codex-only requirements through the `AgentAdapter` trait surface. This ADR records the decision to move both pieces into `CodexAdapter` itself, supersedes parts of the Stage 2 spec, and inherits the three deviations recorded in the 2026-05-04 scope-expansion ADR.

**Predecessors (still load-bearing):**

- [`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`](../superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md) - Stage 2 spec.
- [`docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`](./2026-05-04-codex-adapter-stage-2-scope-expansion.md) - Stage 2 deviations (transcript tailer, `/proc` fast-paths, agent-PID bind).

**Spec mandating this ADR:** [`docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md`](../superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md).

## Context

Stage 2 (PR #154) introduced `BindContext { session_id, cwd, pid, pty_start }` as the parameter to `AgentAdapter::status_source`, plus a bounded retry inside `base::start_for` that loops on `BindError::Pending` for up to 5 x 100ms = 500ms. Both pieces existed solely to support codex's SQLite-logs cold-start race (the `logs` row arrives ~300ms after the rollout file opens). Claude's adapter ignores `pid`/`pty_start` and never returns `Pending`. Round-3 review on PR #154 ([discussion_r3181677311](https://github.com/winoooops/vimeflow/pull/154#discussion_r3181677311), [discussion_r3181691871](https://github.com/winoooops/vimeflow/pull/154#discussion_r3181691871)) called the leak out as a finding, not a stylistic preference.

## Options Considered

1. **Leave as-is** - accept the trait-surface leak.
2. **Move `pid`/`pty_start` to the codex adapter, keep the bounded retry in `base::start_for`** - half-fix.
3. **Move both pieces into `CodexAdapter` itself** - this ADR's choice.

## Decision

Choose option 3.

The trait method becomes `status_source(&self, cwd: &Path, session_id: &str) -> Result<StatusSource, String>`. `BindContext` and `BindError` are deleted from `agent/adapter/types.rs`. `CodexAdapter` gains `pid`, `pty_start`, and `codex_home` fields plus a `retry_locator` helper that runs the cold-start race privately. `base::start_for` becomes a single-call orchestrator with zero retry/sleep code. The factory renames from `for_type(agent_type)` to `for_attach(agent_type, pid, pty_start)`.

## Justification

1. **Single responsibility.** The trait describes what an agent adapter does; codex's cold-start race is how the codex adapter does it, not part of the contract.
2. **Future adapters.** Aider, Generic, and other adapters should not need to learn about `BindContext` to implement `status_source`.
3. **Calibration locality.** The retry budget (5 x 100ms) is calibrated against codex-specific commit timings; it does not generalize. Hosting it inside the codex adapter keeps the calibration close to the rationale.
4. **Pure internal refactor.** No IPC, no user-visible behavior change, no scope expansion. Sleep budget shrinks marginally (5 x 100ms to 4 x 100ms because the final-attempt sleep is skipped), still well under the 500ms safety margin.

## Alternatives Rejected

### Option 1 - Leave as-is

Rejected because round-3 review explicitly flagged the leak as a finding, not a stylistic preference. The cost of the leak grows with each new adapter.

### Option 2 - Half-fix

Rejected because the retry budget still has nowhere coherent to live. `base::start_for` would still be branching on a `Pending`/`Fatal` distinction that only one adapter ever produces. The trait surface would be cleaner but the orchestration layer would carry a codex-shaped contract.

## Known Risks & Mitigations

- **Risk:** A second adapter eventually needs the same retry shape and re-introduces a parallel-but-divergent retry helper.
  **Mitigation:** The `retry_locator` helper is internal to codex and small; if a second adapter needs the same shape, promote a generic `retry_with_budget` to a shared `agent/adapter/util.rs` at that point.

- **Risk:** Sleep-budget tightening from 5 x 100ms to 4 x 100ms is a real behavior change.
  **Mitigation:** The cold-start window is typically ~300ms (per the 2026-05-04 ADR's `/proc` fast-path rationale), well below 400ms. The exhaustion path rarely fires in practice, and the 500ms safety margin against the 2000ms detection re-poll is preserved.

## References

- Issue [#156](https://github.com/winoooops/vimeflow/issues/156).
- PR [#154](https://github.com/winoooops/vimeflow/pull/154) - Stage 2 implementation.
- Round-3 review threads: [r1](https://github.com/winoooops/vimeflow/pull/154#discussion_r3181677311), [r2](https://github.com/winoooops/vimeflow/pull/154#discussion_r3181691871).
- 2026-05-03 spec: [`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`](../superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md).
- 2026-05-04 ADR: [`docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`](./2026-05-04-codex-adapter-stage-2-scope-expansion.md).
- 2026-05-05 spec: [`docs/superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md`](../superpowers/specs/2026-05-05-codex-adapter-trait-simplification-design.md).
