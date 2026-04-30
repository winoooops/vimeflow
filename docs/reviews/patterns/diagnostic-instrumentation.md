---
id: diagnostic-instrumentation
category: code-quality
created: 2026-04-30
last_updated: 2026-04-30
ref_count: 0
---

# Diagnostic Instrumentation

## Summary

Runtime diagnostic logs (timing, counters, state-tracking) are only as
useful as their _accuracy_. A diagnostic that measures inconsistently
across sources, doesn't reset state on natural break points, or captures
its values at the wrong moment in a lifecycle silently produces
misleading numbers — and the investigator who relies on them draws
wrong conclusions about the system. A wrong diagnostic is worse than no
diagnostic, because it adds confidence to bad reasoning.

The discipline:

- **Equivalent measurement across sources.** When the same metric is
  recorded from multiple call paths, capture timing/identity at the
  same logical moment in each — usually before any I/O or state lookup
  the metric is meant to cover.
- **Reset state on natural break points.** Per-source counters and
  identity caches should reset when the underlying observation breaks
  (a no-path event, a session boundary, a stop/restart) — otherwise
  consecutive-occurrence counters span across breaks and report
  streaks that don't exist.
- **Capture at the right moment in the lifecycle.** Counts and totals
  should be sampled at the lifecycle phase that makes the metric
  semantically true. If the metric represents "active watchers from
  OTHER sessions", capture it AFTER `state.remove(self)`.

## Findings

### 1. Timer placed after I/O for one source, before for others — total non-comparable across sources

- **Source:** github-claude | PR #116 round 1 | 2026-04-30
- **Severity:** MEDIUM
- **File:** `src-tauri/src/agent/watcher.rs` (poll-fallback thread)
- **Finding:** The notify callback and the inline-init read both captured `let started = Instant::now()` BEFORE their respective `std::fs::read_to_string` calls, so `total` for `"notify"` and `"inline"` events included file-I/O time. The poll-fallback thread captured `started` AFTER its `read_to_string` and the dedup-equality check, so `total` for `"poll"` events systematically excluded I/O. On WSL2 / virtio-fs a 40 ms read would push notify/inline over the 50 ms `watcher.slow_event` threshold while poll would still log `total=2ms` for an identical operation — making poll appear fast even when the I/O bottleneck is shared. Since the diagnostic exists specifically to identify cross-source slow events, a systematic bias in one source's measurement undermines the primary signal.
- **Fix:** Moved `let started = Instant::now();` to the top of each iteration in the poll thread, BEFORE `read_to_string`. The dedup-skip `continue` paths short-circuit before `record_event_diag`, so unchanged-content polls still don't log a number — no noise. Comment explains why the I/O is now inside `total`. All three sources now measure the same thing.
- **Commit:** _(see git log for the round-1 fix commit)_

### 2. Counter not reset on the natural break event — counts streaks across an interlude

- **Source:** github-codex-connector | PR #116 round 1 | 2026-04-30
- **Severity:** P2 (≈ MEDIUM)
- **File:** `src-tauri/src/agent/watcher.rs` `record_event_diag` `(None, _)` arm
- **Finding:** The transcript-path-tracking match in `record_event_diag` handled three explicit cases (different path, first observation, same path) and a catch-all `(None, _)` arm that returned `None` without touching `last_tx_path` or `same_path_repeat`. So when an event had no `transcript_path` field, the previous path's identity and repeat counter persisted untouched. A sequence like `[tx_path=A, no-path-event, tx_path=A]` would log the second A with `repeat=2` (treated as a consecutive observation) — even though there was a no-path interlude that should have broken the streak. This is precisely the speculative/missing-path window the patch was meant to diagnose, and the misleading repeat count makes that diagnosis harder.
- **Fix:** In the `(None, _)` arm, reset `last_tx_path = None` and `same_path_repeat = 0` so the next path-bearing event is treated as a fresh observation (path-change fires, repeat starts at 1). Comment captures the reasoning so future maintainers don't undo the reset thinking it's a no-op.
- **Commit:** _(see git log for the round-1 fix commit)_

### 3. Count captured at wrong lifecycle phase — restarting same session inflates the metric

- **Source:** github-codex-connector | PR #116 round 1 | 2026-04-30
- **Severity:** P2 (≈ MEDIUM)
- **File:** `src-tauri/src/agent/watcher.rs` `start_agent_watcher`
- **Finding:** The `Starting agent watcher: ... active_watchers={}` log captured `state.active_count()` BEFORE the call to `state.remove(&session_id)` that drops any existing watcher for the same session. So restarting an already-active session would log an inflated count that includes the about-to-be-removed self-watcher. Since the diagnostic uses this count as a leak signal (high counts = old watchers from prior sessions still alive), false positives during normal restart flows directly undermine its purpose.
- **Fix:** Reordered the function: `state.remove(&session_id)` now runs BEFORE the `log::info!` call, so the logged count reflects watchers from OTHER sessions only — the actually-useful leak signal. Comment explains the ordering invariant so future contributors don't innocently move the log back to the top of the function.
- **Commit:** _(see git log for the round-1 fix commit)_
