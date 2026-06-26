---
id: parser-resilience
category: code-quality
created: 2026-05-24
last_updated: 2026-06-22
ref_count: 8
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

### 4. Stale-partial watchdog for streaming tail engines whose partial-line guard can permanently park the replay→live boundary signal

- **Source:** github-claude | PR #302 cycle 17 | 2026-05-30
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/base/transcript_tail_service.rs`
- **Finding:** Cycle 1 round 1 (#2) added the `partial.is_empty() && !skip_until_newline` guard before firing `on_caught_up` to fix the misclassification of straddling lines as live events. The guard is semantically correct for normal replay→live transitions but introduces a silent persistent failure mode: if a JSONL writer dies mid-line (crash, disk full, killed process), `partial` stays non-empty forever, `on_caught_up` never fires, decoders that gate replay-bounded state on `on_caught_up` (e.g. `TestRunEmitter` via its `replay_done` flag) stay frozen, and downstream UIs receive no events with no user-visible diagnostic. Recovery requires a session restart.
- **Fix:** Stale-partial watchdog in `TranscriptTailService::run`:
  - New `STALE_PARTIAL_WATCHDOG: Duration = Duration::from_secs(30)` constant (30s comfortably above any realistic inter-write gap during live tailing; tunable via `with_stale_partial_watchdog` in tests).
  - Track `last_byte_at: Instant` updated whenever a non-EOF read returns >0 bytes.
  - In the EOF arm, if `!partial.is_empty()` (or `skip_until_newline`) AND `last_byte_at.elapsed() >= STALE_PARTIAL_WATCHDOG`: log warn with provider label / threshold / buffered byte count, discard the partial, reset skip-mode, force-fire `on_caught_up`, and reset `last_byte_at = now` so the watchdog doesn't refire every poll while the writer stays silent.
  - The orphaned partial is DISCARDED, never decoded as a line — corrupt-line safety preserved.
  - Updated `TranscriptDecoder::on_caught_up` docstring with the watchdog contract; same idempotency requirement as the normal path.
  - Regression test `engine_stale_partial_watchdog_force_fires_on_caught_up` uses `with_stale_partial_watchdog(Duration::ZERO)` so the very next Eof with non-empty partial fires the watchdog; asserts orphaned partial is not decoded AND `on_caught_up` fires at least once.
- **Code-review heuristic:** When a defensive guard correctly prevents one failure class, audit whether it introduces a new "silent persistent failure" class. The guard "don't fire boundary signal while X is true" is symmetric: if X never becomes false, the boundary signal never fires. The fix shape — watchdog/timeout + reset condition + force-progress — is the standard recovery for any guard whose unblock condition depends on external state (the JSONL writer, here) that can fail to materialize. Pair every "deferred-until-X" guard with a "force-progress if X stuck for too long" escape hatch. The escape MUST discard the still-pending state (not commit it to events) because if the unblock condition never arrived, the pending state is inherently incomplete or corrupt.
- **Commit:** _(PR #302 upsource cycle 17 fix commit)_

### 5. Recovery escape hatches must reach EVERY arm that fails to make progress, not just the "natural" one

- **Source:** github-claude | PR #302 cycle 20 | 2026-05-31
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/base/transcript_tail_service.rs`
- **Finding:** Cycle 17's stale-partial watchdog (#4) lived only inside the `Ok(0)` EOF arm of `TranscriptTailService::run`'s read loop. Claude's post-cycle-19 review (MED 93%) pointed out that a reader stuck in a persistent error state (e.g., EIO on an NFS mount that disappears) never executes the `Ok(0)` branch — `last_byte_at` stays frozen at its last-successful-read timestamp, the elapsed check never fires, `on_caught_up` is never called, and decoders gating replay-bounded state on `on_caught_up` stay stuck indefinitely. The original cycle-17 fix solved the writer-crashed-mid-line scenario (which produces `Ok(0)` because the file's existing bytes have already been consumed) but missed the reader-side analogue (persistent `Err` with no intervening `Ok(0)`).
- **Fix:** Hoist the watchdog check OUT of the `Ok(0)` arm to a post-match block that runs after every loop iteration EXCEPT `Ok(n)` (which `continue`s — fresh bytes resets the stale clock). Both `Ok(0)` and `Err` arms fall through to the watchdog. The `Ok(0)`'s natural `on_caught_up` (the replay→live boundary signal when partial is empty) is unchanged; only the stuck-buffer recovery path moved.
- **Regression-test discipline:** Cycle 20's first regression test ended with `Step::EofStop` (returns `Ok(0)`), which gave the pre-cycle-20 Ok-arm-only watchdog a final EOF to fire from — so the test passed against both old and new implementations and didn't actually distinguish the fix. Codex-verify retry-1 (MED 0.93) caught this. Added a `Step::ErrStop` variant to the scripted reader that flips `stop` while returning `Err(...)`, so the loop exits via the Err arm with NO `Ok(0)` ever served. Pre-cycle-20 implementation has `caught.load() == 0` on this script; cycle-20 fires the watchdog and `caught.load() >= 1`.
- **Code-review heuristic (extends #4's "deferred-until-X" rule):** When the recovery escape hatch is placed inside ONE specific arm of a state machine, audit whether there are other arms that can also fail to make progress without ever reaching that arm. The natural placement (the "nothing-to-read" branch) is rarely the only branch where the precondition holds. Hoist the escape to a shared point that EVERY non-progress branch reaches, or replicate it in each — but never let a single arm silently swallow the recovery path. **Test discipline:** when a regression test scripts an error scenario, end the script through the same arm that triggers the bug, not through an adjacent arm that happens to terminate the loop. Otherwise the test passes against the unfixed code and gives false confidence. The `ErrStop` shape (flips `stop` while returning the variant of interest) generalizes: when a scripted-reader / state-machine test harness has terminator variants, every error or boundary case needs its own terminator that exits via the same code path.
- **Commit:** _(PR #302 upsource cycle 20 fix commit)_

### 6. Substring JSON parser embeds a whitespace assumption that silently disables the feature on format drift

- **Source:** github-claude | PR #408 round 1 | 2026-06-09
- **Severity:** MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/locator.rs`
- **Finding:** `header_value` searched for the exact substring `"name": "` (colon, space, quote). If Codex CLI ever serialized headers as compact JSON (`"name":"value"`) or with any other whitespace variant, every header lookup returned `None`. Because `account_rate_limits_from_log_body` propagated that `None` with `?`, the entire rate-limit snapshot was discarded and the sidebar fell back to rollout placeholder data — silently, with no diagnostic.
- **Fix:** Replaced the exact-substring needle with a small state machine that locates the quoted key, skips optional whitespace, expects `:`, skips optional whitespace, then reads the quoted value. This handles compact, spaced, and any other valid JSON whitespace around the colon. Added regression tests for compact JSON and extra-space variants. Also added a test for the partial-data case (usage present, reset absent) which exercises the same code path.
- **Commit:** same commit as this entry

### 7. Strict all-or-nothing parsing of partial rate-limit headers discards available usage data

- **Source:** github-codex-connector | PR #408 round 1 | 2026-06-09
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/agent/adapter/codex/locator.rs`
- **Finding:** `account_rate_limits_from_log_body` used `?` on both `header_f64(..., "x-codex-primary-used-percent")` and `header_u64(..., "x-codex-primary-reset-at")`. When the used-percent header was present but the reset-at header was absent (e.g. error responses or older header shapes), the `?` on the missing reset header made the entire function return `None`. The available usage percentage was lost and the sidebar showed the model-specific `0%` placeholder.
- **Fix:** Changed the primary `five_hour` construction to require only `used_percentage` via `?`; `resets_at` now falls back to `0` (unknown reset) via `unwrap_or(0)`. Applied the same fallback to the optional `seven_day` block: `(Some(used), None) → Some(RateLimitInfo { used_percentage: used, resets_at: 0 })`. Added a regression test proving usage is preserved when reset headers are absent.

### 6. Malformed pushShape IPC payload can poison the layout writer state

- **Source:** github-codex-connector | PR #384 round 1 | 2026-06-07
- **Severity:** MEDIUM
- **File:** `electron/workspace-layout-controller.ts` L163-166
- **Finding:** The installed IPC handler casts an unknown renderer payload to `WorkspaceShapeDto` and `pushShape` stores it before `writer.onShapePushed` synchronously assembles the store. If `sessions` is missing, null, or not an array, `assemble` throws and the corrupt shape remains stored, so later layout writes can keep failing until a valid shape is pushed.
- **Fix:** Added a runtime guard in the IPC handler before calling `pushShape`: reject payloads that are not objects or lack an array `sessions` field. The fix also adds a regression test covering null, missing `sessions`, and wrong-type `sessions` payloads, plus a happy-path assertion that valid shapes still flow through.
- **Commit:** same commit as this entry

### 7. Renderer workspace-shape IPC guard must validate nested sessions and panes

- **Source:** github-claude | PR #404 final review | 2026-06-08
- **Severity:** MEDIUM
- **File:** `electron/workspace-layout-controller.ts`
- **Finding:** The push-shape IPC guard rejected missing or wrong-type `sessions`, but still accepted any array contents and cast them to `WorkspaceShapeDto`. Payloads such as `sessions: [null]`, sessions without `panes`, or panes with wrong-typed scalar fields could still reach `writer.onShapePushed` and throw inside the writer.
- **Fix:** Replace the shallow guard with recursive runtime validation for the DTO root, sessions, browser panes, shell panes, and nullable shell `agentSessionId`. Extended regression coverage with malformed nested sessions and panes.
- **Commit:** same commit as this entry

### 10. Unterminated string in log-header parser aborts the whole search

- **Source:** github-claude | PR #421 round 3 | 2026-06-11
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/codex/locator.rs` L763-765
- **Finding:** `header_value` used `rest.find('"')?` after finding an opening quote for a header value. When a malformed occurrence had an opening quote but no closing quote, the `?` propagated `None` out of the entire function, abandoning any later well-formed occurrences of the same header.
- **Fix:** Replaced the `?` with `let Some(end) = rest.find('"') else { continue; };` so an unterminated value skips to the next iteration, matching the existing `continue`-on-malformed logic for missing colon or opening quote.
- **Commit:** same commit as this entry

### 11. Lint guard regex misses white/black gradient stop utilities

- **Source:** github-codex-connector | PR #424 round 1 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `eslint-rules/no-hardcoded-colors.js` L9
- **Finding:** The new `no-hardcoded-colors` rule matched white/black utilities for `text`, `bg`, `border`, etc., but omitted the Tailwind gradient-stop prefixes `from`, `via`, and `to`. Class strings such as `from-white/5`, `via-black`, and `to-white/20` passed lint even though they are hardcoded colors, weakening the per-commit guard for the runtime theme migration.
- **Fix:** Extended the white/black utility regex to include `from|via|to` and added invalid `RuleTester` cases for `from-white/5`, `via-black`, and `to-white/20`.
- **Commit:** same commit as this entry

### 12. YAML mode swallows validation errors, shows JSON SyntaxError instead

- **Source:** github-claude | PR #569 round 1 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/LayoutCreator/layoutCreatorModel.ts` L713-723
- **Finding:** `parseDraftLayoutText` used a bare `catch {}` around `modelToDraft(parseYamlModel(trimmed))` so it could fall through to a JSON fallback. Valid YAML that produced a semantically invalid model (e.g., missing covered cells, overlapping panes) threw a descriptive validation error, but that error was discarded. The subsequent `JSON.parse(trimmed)` always failed on YAML text, surfacing a cryptic `SyntaxError: Unexpected token '-'` instead of the actionable validation message.
- **Fix:** Capture the YAML error in a local variable, attempt the JSON fallback, and re-throw the original YAML error if the fallback also fails. This preserves descriptive validation messages for valid YAML with semantic problems while keeping the JSON-pasted-into-YAML-mode convenience path.
- **Commit:** same commit as this entry

### 13. Quoted YAML flow-sequence accepts entries are silently dropped

- **Source:** github-codex-connector | PR #609 round 1 | 2026-06-22
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/LayoutCreator/layoutCreatorModel.ts`
- **Finding:** The YAML `accepts` flow-sequence parser split entries and trimmed whitespace, but it left scalar quote characters in values such as `'browser'` and `"shell"`. Those quoted strings failed the supported-pane-kind filter, so valid YAML restrictions normalized to `undefined` and made the slot unrestricted.
- **Fix:** Added YAML scalar unwrapping before `readAccepts` normalizes flow-sequence entries. Regression coverage imports quoted single- and double-quoted accepts entries and verifies both pane kinds survive.
- **Commit:** same commit as this entry

### 14. YAML block-sequence accepts entries are ignored as unknown slot keys

- **Source:** github-claude | PR #609 round 1 | 2026-06-22
- **Severity:** LOW
- **File:** `src/features/terminal/components/LayoutCreator/layoutCreatorModel.ts`
- **Finding:** The hand-written YAML parser only supported `accepts: [browser, shell]`. A user-authored block list under `accepts:` was parsed as unrelated `- browser` slot-level lines, so the restriction was dropped without an error.
- **Fix:** Added a narrow `accepts:` block-list state that accumulates following `- kind` scalars into the current slot restriction. The new test covers block-sequence YAML and verifies both values are preserved.
- **Commit:** same commit as this entry
