# A-transcript + C — Transcript DTOs & shared tailer engine

**Status:** draft (planner, per-section codex review)
**Plan ref:** v4-frozen agent-adapter refactor — [#246](https://github.com/winoooops/vimeflow/issues/246), optional steps A-transcript + C
**Branch:** `refactor/transcript-dtos-and-engine` (off `refactor/agent-adapter`)

## 1. Context & Motivation

**Background.** The v4-frozen agent-adapter refactor (#246) decomposed the
monolithic `AgentAdapter` through steps 0a–D' (all merged on
`refactor/agent-adapter`). Two optional steps were deliberately deferred
behind a post-D' go/no-go: **A-transcript** (typed DTOs for the transcript
JSONL parsers) and **C** (a shared tailer engine). This spec covers both,
done as a pair.

**Problem.** `claude_code/transcript.rs` (~1394 ln, ~46 extraction sites)
and `codex/transcript.rs` (~1367 ln, ~55 sites) still parse transcript
JSONL with `serde_json::Value` pull-style extraction — the exact
anti-pattern A-status (#257) already replaced for the statusline /
rollout-status parsers with typed `#[derive(Deserialize)]` DTOs +
`lenient_*` deserializers (see
[`docs/reviews/patterns/parser-resilience.md`](../../reviews/patterns/parser-resilience.md)).
Separately, both tailers independently re-implement near-identical
streaming _mechanics_ — the `BufReader`/`read_line` loop, `stop_flag`,
`POLL_INTERVAL`, and the `TestRunEmitter` replay boundary. Each also
declares the same _shape_ of per-session state
(`in_flight`/`num_turns`/`last_cwd`), threaded identically through the
loop — but the state's _type_ is provider-specific (Codex's
`InFlightToolCall` carries `CompletionMode`, Claude's does not). That
split is precisely why C keeps the loop mechanics in the shared service
while the state itself lives in the provider decoder (§ 2 G2). The two
behavioral divergences are:

- the per-line `process_line` body — the genuinely provider-specific
  part (Claude content-blocks vs Codex `response_item` / `function_call`
  - `CompletionMode`); and
- **partial-line buffering** — Codex buffers a JSONL line split across
  read boundaries until its trailing `\n`
  (`codex/transcript.rs`), while Claude processes each `read_line`
  result immediately (`claude_code/transcript.rs`) and therefore
  _silently drops_ events on a split line. This is a behavioral
  divergence, not shared scaffolding — see the standardization
  decision below.

**Why now / why paired.** A-transcript makes the implicit `Value`-pull
tolerance explicit, centralized, and test-pinned. It does _not_ by itself
convert an upstream field rename into a failure — lenient parsing still
deserializes a missing/renamed field to `None`, exactly as the `Value`
walk did — but it collapses the ~100 scattered `.get("x") → None` no-ops
into one declared per-message contract whose tolerance is reviewable in
one place and exercised by fixtures, so field-shape drift becomes
_detectable under test_ instead of an invisible no-emit. C removes the
duplication so future tailer changes happen once instead of twice. They
are paired because:

- A-transcript alone types the bodies but leaves the duplicated loop —
  migration cost paid, dedup payoff (G2/G4) deferred.
- C alone extracts the shared loop and the two decoders, but each
  decoder's `decode_line` would still hold a `Value`-pull body — the seam
  lands while the ~100 fragile extraction sites stay untyped, and you'd
  rewrite those same bodies again when A-transcript follows. Pairing
  rewrites each body _once_: typed as it moves into its decoder.

**Why gated behind a test-hardening Phase 0.** A coverage audit (2026-05-25)
found the transcript test suites are strong on per-line parsing (which
de-risks A-transcript) but have two gaps on exactly the streaming-engine
behaviors C extracts:

1. **Partial-line buffering** — Codex has it, Claude doesn't, and
   _neither_ is tested at the tailer level (the integration tests
   `fs::write` the whole file once, so the split-line path never runs).
   **Decision: C standardizes on Codex-style buffering for both.** For
   Codex this is preservation; for Claude it is an _intentional behavior
   change_ that fixes the latent split-line event drop (buffering is
   ~free: two byte-compares per complete line, one reused buffer, no
   steady-state allocation — the per-line JSON parse dwarfs it). The
   exact buffering contract — EOF with a pending non-`\n`-terminated
   partial, and line normalization (`trim` vs `trim_end_matches('\n')`,
   which Claude and Codex currently do differently) — is **specified in
   § C**, because that is where the Claude change is introduced and
   bounded.

   **Sequencing (important):** Phase 0 pins only the **replay→live
   boundary** (deterministically, via `test-run` counts — see § 3); it
   does _not_ add a split-line buffering test. A buffering test can be made
   deterministic only by feeding bytes to the extracted buffering
   _synchronously_, which is impossible while buffering is inlined in
   `tail_loop` (a poll-loop integration test cannot prove a _buffered_
   partial was read before the line completed). So **both** buffering
   tests — Codex's preserved behavior _and_ Claude's newly-added behavior —
   land in C (§ 5) as one synchronous unit test on `TranscriptTailService`:
   where the test can be deterministic _and_ where buffering could actually
   regress. Phase 0 = "pin (only) what can be deterministically pinned
   before extraction."

2. **Replay → live boundary** — no test appends a line _after_ the initial
   EOF / `finish_replay` to assert live emission. Pure preservation for
   both adapters → fully covered in Phase 0.

Net: Phase 0 lands all-green against _current_ behavior (both adapters'
replay→live) before any refactor touches the code it protects. Buffering —
Codex's preserved behavior and Claude's new behavior alike — is pinned
deterministically in C (§ 5), the same PR that extracts and changes it.

**Scope of this effort.** This spec implements **A-transcript + C** (and
the Phase 0 prerequisite). A third capstone — **Step F**, a single
minimal-surface session-lifecycle class that exposes only the lifecycle
verbs and delegates every step to private methods / injected services —
is captured here as deferred design intent (§ Step F) and recorded on
#246, but is **not implemented** in this effort. It reshapes
`watcher_runtime` / the D' `AgentWatcherService`, so it earns its own
design + go/no-go after A-transcript + C land.

## 2. Goals, Non-goals, Frozen constraints

### Goals

- **G1 (A-transcript).** Replace the `serde_json::Value` pull-extraction
  inside both `process_line` paths with typed `#[derive(Deserialize)]`
  DTOs + `lenient_*` deserializers, mirroring A-status (#257) and
  [`parser-resilience.md`](../../reviews/patterns/parser-resilience.md).
  Outcome: the parse contract becomes explicit, centralized, and
  test-pinned. This does _not_ make an upstream field rename a compile
  failure — `Option<T>` / `#[serde(default)]` / `lenient_*` deserialize a
  missing or renamed field to `None`, exactly as the `Value` walk did.
  The win is that the ~100 scattered implicit `.get("x") → None` no-ops
  collapse into one declared per-message DTO whose tolerance is reviewable
  in one place and exercised by fixtures, so field-shape drift is
  _detectable under test_ (a fixture-covered event stops emitting) instead
  of an invisible silent drop.
- **G2 (C).** Hoist the duplicated tail scaffolding — the near-identical
  `tail_loop` in both `claude_code/transcript.rs:211` and
  `codex/transcript.rs:190` — into one `TranscriptTailService` that owns
  exactly the provider-_agnostic_ loop mechanics: the
  `BufReader`/`read_line` loop, `stop_flag`, `POLL_INTERVAL`, partial-line
  buffering, the read-error branch, and the _trigger_ for the replay→live
  boundary: it calls `decoder.on_caught_up()` on _each_ EOF — like the
  current `finish_replay()` this is idempotent, so only the first call
  (the replay→live transition) has an observable effect. Everything
  provider-shaped — the per-session `in_flight` (whose value type
  differs: Codex carries `CompletionMode`, Claude does not), `num_turns`,
  `last_cwd`, and the `TestRunEmitter` — lives **inside** the injected
  `TranscriptDecoder`, which is _constructed_ with the per-session context
  it needs (the `EventSink`, `session_id`, and `cwd`) and then exposes
  only `decode_line(&mut self, line: &str)` and `on_caught_up(&mut self)`
  (the `finish_replay` flush). Because that context is owned by the
  decoder, no per-line context struct is passed. The service therefore holds no provider state
  and needs no generic parameter — it is constructed from a `Box<dyn
TranscriptDecoder>` plus a `&'static str` provider label (used only for
  the unified read-error log line required by F-CONCURRENCY). The trait
  carries a `Send` supertrait bound (`trait TranscriptDecoder: Send`) so
  the `Box<dyn TranscriptDecoder>` — already `'static` by the
  boxed-trait-object default — moves cleanly into the `std::thread::spawn`
  that G4 describes. § C specifies this boundary in full.
- **G3 (consequence of G2).** Because the shared service has exactly one
  buffering implementation, **Claude adopts Codex-style buffering**. That
  single change has two observable effects: it _fixes_ the latent
  split-line event drop (Claude now emits those records), and a
  _permanently_ newline-less **final** record is no longer emitted — it
  stays buffered, matching Codex, where Claude today processes the no-`\n`
  `read_line` result immediately. Both effects are bounded by Phase-2
  tests (§ 5) and reflected in the F-EVENTS carve-out below.
- **G4.** Each adapter's spawn site — `transcript::start_tailing`, which
  `tail()` already delegates to (`claude_code/mod.rs:106`,
  `codex/mod.rs:149`) — collapses to "build provider decoder → wrap in
  `TranscriptTailService` → spawn". Future tail-loop changes happen in one
  place instead of two; `tail()` itself stays a one-line delegator.

### Non-goals

- **The rollout-locator subsystem** (`CompositeLocator` / `SqliteFirst` /
  `FsScan` and its ~8 supporting types) is **untouched**. A-transcript + C
  scope is the transcript _parse_ + _tail_ path only — the locator is a
  separate step-9 concern.
- **A-status is not re-done.** It already shipped (#257); this effort
  _reuses_ its `lenient_*` helpers rather than re-deriving them.
- **Step F** (the single-class session-lifecycle capstone) is **deferred**
  — see § 6. It reshapes `watcher_runtime` / the D' `AgentWatcherService`
  and earns its own design + go/no-go after A-transcript + C land.
- **No event-surface change beyond G3.** No new `AgentEvent` variants, no
  changed event shapes, ordering, or emit semantics; no new IPC; no
  frontend change.

### Frozen constraints (v4-frozen — must hold across A-transcript + C)

- **F-EVENTS** — the emitted `AgentEvent` _variants and their shapes_ are
  frozen; DTOs are an internal parse layer producing the same
  variants/shapes from the same bytes. **G3 carve-out (two sides of one
  change — Claude adopting Codex-style buffering):** (a) Claude now
  _emits_ the event for a split-line input it currently drops; (b) Claude
  no longer _emits_ a permanently newline-less _final_ record (it stays
  buffered, matching Codex, where Claude today processes the no-`\n`
  `read_line` result immediately). (a) is the fix; (b) is benign — a
  newline-less final line is malformed/incomplete and both writers
  newline-terminate records — and is pinned by § 5's truncated-final test.
  No other byte→event mapping changes.
- **F-TRAIT** — `TranscriptStreamer::tail(&self, events, session_id,
cwd, transcript_path) -> Result<TranscriptHandle, String>`
  (`traits.rs:123`) is frozen, and its one-line delegation to
  `transcript::start_tailing` is unchanged; the body that changes is
  `start_tailing`'s (to construct a decoder + service — § 5).
  `TranscriptState::start_or_replace` is likewise
  unchanged — the shorthand "`Arc<dyn TranscriptStreamer>`" means its
  _streamer_ parameter stays `Arc<dyn TranscriptStreamer>`; its full B''
  signature (`streamer`, `events`, `session_id`, `transcript_path`,
  `cwd`) is untouched.
- **F-CONCURRENCY** — `stop_flag` as `AtomicBool` read with
  `Ordering::Acquire` (pairs with the `Release` in
  `TranscriptHandle::stop` / `Drop`, PR #152 F12), `POLL_INTERVAL`
  (500 ms), and the first-EOF `finish_replay()` boundary are preserved
  verbatim by the shared service. The read-error → `warn` → sleep
  _behavior_ is preserved too, but the warning _text_ is not a frozen
  contract: the providers log different literals today
  (`codex/transcript.rs:251` "Error reading Codex rollout transcript
  line" vs `claude_code/transcript.rs:272` "Error reading transcript
  line"), so the service emits one unified message carrying a provider
  label, keeping Codex vs Claude tail errors distinguishable in logs.
- **F-ATTACH** — the offset/cursor replay-then-stream attach protocol is
  unchanged; A-transcript + C sit entirely below it.
- **F-BINDINGS** — no ts-rs regeneration is expected (transcript DTOs are
  internal, no `#[derive(TS)]`); if `cargo test` perturbs `src/bindings/`,
  `git restore src/bindings/` before committing.

> The two engine-contract decisions deferred from § 1 — EOF with a
> pending non-`\n` partial, and line normalization (`trim` vs
> `trim_end_matches('\n')`) — are resolved in § C, where the shared
> buffering is defined.

## 3. Phase 0 — test hardening (lands first, all-green, no production change)

**Purpose.** Build the regression net for the loop-level behaviors C
extracts, _before_ C touches them. Phase 0 adds tests only — zero
production changes — and is all-green against the current branch tip.

**Existing coverage (do not redo).** Two layers already exist:

- _Per-line parsing_ — `parse_tool_use_from_assistant_line`,
  `extract_tool_result_content_*`, and the Codex `response_item` /
  `CompletionMode` tests are pure functions over a single JSON line.
  A-transcript (Phase 1) leans on these.
- _End-to-end replay_ — both adapters already drive the full loop with
  `FakeEventSink`, in different homes (detailed under **Harness** below):
  Claude via `transcript_fixture_tests.rs` (`start_or_replace`), Codex via
  the in-module `mod tests` in `codex/transcript.rs` (`start_tailing`).
  Both write a whole fixture up front, so the loop _is_ exercised — but
  only in the **replay** direction (whole file written _before_ start) and
  only on `\n`-terminated lines.

**The gap (confirmed).** Because those fixtures write the file once up
front, two behaviors C must preserve are never exercised: (1) a JSONL
line **split across reads** (no test writes partial bytes then completes
them); and (2) a line **appended after catch-up** (no test writes to the
file _after_ `start_or_replace`, so the post-first-EOF live-tail path and
the `finish_replay` boundary go untested). **Phase 0 closes only gap (2),
the replay→live boundary.** Gap (1), split-line buffering, is real but
cannot be pinned deterministically before extraction, so it is closed in C
(§ 5) — see "Split-line buffering is pinned in C" below. Phase 0 does
_not_ re-cover replay or per-line parsing.

**Harness — reuse each adapter's existing pattern.** The two adapters
already test the loop end-to-end in _different_ homes, and Phase 0 extends
each in place rather than inventing a shared one:

- **Claude** — `claude_code/transcript_fixture_tests.rs`, driving
  `TranscriptState::start_or_replace(adapter, sink, sid, path, cwd)`.
- **Codex** — the in-module `#[cfg(test)] mod tests` in
  `codex/transcript.rs` (mirroring `start_tailing_replays_…` at
  `transcript.rs:878`), driving `start_tailing(...)`.

Both entry points' _signatures_ are preserved across C — the rewrite
changes their bodies to build a decoder + `TranscriptTailService`, not
their call shape — so tests written against them exercise today's
`tail_loop` and tomorrow's `TranscriptTailService::run` **unchanged**,
and the net survives the refactor it guards. `FakeEventSink` already
provides what the tests need: a Condvar-backed
`wait_for_count(event, count, timeout) -> bool` (returns the instant the
Nth event lands, bounded by the timeout → deterministic, not flaky) plus
`count(event)` / `recorded()` for exact-count assertions. The only new
wrinkle vs the existing fixtures is driving the file **incrementally**
(append-after-catch-up to the open path) rather than one `fs::write`;
split-write is a § 5 / C concern, not Phase 0.

**Tests to add — T-replay (replay→live boundary via `test-run`, both
adapters).** Only `test-run` events flow through `TestRunEmitter` /
`finish_replay`; `agent-tool-call` / `agent-turn` / `agent-cwd` emit
_independently_ of the boundary and so cannot pin it. A `test-run` is
built only when a test-runner tool **start** (registered in `in_flight`)
is matched by its **completion** — an orphan completion returns `None` and
never `submit`s — so the fixture uses start+completion **pairs**; and the
snapshot is skipped when `cwd` is `None` (`claude:510`, `codex:562`), so
the tail starts with `Some(workspace_cwd)` (a tempdir), not the `None` the
existing turn fixtures pass. Recipe:

1. Pre-write **≥3** test-run-producing pairs. (≥3, not ≥2: the final
   assertion is `test-run == 2` = 1 replay-collapsed + 1 live; with only
   _2_ replay pairs, a regression that fails to collapse _and_ drops the
   live snapshot would also total 2 — `2 uncollapsed + 0 live`. With ≥3,
   no-collapse totals ≥3 and missing-live totals 1, so `== 2` uniquely
   means "collapsed + live".) Claude already has this —
   `transcript_vitest_replay.jsonl` carries _three_ vitest pairs and
   `replay_emits_only_latest_snapshot` already asserts the 3→1 collapse —
   so Claude's T-replay reuses that fixture and adds only the live half.
   Codex's `start_tailing_replays_…` has just _one_ `exec_command`
   "cargo test" pair (`codex:898`; the apply-patch pair is not a
   test-runner pair), so the Codex test **authors two more pairs** from
   the same shape. **Copy** the fixture lines into a tempdir transcript and
   tail _that_ path — never the checked-in fixture, since the live appends
   in steps 3–4 would otherwise mutate it and skew future replay counts.
   Start the tail with `Some(cwd)`.
2. **Catch-up barrier:** `wait_for_count("test-run", 1, 5s)`. With
   buffering, replay holds all snapshots and emits exactly one at
   `finish_replay` (first EOF), so the `test-run` count is `0` until then —
   this wait proves replay is done, and only _now_ is an append genuinely
   "live". Appending earlier would fold the new pair into replay and
   collapse it, making the final count scheduling-dependent.
3. Append a _new_ full pair **live** (start line, then completion line).
4. **Drain barrier:** append a **sentinel** line emitting a distinct
   non-`test-run` event (a user prompt → `agent-turn`). Capture
   `n0 = sink.count("agent-turn")` _before_ the append, then
   `wait_for_count("agent-turn", n0 + 1, 5s)` — baseline-relative because
   the replay fixture already emits an `agent-turn` (`codex:893`), so an
   absolute `wait_for_count(.., 1)` would return immediately. Being last,
   the sentinel's event proves every prior line (replay pairs + live pair)
   was processed; `wait_for_count("test-run", N)` alone proves only "≥N
   arrived".
5. Assert `sink.count("test-run") == 2` exactly: 1 replay-collapsed +
   1 live.

Step 2 pins the replay-collapse / one-shot `finish_replay` (replay
contributes exactly 1); steps 3–5 pin the post-replay immediate emit and
that the loop keeps polling past EOF (the live pair contributes the 2nd);
a regression that emits replay snapshots live would record ≥3 and fail.
One test per adapter — both share the same `TestRunEmitter` and call
`finish_replay()` (`claude:251`, `codex:209`).

**Split-line buffering is pinned in C, not Phase 0.** A deterministic
split-line test must feed bytes to the buffering logic _synchronously_ —
impossible while buffering is inlined in `tail_loop`: an integration test
through the real poll loop cannot prove a _buffered_ partial was read
before the line completed, because a buffered partial emits no signal (any
timing-based attempt either races or can false-pass). The authoritative
pin therefore lands in C (§ 5) as a synchronous unit test on the extracted
`TranscriptTailService` — both where the test _can_ be deterministic and
where buffering could actually regress. That one C test covers Codex's
preserved buffering **and** Claude's newly-added buffering (§ 1 G3).

**Acceptance (Phase 0 gate).** Both transcript suites green with T-replay
added (one per adapter); `git diff` touches test code only (no production
change); the new tests pass against the _pre-refactor_ `tail_loop`.
A-transcript and C do not start until Phase 0 is green and committed.

**Out of scope for Phase 0.** The EOF-with-pending-partial edge (file
ends mid-line, `\n` never arrives) is _not_ pinned here — current Codex
holds such a partial buffered indefinitely. That behavior and the
standardized policy are defined and tested in § C (the deferred
engine-contract decision), where the Claude change is introduced.

## 4. Phase 1 — A-transcript: typed DTOs for the two `process_line` bodies

**Precedent (follow exactly).** A-status (#257) already ran this play for
the statusline / rollout-status parsers. A-transcript applies the
_identical_ recipe to the transcript `process_line` paths — it is a
representation swap, not a behavior change.

- **Reuse the shared deserializers** in `agent/adapter/serde_helpers.rs`:
  `lenient_string`, `lenient_u64`, `lenient_f64`, `lenient_object` (each
  returns `Option<T>` and degrades a wrong-typed field to `None` rather
  than erroring the parse). They are `pub(super)` = `pub(in
agent::adapter)`, and `statusline.rs` — a sibling at the same module
  depth as `transcript.rs` — already calls them, so the transcript
  parsers reach them with **no visibility change**.
- **Add two new lenient helpers** alongside them: `lenient_bool` and
  `lenient_i64`. The transcript paths tolerate `is_error` (`claude:156`,
  `Value::as_bool`), `success` (`codex:637`, `Value::as_bool`), and
  `exit_code` (`codex:571` / `:595` / `:761` — the last the
  custom-tool-output metadata path, `Value::as_i64`) — bool/signed-int
  fields A-status never needed, so `serde_helpers` has no helper for them
  yet. Without lenient versions, a wrong-typed `is_error` / `exit_code`
  would _error_ the DTO parse instead of degrading to `None` (changing
  the current `.unwrap_or(false)` / `.is_some_and(..)` semantics). The two
  are a one-for-one extension of the existing precedent (same `Option<T>`
  / wrong-type→`None` shape).
- **Define `#[derive(Deserialize, Default)]` DTOs** per message shape,
  named `Claude<Shape>Dto` / `Codex<Shape>Dto`, with
  `#[serde(default, deserialize_with = "lenient_*")]` on each tolerant
  field — mirroring `ClaudeStatusDto` (`statusline.rs:52`). Nested blocks
  use `lenient_object` so a malformed sub-block degrades to `None`
  without poisoning siblings (the exact property A-status's round-1
  review locked in). DTOs live co-located with each parser — a new
  `transcript_dto.rs` sibling (or an in-file `mod`), as A-status kept its
  DTOs beside the statusline / rollout parser. Whatever the placement, the
  DTO types + their fields (or the conversion fns over them) must be
  `pub(super)` so `transcript.rs` reads them as typed field access — a
  private DTO in a sibling/child module is not visible to the parser. Raw
  `Value` carve-out **subfields** (Claude `tool_result.content`; _not_ the
  whole Codex `payload`, which is a typed per-`type` DTO — only specific
  subfields stay raw) carry `#[serde(default)]` so a _missing_ field
  deserializes to `Value::Null` rather than erroring — the ported helpers
  already treat Null/absent as the empty/`None` case (a `tool_result`
  missing `content` → `extract_tool_result_content` returns `""`), exactly
  as the current `.get(..) → None`. (An `Option<Value>` field instead defaults to `None`
  _and_ maps JSON `null` → `None`, collapsing the two — which is why
  presence-sensitive `duration` can use neither; see its Codex bullet.)

**Claude shapes (~46 sites).** Type the _envelope_
(`ClaudeTranscriptLineDto` / `ClaudeMessageDto`), which must carry **all**
top-level fields `process_line` reads — not just `{type, message,
timestamp}` but also the top-level **`cwd`** (emits `agent-cwd` _before_
the `line_type` dispatch, `claude:301`) and the top-level **`tool_result`**
shape (`tool_use_id` / `is_error` / `content`), since `tool_result` is one
of the top-level `line_type` arms alongside `assistant` / `user`
(`claude:326`) — not only a nested block. The per-content layer stays
deliberately loose, because the current tolerance is _wider than derive
can express_:

- **Content + block classification are not a derivable tagged enum.**
  `message.content` is string | array | (object/number/null), and the
  last case must read as _no prompt_ — never a line parse failure
  (`is_user_prompt`, `claude:589`; test `:1343`). Within an array, a block
  with a **missing or non-string `type`** counts as user content
  (explicit test `…falls_through_to_content`, `claude:1376`), which a
  `#[serde(tag = "type")]` + `#[serde(other)]` enum cannot express (it
  catches only unknown _string_ tags and would fail on a typeless / non-
  object item). So keep `content` raw (`Value`, or `Vec<Value>` for the
  array case) and **port the existing predicates** (`is_user_prompt`,
  `is_non_empty_user_block`, `is_tool_result_block`, `line_type`)
  unchanged. The DTO types the envelope around the union, not the union
  itself.
- **Block scalars are typed; only the union/arbitrary fields stay raw.**
  Once an array item is classified as a `tool_use` / `tool_result` block,
  it is `from_value`'d into a typed block DTO whose **scalars** are lenient
  fields — `tool_use` → `{ id, name: Option<String> via lenient_string }`;
  `tool_result` → `{ tool_use_id: Option<String> (lenient_string),
is_error: Option<bool> (lenient_bool) }`. (`is_error` is where
  `lenient_bool` earns its place.) The union/arbitrary fields stay raw and
  keep their helpers:
  - `tool_result.content` → plain raw `Value (#[serde(default)])`;
    `extract_tool_result_content` is **retargeted** to take the `content`
    value directly (today it reads `.get("content")` off the block,
    `claude:686`) — a one-line, behavior-neutral change (absent and `null`
    both yield `""` today, so `#[serde(default)]` → `Value::Null` matches).
  - `tool_use.input` is **presence-sensitive** like Codex's `duration`:
    `summarize_input` returns `""` for _absent_ but `"null"` for
    _present-`null`_ (`claude:602`), which a plain `Value (#[serde(default)])`
    (absent → `Value::Null`) would conflate. Read it via the block DTO's
    `#[serde(flatten)] rest` map — `rest.get("input")` gives the
    `Option<&Value>` `summarize_input` already expects (`None` = absent →
    `""`; `Some(Null)` = present-null → `"null"`). **Three** live paths
    consume that same preserved raw `input`, so it must stay raw for all
    of them (`claude:378`): `summarize_input` (args display),
    `bash_command` → `match_command` (test-run matching, reads
    `input.command`), and `tool_file_path` → `is_test_file` (Write/Edit
    `isTestFile`, reads `input.file_path`). Narrowing `input` would
    silently lose test-run detection or test-file tagging, not just args.

The win (option B): the envelope, the message shape, and every scalar leaf
become typed (lenient) fields — typing the majority of the ~46 sites, not
just the envelope. Only the genuinely-union/arbitrary fields (`content`,
`input`) and the permissive content-array classifier (which needs the
missing/non-string-`type` fallthrough) stay raw `Value` + ported
predicates.

**Codex shapes (~55 sites).** Same treatment for the rollout records: the
`{timestamp, type, payload}` envelope and its typed variants. Three
contract points the DTO must honor:

- **Two cwd sources, in order.** `agent-cwd` comes from `session_meta`'s
  `payload.cwd` (`extract_session_cwd`, `codex:53`) _and_, mid-session,
  from an `exec_command` `function_call`'s `arguments.workdir`
  (`extract_exec_workdir`, `codex:76`); the dispatcher tries `session_meta`
  first, then the workdir fallback (`extract_codex_cwd`, `codex:100`).
  Both must be preserved, in that order — dropping or reordering either is
  an F-EVENTS / ordering regression. `turn_context.cwd` remains _not_ a
  source (it just repeats `session_meta.cwd`; matching it causes false
  reverts — `codex:48`).
- **Typed payload scalars; raw carve-outs.** Each record's `payload` is a
  typed per-`type` DTO whose **scalars** are lenient fields — `call_id` /
  `name` / `status` (`lenient_string`), `success` (`lenient_bool`,
  `codex:637`), `exit_code` (`lenient_i64`, `codex:571` / `:595`),
  `event_msg.message` (`lenient_string` → `process_user_message` /
  `agent-turn`, `codex:369`), and `exec_command_end.aggregated_output`
  (`lenient_string` → the test-run snapshot's captured output,
  `codex:565`). The fields that resist typing stay raw:
  - **custom-tool `input`** is consumed by `summarize_custom_tool_input`
    (`codex:714`) and `custom_tool_is_test_file` (`codex:725`) — treat it
    like `arguments`: an `Option<String>` (`lenient_string`) re-parsed by
    those helpers (or read from the flattened raw map if presence-
    sensitive), never narrowed to a fixed struct.
  - `function_call.arguments` and custom-tool `payload.output` are
    _JSON-encoded strings_ (`codex:87`, `:679`, `:752`) — typed as
    `Option<String>` (`lenient_string`, so a non-string degrades to
    `None`), then **re-parsed** in conversion: `arguments` → `workdir`
    (cwd), `cmd` || `command` (match), `path` || `file_path` (arg
    summary), with a raw-string fallback when malformed or unmatched
    (`summarize_function_call_args`, `codex:691`); `output` → an inner DTO
    whose `metadata.exit_code` (`lenient_i64`) gates failure
    (`custom_tool_output_failed`, `codex:752`), malformed inner JSON →
    `false`.
  - `payload.duration` must distinguish **present vs absent** (present —
    even `null` / non-object — → `Some(0)`; absent → `None`;
    `exec_command_duration_ms`, `codex:765`). No `Option` field captures
    this (`Option<DurationDto>` / `Option<Value>` both coerce JSON `null`
    → `None`). Realize it with `#[serde(flatten)] rest: serde_json::Map<
String, Value>` on that payload DTO — presence is
    `rest.contains_key("duration")`, the value `rest.get("duration")`, fed
    to the ported `exec_command_duration_ms` exactly as today. This is the
    one field needing the flattened raw map; the scalars above are
    ordinary typed fields.
- **Two-level dispatch, each with a fall-through.** Codex dispatches
  _twice_: the top-level `type` (`session_meta` / `response_item` /
  `event_msg`) selects the record, then an inner `payload.type` selects
  the payload variant — for `response_item` that is `function_call` /
  `function_call_output` / …, and for **`event_msg`** it is `user_message`
  / `exec_command_end` / `patch_apply_end` (`process_event_msg`,
  `codex:347`). All of these become typed enums (replacing the
  `value.get("type")` / `payload.get("type")` string compares), and
  **each** dispatch — top-level _and_ both inner ones — needs an explicit
  unknown/typeless fall-through (a `#[serde(other)]` tagged enum where
  `type` is always a present string; otherwise a small classifier), so an
  unrecognized record _or_ payload degrades rather than fails (dropping
  the `event_msg` fall-through would lose turns / test-run completions /
  patch completions). The `CompletionMode`-bearing `function_call` /
  output records are retained.

**What does NOT change.** The emitted events (F-EVENTS), the `in_flight` /
`num_turns` / `last_cwd` state machine, the `CompletionMode` logic, and
the loop (that is C). A-transcript swaps the extraction mechanism inside
`process_line` from `Value`-pull to DTO field access, plus a small set of
**behavior-neutral helper retargets** so the raw carve-out fields are read
from the typed field rather than re-fetched by key — chiefly
`extract_tool_result_content` taking the `content` value (not the
enclosing block); `summarize_input` already takes the `input` value. The
`process_line` signature is unchanged this phase — both take `line: &str`
(the `&Value` appears only in the per-shape helper fns), same state refs;
C later relocates the body into the decoder.

**Risk + mitigation.** The one risk is a `lenient_*` deserializer being
_stricter_ than the old `.get()` walk and silently dropping an event.
Mitigations: (1) the _reused_ helpers are the same ones A-status
validated against precisely this failure mode, and the two _new_ ones
(`lenient_bool` / `lenient_i64`) get their own unit tests (acceptance
below); (2) the existing per-line parse tests (§ 3 "existing coverage")
pin the shapes and run unchanged; (3) migrate shape-by-shape, each
shape's parse test green before the next. No behavior change is intended.

**Acceptance (Phase 1).** Both `process_line` bodies parse via DTOs; the
existing parse tests + the Phase 0 loop tests are green; **new unit tests
for `lenient_bool` / `lenient_i64`** cover missing / null / wrong-type /
valid inputs (mirroring the existing `serde_helpers` coverage, e.g.
`lenient_string_accepts_strings_rejects_others`); **plus DTO/event-level
regression cases** that feed a transcript line carrying a wrong-typed
`is_error` / `success` / `exit_code` and assert the event still emits with
the defaulted value — proving each DTO field actually carries
`deserialize_with = "lenient_*"` (a field that silently omits the
attribute still compiles and passes the standalone helper tests, but would
error or misclassify on real wrong-typed input). **Plus presence-sensitive
cases** pinning the `#[serde(flatten)]` handling: `tool_use.input` absent →
args `""` vs present-`null` → `"null"`; `payload.duration` absent → `None`
(computed-duration fallback) vs present-`null` / non-object → `Some(0)`.
Without these, an implementation could use a collapsing `Value
(#[serde(default)])` / `Option<Value>`, pass every other gate, and still
change args or duration. `git diff` touches only the two parse paths + new
DTO definitions + the two new helpers + the behavior-neutral helper
retargets (`extract_tool_result_content`, …) + the new tests. Emitted
events are **shape- and deterministic-field-equivalent** to pre-Phase-1:
identical variants and shapes, identical deterministic fields; the
nondeterministic ones (e.g. `duration_ms`, timestamp fallbacks) are
asserted by contract, not exact bytes.

## 5. Phase 2 — C: shared `TranscriptTailService` + injected `TranscriptDecoder`

**Interface** (`base/transcript_tail_service.rs`; the concrete form of § 2 G2):

```rust
pub(crate) trait TranscriptDecoder: Send {
    fn decode_line(&mut self, line: &str); // owns in_flight/num_turns/last_cwd/emitter
    fn on_caught_up(&mut self);            // replay→live; forwards to emitter.finish_replay()
}

pub(crate) struct TranscriptTailService {
    decoder: Box<dyn TranscriptDecoder>,
    provider_label: &'static str,          // for the unified read-error log (F-CONCURRENCY)
    poll_interval: Duration,               // POLL_INTERVAL in prod; Duration::ZERO in tests
}

impl TranscriptTailService {
    pub(crate) fn new(decoder: Box<dyn TranscriptDecoder>, provider_label: &'static str) -> Self; // poll_interval = POLL_INTERVAL
    #[cfg(test)] pub(crate) fn with_poll_interval(self, d: Duration) -> Self; // test override → Duration::ZERO; pub(crate) so the cross-module Claude split-line test (in claude_code) can call it
    // `mut self`: the loop mutates the decoder via decode_line / on_caught_up.
    pub(crate) fn run<R: BufRead>(mut self, reader: R, stop: Arc<AtomicBool>);
}
```

Each adapter builds its decoder with the per-session context (`events`,
`session_id`, `cwd`) — so the decoder owns all provider state — then wraps
it and spawns. The `Send` bound + the boxed-`'static` default let
`svc.run` move into `std::thread::spawn` (§ 2 G2).

**Loop body — preserves F-CONCURRENCY verbatim** (this is the current
`tail_loop` with the provider parts behind the decoder and the two
divergences resolved):

```rust
let mut reader = reader; // injected R: BufRead (BufReader<File> in prod, a mock in tests)
let mut line_buf = String::new();
let mut partial = String::new();
while !stop.load(Ordering::Acquire) {            // unchanged stop semantics
    line_buf.clear();
    match reader.read_line(&mut line_buf) {
        Ok(0) => { self.decoder.on_caught_up(); thread::sleep(self.poll_interval); }
        Ok(_) => {
            if !line_buf.ends_with('\n') { partial.push_str(&line_buf); continue; } // buffer
            let full = if partial.is_empty() { line_buf.as_str() }
                       else { partial.push_str(&line_buf); partial.as_str() };
            if let Some(line) = normalize(full) { self.decoder.decode_line(line); }
            partial.clear();
        }
        Err(e) => { log::warn!("Error reading {} line: {}", self.provider_label, e); thread::sleep(self.poll_interval); }
    }
}
```

**Resolving the two deferred engine-contract decisions (from § 1 / § 2):**

1. **Line normalization → strip only the terminator, keep the blank-line
   skip.** Claude currently `.trim()`s (all surrounding whitespace); Codex
   `trim_end_matches('\n')`. The shared `normalize(full)` strips the line
   terminator CRLF-safely — `trim_end_matches(['\r', '\n'])` (the same
   char-array pattern already used at `runtime/ipc.rs:275`) — and returns
   `None` when the remainder is blank _after a full `.trim()`_. For Claude
   the **blank-line skip is exact** (both skip a line blank after `.trim()`),
   while a **non-blank line is event-equivalent**: the engine strips only
   the terminator and leaves any surrounding whitespace Claude's `.trim()`
   would have removed, which `serde_json::from_str` tolerates identically.
   For Codex it is likewise **event-equivalent, not verbatim**: Codex today
   skips only the
   _exactly_ empty line (after `trim_end_matches('\n')`) and lets a
   whitespace-only line fall through to `process_line`, where it is a no-op
   parse failure (`codex:234`) — so no event either way, but the engine now
   skips it _before_ `decode_line` instead of after a failed parse. The
   engine does **not** strip leading/interior whitespace from a non-blank
   line: JSONL records start with `{` and `serde_json::from_str` tolerates
   incidental surrounding whitespace, so a record that parsed before still
   parses. (The content-level trims inside the decoder predicates — e.g.
   `is_user_prompt`'s `.trim()` on text — are unchanged; they run on parsed
   values, not the raw line.)
2. **EOF with a pending partial → keep buffering, do _not_ flush.** When
   `read_line` returns `Ok(0)` while `partial` is non-empty (the file ends
   mid-line, no `\n`), the engine calls `on_caught_up` + sleeps and leaves
   `partial` buffered for when the line completes — matching Codex today
   (the partial sits until a `\n` arrives). Rationale: during live tailing
   a newline-less tail means the record is still being written; emitting it
   would parse a truncated line. The only cost — a _permanently_
   newline-less final record (finished session whose last line lacks `\n`)
   never emits — is a non-case in practice (both writers newline-terminate
   records) and is exactly today's Codex behavior, so no regression. For
   Claude this is part of the intentional buffering standardization (G3).

**The deterministic buffering test (the one § 3 deferred here).** Drive
`run` **synchronously** with a `ScriptedBufRead` and a recording decoder —
no threads, no real file, no timing. To avoid any dependence on
`BufReader` internals, `ScriptedBufRead` **overrides `read_line`** (its
other `Read` / `BufRead` methods are unreachable — `run` only calls
`read_line`). Each script entry is one `read_line` call with the correct
signature `read_line(&mut self, buf: &mut String) -> io::Result<usize>`:
the entry **appends** its bytes to `buf` and returns `Ok(len)`, or appends
nothing and returns `Ok(0)` to signal EOF. The script must route the
service _through its own `Ok(0)` arm while `partial` is non-empty_ — the
contract under test. Cases (each "→" is one `read_line` call):

- **Partial survives a service-level EOF, then completes.** appends
  `{"a":1` (no `\n`), `Ok(6)` → buffered; → `Ok(0)` (appends nothing) →
  the service's EOF arm runs `on_caught_up` and **must not clear
  `partial`**; → appends `23}\n`, `Ok(4)` → completes; → `Ok(0)`→flip
  `stop`. Assert `decode_line` fired **once** with the assembled
  `{"a":123}`.
- **Truncated final record never emits — pins `on_caught_up` on the
  partial EOF.** appends `{"a":1`, `Ok(6)` → buffered; → `Ok(0)`→flip
  `stop` → the service's EOF arm runs. Assert `on_caught_up` fired
  **exactly once** (proving the partial-EOF arm ran — the survival case's
  "fired sometime" could be satisfied by a later EOF, so this case carries
  the ordering guarantee) and `decode_line` was **never** called (the
  partial stays buffered: EOF-keeps-buffering).
- **Normalization.** appending `{"a":1}\r\n`, then `Ok(0)`→flip `stop` →
  `decode_line` receives `{"a":1}` with **no** trailing `\r`; and a
  separate run appending `   \n` (whitespace-only), then `Ok(0)`→flip
  `stop` → `decode_line` is **not** called (blank-line skip). (Each case
  ends with the terminating `Ok(0)`/`stop` flip so `run` returns.) Pins
  the § 5 normalization contract.
- **Claude split-line _fix_, end-to-end (the G3 proof).** The cases above
  use a _recording_ decoder, so they prove **engine** assembly + the EOF
  policy provider-agnostically — not that any provider then _emits_. To
  prove the G3 fix (Claude now emits the previously-dropped split-line
  event), run the **real** `ClaudeTranscriptDecoder` + `FakeEventSink`
  through the service with a `ScriptedBufRead` that splits a real Claude
  tool-call line (`{"type":"assistant",…"tool_use"…}` halved where neither
  half is valid JSON): assert `FakeEventSink` records the `agent-tool-call`
  that the pre-C immediate-process path would have dropped. This test
  lives in `claude_code/transcript.rs`'s `#[cfg(test)] mod tests` (so
  `ClaudeTranscriptDecoder::new` is in scope) and reaches the base
  service's override via its `pub(crate)` `with_poll_interval`. (A Codex
  end-to-end analogue is optional — the engine assembly case + the
  existing Codex tests cover its _preserved_ buffering.)

This exercises the real service wiring — not a detached helper — keeping
the inline reused-buffer assembly (no per-line owned-`String` allocation).
The engine cases pin assembly + the EOF policy (Codex's buffering is thus
_preserved_); the Claude split-line **fix** (§ 1 G3) is proven end-to-end
by the real-decoder case. Together they replace the timing-based attempt
Phase 0 could not make deterministic. (The test builds the service with
`with_poll_interval(Duration::ZERO)` so the post-EOF sleep — which runs
_before_ the loop re-checks `stop` — is a no-op and the test is instant.)

**The spawn site collapses (G4).** Both adapters' `TranscriptStreamer::tail()`
already delegate to `transcript::start_tailing(events, session_id,
transcript_path, cwd)` (`claude_code/mod.rs:106`, `codex/mod.rs:149`), and
the Codex Phase 0 tests call `start_tailing` directly — so `start_tailing`
(in each `transcript.rs`) is the spawn site that changes; `tail()` stays a
one-line delegator. Validation is _not_ here: it is the separate
`TranscriptPathValidator::validate` method, so `start_tailing` just opens
the already-validated path (temp-path fixtures keep working). The body
becomes, identically for both adapters bar the decoder type + label:

```rust
fn start_tailing(events, session_id, transcript_path, cwd) -> Result<TranscriptHandle, String> {
    let file = File::open(&transcript_path).map_err(/* … */)?;   // open only — no re-validation
    let stop = Arc::new(AtomicBool::new(false));
    let decoder = Box::new(ClaudeTranscriptDecoder::new(events, session_id, cwd));
    // provider_label is the provider-distinct phrase; the loop logs
    // "Error reading {label} line: {e}", reproducing the two current
    // literals — Claude "transcript", Codex "Codex rollout transcript".
    let svc = TranscriptTailService::new(decoder, "transcript");
    let stop_clone = stop.clone();
    let join = std::thread::spawn(move || svc.run(BufReader::new(file), stop_clone));
    Ok(TranscriptHandle::new(stop, join))
}
```

The Phase-1-typed `process_line` body moves wholesale into
`<Provider>TranscriptDecoder::decode_line`; the per-session
`in_flight` / `num_turns` / `last_cwd` / `TestRunEmitter` become decoder
fields; `finish_replay()` is called from `on_caught_up`. The duplicated
`tail_loop` is deleted from both `transcript.rs` files. The 500 ms
`POLL_INTERVAL` const moves into `base/transcript_tail_service.rs` (the
service owns it; the two now-private per-provider `POLL_INTERVAL` consts
are deleted with their `tail_loop`s). The new
`base/transcript_tail_service.rs` is wired into `base/mod.rs` exactly like
`transcript_state` — `mod transcript_tail_service;` plus `pub(crate) use
transcript_tail_service::{TranscriptDecoder, TranscriptTailService};` — so
both provider decoders can implement the trait and build the service.

**Acceptance (Phase 2 / C).**

- `TranscriptTailService` + `TranscriptDecoder` land in `base` (wired via
  `base/mod.rs`); both `start_tailing` build + run the service (`tail()`
  stays a one-line delegator); both `tail_loop`s are deleted.
- Phase 0 **T-replay** tests stay green **unchanged** — they drive the
  existing entry points whose call shapes are preserved (Claude
  `start_or_replace`, Codex `start_tailing`), now exercising the new `run`.
- The deterministic engine buffering tests (`ScriptedBufRead` + recording
  decoder driving `run`) are green (assembly + EOF policy); and the
  end-to-end Claude split-line case (real `ClaudeTranscriptDecoder` +
  `FakeEventSink`) proves the G3 fix — the previously dropped event now
  emits.
- F-EVENTS holds except the two-sided G3 carve-out (Claude emits the
  previously dropped split-line event; no longer emits a permanently
  newline-less final record); F-CONCURRENCY (`Acquire` stop,
  `POLL_INTERVAL`, first-EOF `on_caught_up`, error→warn→sleep) preserved;
  the two duplicated `tail_loop`s collapse to one shared loop (the
  production scaffolding shrinks — the effort _adds_ DTOs/service/tests
  overall, so this is a dedup, not a net-LOC claim).

## 6. Step F — single-class session lifecycle (deferred capstone, NOT in this effort)

**What.** A session's lifecycle is currently spread across free functions
and several state holders: `base::start_for`, `AgentWatcherState` /
`WatcherHandle`, `TranscriptState` / the D' `AgentWatcherService`, the
locator, and — after C — `TranscriptTailService`. These pieces are
_temporally driven_: per session they fire in a fixed order (locate →
validate → start watcher → start tail → … → stop). Step F would hoist that
sequence behind a **single class with a minimal surface** — the caller
sees only the lifecycle verbs (`start(session)`, `stop(session)`, …) and
every step delegates to a private method or an **injected service**. The
verbs read as a short ordered sequence; the work stays in the services
that C / D' / the locator already provide.

**Why deferred (explicitly out of A-transcript + C).** It reshapes
`watcher_runtime` / the D' `AgentWatcherService` — a wider blast radius
than the transcript-only A + C — and only pays off _once C exists_
(`TranscriptTailService` is one of the services it would delegate to). So
it earns its own spec + go/no-go **after** A-transcript + C land, and is
recorded on #246 as the deferred capstone. Nothing in A-transcript or C
depends on it; it is a later, optional re-shape.

**Scope sketch (intent for the future spec — not commitments).** Likely a
`SessionLifecycle`-style type owning `{ locator, validator, watcher
service, transcript service }` as injected dependencies, exposing
`start` / `stop`, each verb a thin sequence over private steps. No new
IPC, no event-surface change, no new bindings — a purely internal
re-shape of the orchestration `start_for` performs today. The frozen
constraints from § 2 (F-EVENTS, F-CONCURRENCY, F-ATTACH) would carry
forward unchanged into that effort.

## 7. Sequencing, PR structure, risks, acceptance

**PR structure — three sequential PRs against `refactor/agent-adapter`**
(the #246 integration branch, following the established per-step cadence:
implement → local `codex exec` to zero findings → push → PR →
`/lifeline:upsource-review` → `/approve-pr`):

| PR                         | Scope                                                                                                                                                                                              | Gate                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0 — tests**        | `T-replay` (both adapters): ≥3 replay pairs, catch-up + drain barriers, `Some(cwd)`. **No production change.**                                                                                     | both transcript suites green; `git diff` = test code only                                                                    |
| **Phase 1 — A-transcript** | typed DTOs + `lenient_bool` / `lenient_i64` in both `process_line` paths (option B); behavior-neutral helper retargets; DTO/event regression tests (incl. presence-sensitive `input` / `duration`) | existing parse + Phase 0 tests green; events shape- and deterministic-field-equivalent (nondeterministic fields by contract) |
| **Phase 2 — C**            | `TranscriptTailService` + `TranscriptDecoder` in `base`; both `start_tailing` delegate; the two `tail_loop`s deleted; deterministic `ScriptedBufRead` buffering test                               | Phase 0 tests green **unchanged**; buffering test green; G3 effects realized                                                 |

The order is forced: Phase 0 builds the regression net before Phase 1/2
touch the code it guards; Phase 1 types the bodies before Phase 2 relocates
them into decoders (the pairing rationale, § 1). Each PR is independently
green and revertable.

**Risk register (consolidated):**

- **DTO behavior drift** — a lenient field stricter than the old `.get()`
  walk silently dropping an event. Mitigated by the existing per-line
  parse tests (run unchanged), the shape-by-shape migration, and the new
  DTO/event regression cases that feed wrong-typed `is_error` / `success`
  / `exit_code` (§ 4).
- **Claude buffering change (G3, both effects)** — pinned by § 5's
  deterministic `ScriptedBufRead` tests; the EOF-loss side is benign and
  documented in the F-EVENTS carve-out (§ 2).
- **Raw carve-out mis-typing** (`content` / `input` / `arguments` /
  `output` / `duration`) — the § 4 boundary keeps them raw + ported
  helpers; present-vs-absent (`input`, `duration`) is handled by the
  `#[serde(flatten)]` raw map, not a collapsing `Option`.
- **Two-level Codex dispatch** — top-level `type` _and_ both inner
  `payload.type` dispatches (`response_item`, `event_msg`) need
  fall-throughs, or turns / test-run / patch completions drop (§ 4).
- **ts-rs drift** — transcript DTOs are internal (no `#[derive(TS)]`); if
  `cargo test` perturbs `src/bindings/`, `git restore src/bindings/`
  before commit (F-BINDINGS).

**Overall acceptance.** All three PRs merged to `refactor/agent-adapter`;
F-EVENTS (+ the two-sided G3 carve-out), F-CONCURRENCY, F-ATTACH, and
F-BINDINGS hold; the two duplicated `tail_loop`s collapse to one shared
loop (production-scaffolding dedup — the effort adds DTOs/service/tests
overall, so it is _not_ a net-LOC reduction); both transcript parsers are
typed (option B). #246's **A-transcript** and **C** boxes tick.

**#246 checklist update.** On completion, tick **A-transcript** and **C**,
and **add Step F** (§ 6) as a new deferred-capstone line with its own
future go/no-go — recorded now so the intent isn't lost once A + C land.

<!-- codex-reviewed: 2026-05-26T03:41:38Z -->
