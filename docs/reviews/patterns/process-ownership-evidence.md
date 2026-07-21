---
id: process-ownership-evidence
category: correctness
created: 2026-07-20
last_updated: 2026-07-21
ref_count: 1
---

# Process Ownership Evidence

## Summary

Session locators and watchers often infer ownership from filesystem artifacts
whose timestamps are close to a process start. Evidence that predates the
process, even by a small clock-skew allowance, can belong to a recently exited
process in the same workspace. Treat process-created artifacts and process-
emitted diagnostics differently: creation timestamps may need slack for clock
skew, but startup diagnostics should be constrained to the live process window
so a stale session cannot bind while the new session is still materializing.

## Findings

### 1. Kimi resume evidence accepted a prior process's startup log

- **Source:** github-codex-connector | PR #715 round 1 | 2026-07-20
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/kimi/locator.rs`
- **Finding:** The resumed-session discriminator accepted any `session resume` log timestamp inside the same clock-skew window used for wire creation. A new Kimi process started shortly after a resumed process exited in the same cwd could therefore bind the previous process's persisted transcript before its own index row or wire appeared.
- **Fix:** Split resume diagnostics into their own ownership predicate that requires the timestamp to be at or after the live process start and within the process creation window. Added a regression test proving a pre-start resume entry in the slack window is rejected.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Kimi macOS process-start evidence ignored second-granularity uncertainty

- **Source:** github-codex-connector | PR #719 round 1 | 2026-07-21
- **Severity:** P1 / HIGH
- **File:** `crates/backend/src/agent/adapter/kimi/locator.rs`
- **Finding:** The macOS process-start estimate came from `ps etime`, which reports only whole seconds. Subtracting that elapsed value from fractional `SystemTime::now()` could estimate the start almost one second after the real process start, causing a resumed session's startup diagnostic in that subsecond gap to fail ownership.
- **Fix:** Wrapped platform process starts in an evidence type that keeps the precise comparison instant and a resume lower bound. macOS-derived starts now accept resume diagnostics up to one second before the estimate, while exact `/proc` starts keep the stricter lower bound.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
