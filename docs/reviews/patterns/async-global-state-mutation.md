---
id: async-global-state-mutation
category: backend
created: 2026-06-19
last_updated: 2026-06-19
ref_count: 0
---

# Async Global State Mutation

## Summary

Mutating process-wide state (environment variables, global registries, static
configuration) around an `.await` is a concurrency hazard in async Rust: other
Tokio tasks or background threads can observe the temporary value while the
current task is yielded. Prefer threading hermetic values explicitly through the
call chain so helper code stays local and deterministic, especially in E2E and
test fixtures that need isolated homes or configs.

## Findings

### 1. E2E watcher helpers mutate process-wide env vars across await

- **Source:** github-codex-connector | PR #563 round 1 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `crates/backend/src/runtime/state.rs`
- **Finding:** `e2e_start_codex_watcher` and `e2e_start_kimi_watcher` set `HOME` / `KIMI_CODE_HOME`, awaited `start_agent_watcher`, then restored the variable. In the E2E backend process, other Tokio tasks or background threads could run during that window and observe the temporary home, causing flaky watcher setup or incorrect path resolution outside the intended test helper.
- **Fix:** Added `provider_home_override: Option<PathBuf>` to `AttachContext` and threaded it through `start_agent_watcher` / `start_agent_watcher_inner` / `SessionLifecycle::start` / `resolve_bind_inputs`. The Codex and Kimi binding arms now prefer the explicit override over registry-resolved `provider_home` (and, for Kimi, over `$KIMI_CODE_HOME`). The E2E helpers pass the hermetic home directly instead of mutating process-wide environment variables.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
