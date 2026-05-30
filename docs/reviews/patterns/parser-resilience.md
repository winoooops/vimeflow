---
id: parser-resilience
category: code-quality
created: 2026-05-24
last_updated: 2026-05-30
ref_count: 2
---

# Parser Resilience

## Summary

When migrating a permissive parser (e.g. `serde_json::Value` pull-style
extraction) to a typed-DTO shape, the strict-by-default behavior of
`#[derive(Deserialize)]` quietly erases the "partial / wrong-typed
input still parses something" property of the original. Catch this on
every leaf field AND every nested-struct field separately — the two
have different deserialization paths and different attribute fixes.

For each leaf scalar field:

- Use `#[serde(default)]` so `null` / missing maps to the type's
  `Default` (typically `None` if wrapped in `Option<T>`).
- Use `#[serde(deserialize_with = "lenient_T")]` so a wrong-typed
  present value (e.g. a JSON string where `u64` was expected) yields
  `None` instead of erroring the whole document.

For each nested-struct field:

- The above is **not enough**. `#[serde(default)]` still only handles
  missing/null at the outer position; a present-but-wrong-type value
  (`"context_window": 42`) makes the struct deserialize fail and
  poisons the parent document.
- Use `#[serde(deserialize_with = "lenient_object")]` (or equivalent)
  to mirror the per-field tolerance at the nested-struct boundary:
  materialize the value, check `is_object()`, then re-decode into the
  target type.

## Findings

### 1. Strict nested-struct deserialization silently dropped status events on wrong-typed sub-blocks

- **Source:** github-claude + github-codex-connector | PR #257 | 2026-05-24
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/claude_code/statusline.rs`, `crates/backend/src/agent/adapter/codex/parser.rs`
- **Finding:** Step A-status's initial DTO migration covered scalar
  wrong-type tolerance via `lenient_u64` / `lenient_f64` /
  `lenient_string` but missed nested struct fields. `ClaudeStatusDto`'s
  nested fields (`model`, `context_window`, `cost`, `rate_limits`,
  `current_usage`, `five_hour`, `seven_day`) and the equivalent Codex
  positions (`info`, `rate_limits`, `last_token_usage`, `primary`,
  `secondary`) were all `Option<NestedDto>` with only `#[serde(default)]`.
  Behavioral regression vs. pre-A-status `is_some_and(Value::is_object)`
  guards: a present-but-wrong-type sub-block (`"context_window": 42`,
  `"rate_limits": []`) made the entire `parse_statusline` return
  `Err`, and the watcher's `parse_status` match arm mapped that to
  `TxOutcome::ParseError` — dropping the whole status event. For
  Codex it was lower severity because `parse_rollout` already catches
  per-line Err and skips, but the same `token_count` event still lost
  its sibling rate-limit / token-usage data.
- **Fix:** Added a third helper `lenient_object<T: DeserializeOwned>`
  to `serde_helpers.rs` paralleling the scalar helpers:
  materialize via `Value::deserialize`, check `is_object()`, then
  `serde_json::from_value::<T>` (inner field-level helpers ensure
  this succeeds for any object). Wrong-type / non-object → `Ok(None)`,
  matching the scalar helpers' "wrong shape becomes a missing block"
  contract. Applied at every nested-struct field listed by Claude +
  codex connector. Three new parse-entry regression tests pin
  per-block degradation; one for the Codex side proves wrong-typed
  `info` preserves prior token state AND lets sibling `rate_limits`
  on the same line still fold (per-field degradation, not whole-line
  drop). **Heuristic:** when migrating a `serde_json::Value`-based
  parser to typed DTOs, treat scalar leniency and nested-struct
  leniency as TWO separate audits — they live in different parts of
  the struct and have different attribute fixes.
- **Commit:** same commit as this entry

### 2. Streaming-tail `on_caught_up` fired during a half-buffered partial line, misclassifying the straddling line as live

- **Source:** github-claude | PR #302 round 1 | 2026-05-29
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/base/transcript_tail_service.rs` L73-76
- **Finding:** `TranscriptTailService::run` treated EOF (`Ok(0)`) and incomplete-line (non-empty `partial`) as orthogonal states: every `Ok(0)` immediately called `self.decoder.on_caught_up()` regardless of whether a line was half-buffered. For decoders that flush replay-only emitter state in `on_caught_up` (e.g. in-flight tool-call accumulators, turn-boundary markers), the partial would later complete and `decode_line` would deliver it AFTER the boundary signal — promoting a line that started during replay into a live event. Test `engine_truncated_partial_never_emits` confirmed `caught == 1` even when the only chunk was a partial — pinning the buggy behavior rather than the intended one. The bug surfaces only when a transcript writer is interrupted mid-byte (rare, but real for crash-recovery scenarios), so it had escaped review until the trait surface was scrutinized.
- **Fix:** Guard the EOF arm with `if partial.is_empty() { self.decoder.on_caught_up(); }`. Deferred boundary signal: if a partial completes mid-loop, the next EOF will fire `on_caught_up` with `partial` now empty (cleared after `decode_line`); if the partial never completes (writer truncated forever), the boundary stays parked — decoders keep accumulating replay-only state, which is the correct semantic for "replay never completed" (a degraded mode that surfaces if the writer comes back, not a correctness violation). Updated the `TranscriptDecoder` trait doc to spell out the deferred-signal contract. Updated the existing `engine_truncated_partial_never_emits` test (`caught` is now `0`, with a comment explaining why) and added a new regression `engine_caught_up_defers_until_partial_completes` to pin the ordering: chunk(open) → Eof (deferred) → chunk(close) → EofStop (signal fires once). Code-review heuristic: when a state-machine boundary signal is triggered by an external event (EOF, timeout, interrupt) but the in-memory state may be mid-transition (partial buffer, pending I/O), gate the signal on the in-memory state being settled — otherwise downstream consumers that flush-on-boundary will observe an incoherent state.
- **Commit:** _(PR #302 upsource cycle 1 fix commit)_

### 3. Unbounded `BufRead::read_line` in streaming tail engine — runaway memory on missing newline

- **Source:** local-codex | PR #302 round 14 | 2026-05-30
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/base/transcript_tail_service.rs`
- **Finding:** The tail engine used `BufRead::read_line(&mut partial)`,
  which grows `partial` without bound until it sees `\n`. A
  pathological writer (or a corrupt rollout file with megabytes of
  binary garbage before the next newline) could OOM the watcher
  thread. The streaming-tail tests covered correctness of normal
  line accumulation but never exercised the
  no-newline-for-N-bytes adversarial shape, so the unbounded
  allocation slipped through.
- **Fix:** Refactor to bounded chunk reads. Engine reads into a
  fixed `[u8; READ_CHUNK_BYTES]` (8 KiB), feeds each chunk to a
  small state machine (`process_chunk`), and caps `partial` at
  `MAX_PARTIAL_BYTES` (4 MiB). On cap-overflow:
  1. Discard `partial`, log warn, enter `skip_until_newline`
     mode so subsequent bytes feed into a sink until the next
     `\n` terminates the over-long line.
  2. Resume normal processing on the byte AFTER that `\n`.
     Two cap-enforcement paths exist and BOTH must be checked
     separately — codex-verify retry-1 caught that only one was
     protected in the initial fix:
  - **No-newline-in-chunk** (`None` arm of `position(b'\n')`) —
    cap check before appending `head`. If `partial.len() +
head.len() > MAX_PARTIAL_BYTES`, set `skip_until_newline =
true` and drop the chunk.
  - **Newline-in-crossing-chunk** (`Some(pos)` arm) — cap check
    before appending `head` (which includes the terminator). If
    over cap, discard, log, do NOT enter skip mode (the `\n` is
    in `head` itself, so the line is fully consumed here), and
    continue from `rest`.
    Test seam: replaced `BufReader<Box<dyn Read>>` factories with
    a `ScriptedReader { steps, pending }` that splits chunks
    across multiple `Read::read` calls when the chunk exceeds the
    caller's buffer. Three regression tests pin all three shapes:
    over-cap chunk WITHOUT newline (skip-mode), over-cap chunk
    WITH newline (same-chunk discard), and recovery on the next
    valid line. **Heuristic:** when bounding a streaming parser's
    buffer, audit EVERY state-machine arm that mutates the
    buffer — newline-arrival paths and no-newline paths have
    different cap semantics (skip-mode vs same-chunk discard),
    and a single-arm cap check leaves the other path
    unprotected. Codex verify caught this with high confidence
    (0.9) on retry-1.
- **Commit:** _(PR #302 upsource cycle 14 fix commit)_
