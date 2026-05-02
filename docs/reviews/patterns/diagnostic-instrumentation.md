---
id: diagnostic-instrumentation
category: code-quality
created: 2026-04-30
last_updated: 2026-04-30
ref_count: 2
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

### 4. Debug-only struct field allocated unconditionally in release builds — `cfg!()` runtime guard does not gate the storage

- **Source:** github-claude | PR #116 round 3 | 2026-04-30
- **Severity:** LOW
- **File:** `src-tauri/src/agent/watcher.rs` `WatcherHandle.session_id`
- **Finding:** The `WatcherHandle` struct stored `session_id: String` for use in a `Drop` log. The Drop body was correctly gated with `if cfg!(debug_assertions) { log::info!(...) }` — but the `cfg!()` macro is a runtime conditional that returns a bool without affecting compilation. The FIELD itself was unconditional, so `session_id: session_id.clone()` ran in release builds too, producing a heap allocation per `start_watching` call that release-build code never reads. The PR's framing was "zero release-build overhead", which the field broke.
- **Fix:** Annotated the field declaration with `#[cfg(debug_assertions)]` (a compile-time conditional that physically removes the field in release) AND mirrored the same attribute on the struct-literal assignment in the constructor. Switched the Drop body from `if cfg!(debug_assertions)` to a `#[cfg(debug_assertions)]` ATTRIBUTE on the `log::info!` statement, since `self.session_id` access must also be removed when the field is removed. Verified `cargo check --release` passes. The lesson: `cfg!()` (macro, runtime) gates code branches; `#[cfg(...)]` (attribute, compile-time) gates code existence — they are not interchangeable when the goal is to physically remove storage from a release binary.
- **Commit:** _(see git log for the round-3 fix commit)_

### 5. Structurally-zero `dt` for one-shot source produces misleading log values

- **Source:** github-claude | PR #116 round 3 | 2026-04-30
- **Severity:** LOW
- **File:** `src-tauri/src/agent/watcher.rs` `record_event_diag` + `inline_timing`
- **Finding:** The `inline_timing: Arc<Mutex<EventTiming>>` was created and passed to `record_event_diag` for the inline-init source — but inline only fires once per watcher start, so `last_event_at` was always None at the only call site, and `dt` always evaluated to `Duration::ZERO`. The log line emitted `dt=0ms source=inline` alongside real-valued dt for notify and poll. A reader investigating a freeze would compare `dt=4501ms source=notify` against `dt=0ms source=inline` and reasonably assume the inline event happened "right after" the notify event — when the truth is "this is the first and only event for this source". A constant value masquerading as a measurement is worse than no measurement.
- **Fix:** Changed the `record_event_diag` `timing` parameter type from `&Mutex<EventTiming>` to `Option<&Mutex<EventTiming>>`. notify and poll callers pass `Some(&timing)`; the inline-init caller passes `None`. When `None`, the log emits `dt=n/a` instead of computing a structurally-zero delta. The `inline_timing` allocation was removed entirely (it had been pure overhead). The lesson: a measurement field that has no meaningful value for some call sites should be optional, not always-zero — `n/a` is more honest than `0`.
- **Commit:** _(see git log for the round-3 fix commit)_

### 6. Platform-specific OS error string used as a classification key — incorrect on non-Linux platforms

- **Source:** github-codex-connector | PR #116 round 3 | 2026-04-30
- **Severity:** P2 (≈ MEDIUM)
- **File:** `src-tauri/src/agent/watcher.rs` `maybe_start_transcript`
- **Finding:** The `TxOutcome::Missing` classification depended on `e.contains("No such file")` — the Linux text for ENOENT, forwarded from `validate_transcript_path` via `format!("invalid transcript path '{}': {}", ..., io_error)`. Windows reports a missing path with different OS-localized text ("The system cannot find the file specified"), as does macOS in some locales and any non-English Linux locale. On those platforms a missing transcript would fall through the substring match and be classified as `TxOutcome::NotFile`, defeating the diagnostic during the speculative-path window it exists to capture. The "access denied" substring, by contrast, is a CUSTOM string from `validate_transcript_path` itself (not OS-localized), so it remains safe.
- **Fix:** Replaced the `e.contains("No such file")` substring match with `std::path::Path::new(transcript_path).exists()`. Linux ENOENT, Windows ERROR_FILE_NOT_FOUND, macOS in any locale, and any future OS variant now classify uniformly as `TxOutcome::Missing`. Comment near the call site explains why the missing case uses path-existence (platform-neutral) while the access-denied case keeps substring matching (project-owned string). The lesson: when classifying errors that originate from the OS, use platform-neutral primitives like `Path::exists()` / `ErrorKind::NotFound`, not substring matching on forwarded error text.
- **Commit:** _(see git log for the round-3 fix commit)_

### 7. Detached `JoinHandle` swallows test-thread panics, obscuring failure attribution

- **Source:** github-claude | PR #124 round 2 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/git/watcher.rs`
- **Finding:** `spawn_trailing_debounce_thread` calls `std::thread::spawn(...)` and discards the returned `JoinHandle`. In production the emit closure only calls `emit_for_all_subscribers`, which logs errors rather than panicking, so the swallowed-panic path is unreachable. In tests, however, the closure was `move || { emitted_tx.send(()).expect("failed to record debounce emit"); }` — and if the receiver dropped first (test cleanup ordering races), `.expect` would panic inside the detached thread. The panic was invisible: the next test assertion (`recv_timeout(...).expect("debounce should emit")`) would fire instead, attributing the failure to "no emit" when the real cause was "the emit closure panicked." Same finding-class as #5 (structurally-zero `dt` produces misleading log values) — both are diagnostics that point an investigator at the wrong cause.
- **Fix:** Tests now use `let _ = emitted_tx.send(())` instead of `.expect(...)`, swallowing send errors so the detached thread can never panic. The positive `recv_timeout(...).expect("debounce should emit")` assertion remains the canonical failure signal, with no false-attribution interference from the worker thread. Returning the `JoinHandle` and exposing it for tests was considered but rejected: the fire-and-forget API is the right shape for production callers, and `catch_unwind` machinery would be heavy for the low-risk scenario.
- **Commit:** _(see git log for the round-2 fix commit)_
