# Agent adapter — Codex critique of the refactor proposal

> **Date:** 2026-05-22
> **Reviewer:** codex-cli 0.133.0 (default model, ChatGPT-account auth)
> **Subject:** [`README.md`](./README.md) (the A→B→D refactor proposal)
> **Prompt:** see "Prompt used" at the bottom.

Codex was asked to identify dangers and blockers the proposal underestimated
or missed. Output below is the verbatim list of findings, followed by a
synthesis and a revised sequence.

## Findings

### 1. A first can freeze the wrong transcript-path boundary

`ParsedStatus.transcript_path` is not purely decoded state for Codex; it is
a side channel from `status_source` into `parse_status` via
`resolved_rollout_path` in [`codex/mod.rs:85`](./codex/mod.rs), then
consumed by `base` in
[`base/watcher_runtime.rs:320`](./base/watcher_runtime.rs).

> 💡 IDEA
>
> - **I — Intent:** A wants `parse_status` to become a simple
>   schema-to-event conversion.
> - **D — Danger:** landing A around the current `ParsedStatus` shape
>   preserves the Codex mutex coupling and makes B's "stateless
>   `StateDecoder`" harder, not easier.
> - **E — Explain:** the rollout path belongs to location/session
>   binding, not JSON state decoding.
> - **A — Alternatives:** move transcript path into `StatusSource` or an
>   attach/session context **before** A, then make state decoding return
>   only status state.

### 2. `StateDecoder::decode(raw)` drops required context

Current decoding needs the Vimeflow session id to stamp emitted status
events: see `parse_status(&self, session_id, raw)` in
[`mod.rs:34`](./mod.rs), Claude event construction in
[`claude_code/statusline.rs:52`](./claude_code/statusline.rs), and Codex
`into_event(session_id)` in [`codex/parser.rs:36`](./codex/parser.rs).

> 💡 IDEA
>
> - **I — Intent:** B tries to make state decoding independent and
>   reusable.
> - **D — Danger:** a decoder returning `ParsedStatus` cannot be
>   context-free unless session stamping moves elsewhere.
> - **E — Explain:** provider JSON contains the agent session id, but the
>   frontend event needs the PTY session id.
> - **A — Alternatives:** decode to provider-neutral status data, then
>   have runtime/session code attach `session_id`, or pass an explicit
>   decode context.

### 3. A's serde risk is misstated — the real risk is null/missing/JSONL tolerance

Serde structs **ignore** unknown fields by default, contrary to
[`README.md:197`](./README.md); the real risk is required fields and enum
variants failing where current code defaults, skips, or preserves prior
state.

> 💡 IDEA
>
> - **I — Intent:** make schemas discoverable without losing upstream
>   tolerance.
> - **D — Danger:** Claude `used_percentage: null` only survives if
>   conversion preserves the computed/clamped fallback in
>   [`claude_code/statusline.rs:97`](./claude_code/statusline.rs), and
>   Codex `info: null` only survives if the fold does not clear prior
>   token state in [`codex/parser.rs:195`](./codex/parser.rs).
> - **E — Explain:** Codex is JSONL, not a JSON document; current parsing
>   skips incomplete trailing lines and malformed mid-lines in
>   [`codex/parser.rs:18`](./codex/parser.rs).
> - **A — Alternatives:** use loose DTOs with `#[serde(default)]`,
>   catch-all enum variants, and line-by-line fallible parsing; keep the
>   existing fixture tests as contract tests.

### 4. Codex location does not fit `locate(cwd, sid)`

Codex binding needs agent pid and PTY start time from [`mod.rs:148`](./mod.rs),
stored on `CodexAdapter` in [`codex/mod.rs:24`](./codex/mod.rs), while
`BindContext` explicitly excludes `session_id` in
[`codex/types.rs:7`](./codex/types.rs).

> 💡 IDEA
>
> - **I — Intent:** make location a replaceable concern.
> - **D — Danger:** the proposed locator trait either hides attach-time
>   state inside objects again or cannot implement Codex correctly.
> - **E — Explain:** Codex uses SQLite, `/proc` resume args, open rollout
>   fds, cwd, and PTY timing; see
>   [`codex/locator.rs:281`](./codex/locator.rs) and
>   [`codex/locator.rs:465`](./codex/locator.rs).
> - **A — Alternatives:** introduce an `AttachContext` carrying
>   `session_id`, cwd, shell pid, agent pid, PTY start, and provider
>   home/proc roots.

### 5. Path security is a separate service, not part of `TranscriptStreamer`

Status-source trust enforcement happens in `base` before watching in
[`base/mod.rs:32`](./base/mod.rs), and transcript validation feeds
structured diagnostics in
[`base/watcher_runtime.rs:153`](./base/watcher_runtime.rs).

> 💡 IDEA
>
> - **I — Intent:** keep unsafe provider paths out of the runtime.
> - **D — Danger:** folding `validate` into `TranscriptStreamer` hides a
>   security boundary and leaves status-source trust as an orphan
>   concern.
> - **E — Explain:** `ValidateTranscriptError` variants drive `TxOutcome`
>   classification, not just adapter-local failure handling.
> - **A — Alternatives:** make `PathPolicy` or
>   `TranscriptPathValidator` explicit, and keep `StatusSource { path,
trust_root }` verification in the session/runtime layer.

### 6. `TranscriptState` is coupled to adapter spawning and lock ordering

`TranscriptState::start_or_replace` accepts `Arc<dyn AgentAdapter>` and
calls `tail_transcript` inside a carefully gated replace flow in
[`base/transcript_state.rs:101`](./base/transcript_state.rs) and
[`base/transcript_state.rs:168`](./base/transcript_state.rs).

> 💡 IDEA
>
> - **I — Intent:** split streaming from the rest of the adapter trait.
> - **D — Danger:** B touches concurrency-critical lifecycle code,
>   including the old-before-new stop invariant tested in
>   [`base/transcript_state.rs:412`](./base/transcript_state.rs).
> - **E — Explain:** `TranscriptHandle` is only the visible leak; the
>   registry also relies on adapter cloning, per-session start gates, and
>   replace semantics.
> - **A — Alternatives:** first change `TranscriptState` to depend on
>   `Arc<dyn TranscriptStreamer>` while preserving its tests, then split
>   the outer adapter.

### 7. CWD is a live runtime input, not attach-time data

`base` intentionally re-reads cwd from `PtyState` on every transcript
start attempt in
[`base/watcher_runtime.rs:137`](./base/watcher_runtime.rs) and
[`base/watcher_runtime.rs:184`](./base/watcher_runtime.rs), and
`TranscriptState` treats cwd changes as replacement identity in
[`base/transcript_state.rs:155`](./base/transcript_state.rs).

> 💡 IDEA
>
> - **I — Intent:** keep test-run parsing scoped to the live workspace
>   cwd.
> - **D — Danger:** a facade that captures cwd at attach time regresses
>   mid-session `cd` handling and test-run snapshots.
> - **E — Explain:** Claude and Codex transcript parsers both use cwd
>   for command matching and snapshot building.
> - **A — Alternatives:** model cwd as a live
>   `SessionContext`/`CwdProvider`, or leave cwd refresh in the runtime
>   layer and document it as part of the facade contract.

### 8. The `AgentSession` value facade does not match the IPC lifetime model

IPC only passes `sessionId` for start/stop in
[`runtime/ipc.rs:462`](../../../runtime/ipc.rs), while `BackendState`
owns shared `PtyState`, `AgentWatcherState`, `TranscriptState`, and
`EventSink` in [`runtime/state.rs:181`](../../../runtime/state.rs).

> 💡 IDEA
>
> - **I — Intent:** hide adapter internals from the IPC layer.
> - **D — Danger:** `detach(self)` is not usable when the caller never
>   receives or stores an `AgentSession` object.
> - **E — Explain:** current lifetime ownership is registry-based:
>   `AgentWatcherState` stores handles and `stop_agent_watcher_inner`
>   removes by session id.
> - **A — Alternatives:** build an
>   `AgentWatcherService`/`AgentSessions` facade with
>   `start(session_id)` and `stop(session_id)`, **not** a returned RAII
>   session object.

### 9. Estimates are optimistic because the proposal crosses tested behavior seams

A is only ~1 day if it is status-only; full "schema-first" touches Claude
transcript parsing, Codex transcript parsing, and Codex status folding
across roughly **2.8k lines** of parser/tailer code.

> 💡 IDEA
>
> - **I — Intent:** sequence small refactors with low regression risk.
> - **D — Danger:** A+B+D together touch `statusline.rs`, both
>   `transcript.rs` files, `parser.rs`, `locator.rs`,
>   `watcher_runtime.rs`, `transcript_state.rs`, and IPC state wiring.
> - **E — Explain:** many tests encode edge behavior: nulls, partial
>   JSONL lines, malformed lines, cwd replacement, duplicate-tail
>   prevention, path-security diagnostics.
> - **A — Alternatives:** add a **seam-prep step first**: move transcript
>   path out of `ParsedStatus`, introduce `AttachContext`, and preserve
>   the current runtime tests before converting parsers to typed DTOs.

## Synthesis — three recurring themes

1. **The proposal under-modelled "attach-time context".** Findings #1, #2,
   #4, #7 all converge on the same gap: there is no `AttachContext` /
   `SessionContext` carrying `{ session_id, cwd, shell_pid, agent_pid,
pty_start, provider_home, proc_root }` as a single bag. Without it,
   every split has to invent its own arg shape, and Codex's stateful
   adapter survives the refactor unchanged.

2. **A's tolerance story was wrong.** Finding #3 corrects a factual error
   in the README: serde ignores unknown fields by default, so the real
   risk is **preserving null/missing/computed-fallback behavior**, not
   rejecting unknown fields. DTOs must be loose (`#[serde(default)]`,
   catch-all enum variants, line-by-line fallible parsing).

3. **D's shape was wrong.** Findings #6, #7, #8 all push back on
   `AgentSession` as a RAII value type. The real IPC model is registry
   start/stop by `session_id`; D should be an `AgentWatcherService`, not
   a returned `Self`. CWD must stay a live runtime input, not captured
   at attach.

## Revised sequence (proposed)

| Step | Original            | Revised                                                                                                                                                                | Why                                                 |
| ---- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 0    | _(none)_            | **Seam prep**: introduce `AttachContext` and move `transcript_path` out of `ParsedStatus` (into `StatusSource` or `AttachContext`). Keep all existing tests passing.   | Addresses #1, #2, #4, #7 before any wider refactor. |
| A'   | Schema-first serde  | Same intent, but loose DTOs (`#[serde(default)]`, catch-all variants) + line-by-line fallible parsing + existing fixtures become contract tests.                       | Addresses #3.                                       |
| B'   | 3-trait split       | 4-trait split: `StatusSourceLocator`, `StateDecoder` (provider-neutral output), `TranscriptStreamer`, `TranscriptPathValidator`. Composition struct = `AgentBindings`. | Addresses #4, #5.                                   |
| B''  | _(implicit)_        | Re-shape `TranscriptState` to depend on `Arc<dyn TranscriptStreamer>` while preserving its tests, **before** finishing the outer adapter split.                        | Addresses #6.                                       |
| D'   | `AgentSession` RAII | `AgentWatcherService` registry facade with `start(session_id)` / `stop(session_id)`. CWD stays a live `PtyState` lookup.                                               | Addresses #7, #8.                                   |
| C    | Common tailer       | Unchanged — still optional, still must absorb `CompletionMode`.                                                                                                        | n/a                                                 |

The big change: **step 0 is mandatory and lands first**, decoupled from
everything else. Once the attach context exists, A' / B' / D' each get a
smaller, less invasive shape.

Revised cost estimates (conservative, after codex feedback):

- Step 0 (seam prep): **~1 day** — small but invasive; touches both
  adapters and base.
- A' (loose DTOs): **~1.5–2 days** — bigger than ~1d because it crosses
  ~2.8k lines and many edge-case tests.
- B' + B'' (split + TranscriptState re-shape): **~2–3 days** — the
  TranscriptState concurrency invariants are the hard part.
- D' (service facade): **~0.5–1 day** — simpler than original D
  because we're not inventing a RAII type.
- **Total:** ~5–7 days, vs. the original ~2.5–3.5d estimate.

---

# Round 2 (2026-05-22)

> **Reviewer:** codex-cli 0.133.0
> **Subject:** the revised plan v1 above
> **Prompt:** see "Prompts used" at the bottom.

Codex was asked to (a) verify each of the 9 Round 1 findings is actually
closed by v1's mapped step, and (b) surface any new issues introduced by
the revision. Output: a partial-closure check plus 5 new findings.

## Closure check on Round 1's revised plan (v1)

| Finding                               | Closed by v1?                                                 |
| ------------------------------------- | ------------------------------------------------------------- |
| #1 `transcript_path` side channel     | **Partial** — move not backward-compatible. See R2.1.         |
| #2 `StateDecoder` drops context       | **Partial** — Step 0 alone insufficient. See R2.2.            |
| #3 Serde tolerance wording            | **Conditional** — DTO precision required. See R2.4.           |
| #4 Codex location fit                 | **Partial** — `AttachContext` field set incomplete. See R2.3. |
| #5 Path security as own service       | **Closed.**                                                   |
| #6 `TranscriptState` adapter coupling | **Closed if B'' implemented exactly.**                        |
| #7 CWD as runtime input               | **Mostly closed**, depends on `AttachContext` wording (R2.3). |
| #8 IPC lifetime model                 | **Closed.**                                                   |
| #9 Cost realism                       | **Mostly closed**, estimates depend on gaps above.            |

## New findings (R2.1 – R2.5)

### R2.1. Step 0's `transcript_path` move is not backward-compatible

Moving `ParsedStatus.transcript_path` directly into `StatusSource` or
`AttachContext` does not fit the current watcher flow. `StatusSource` is
computed **once** in `base::start_for` at
[`base/mod.rs:32`](./base/mod.rs), but `watcher_runtime` currently
**re-discovers** transcript paths on **every** status update at
[`base/watcher_runtime.rs:320`](./base/watcher_runtime.rs),
[`base/watcher_runtime.rs:393`](./base/watcher_runtime.rs), and
[`base/watcher_runtime.rs:485`](./base/watcher_runtime.rs). Claude's path
is **dynamic JSON content** from
[`claude_code/statusline.rs:215`](./claude_code/statusline.rs), while
Codex's path is **locator output** currently smuggled through
`resolved_rollout_path` at [`codex/mod.rs:85`](./codex/mod.rs).

> 💡 IDEA
>
> - **I — Intent:** remove Codex's locator-to-parser mutex coupling
>   before schema refactors.
> - **D — Danger:** a one-time `StatusSource.transcript_path` preserves
>   Codex but regresses Claude path changes and the watcher diagnostics
>   around `tx_path`.
> - **E — Explain:** there are **two path origins** today —
>   static/source-bound for Codex, dynamic/status-payload-bound for
>   Claude. A single static field can't represent both.
> - **A — Alternatives:** introduce an explicit `TranscriptPathHint` /
>   `StatusObservation` outside status state. `StatusSource` may carry
>   a static hint; the status-parse path may carry a dynamic hint.

### R2.2. Finding #2 is not closed by Step 0 alone

`AttachContext` can carry `session_id`, but that does not make decoding
context-free. Current decoders **stamp** the Vimeflow `session_id`
**inside** `parse_status(&self, session_id, raw)` at
[`mod.rs:34`](./mod.rs), Claude event construction at
[`claude_code/statusline.rs:52`](./claude_code/statusline.rs), and Codex
`into_event(session_id)` at [`codex/parser.rs:63`](./codex/parser.rs).
The v1 table maps #2 to Step 0, but the real closure is B': decode to a
provider-neutral `StatusSnapshot`, then runtime stamps `session_id`.

> 💡 IDEA
>
> - **I — Intent:** keep `StateDecoder` reusable and not tied to PTY /
>   frontend session IDs.
> - **D — Danger:** passing `AttachContext` into `StateDecoder` just
>   renames the old context dependency and keeps decoding coupled to
>   runtime identity.
> - **E — Explain:** provider JSON has the **agent** session identity;
>   Vimeflow event identity belongs to runtime / session orchestration.
> - **A — Alternatives:** `StateDecoder::decode(raw) -> StatusSnapshot`,
>   then watcher runtime builds `AgentStatusEvent { session_id,
...snapshot }`.

### R2.3. `AttachContext` field set incomplete and wrong location

The v1 table doesn't pin down the field set. Codex `BindContext` only
carries `cwd`, `pid`, `pty_start` at
[`codex/types.rs:14`](./codex/types.rs); `/proc` is hidden inside
`SqliteFirstLocator` at [`codex/locator.rs:104`](./codex/locator.rs);
transcript validators still call `dirs::home_dir()` directly at
[`claude_code/transcript.rs:85`](./claude_code/transcript.rs) and
[`codex/transcript.rs:116`](./codex/transcript.rs). `AttachContext`
needs: `session_id`, `initial_cwd`, `shell_pid`, `agent_pid`,
`pty_start`, `agent_type`, provider roots (`codex_home`, `claude_home`
or a resolver), and `proc_root`. The type should live in a new
`adapter/attach.rs` (or `adapter/context.rs`), **not `base/`** —
locators and validators must not depend on watcher-runtime internals.

> 💡 IDEA
>
> - **I — Intent:** make attach-time facts visible so Codex locator
>   state stops leaking through adapter fields.
> - **D — Danger:** if roots / proc / session fields stay hidden in
>   provider objects, `AgentBindings` becomes the same opaque state
>   bag as today's adapter.
> - **E — Explain:** `base` owns orchestration; attach context is part
>   of the adapter contract used by locator, binding factory, and
>   tests.
> - **A — Alternatives:** split `AttachContext` (immutable attach-time
>   facts) from `SessionRuntimeContext` (live cwd from PtyState). Use
>   `initial_cwd` for binding; keep live cwd lookup in `PtyState`.

### R2.4. A' DTO precision is insufficient

`#[serde(default)]` + catch-all variants is necessary but not
sufficient. Concretely:

- Claude `used_percentage` must be `Option<f64>` with
  `#[serde(default)]`, not `f64`, so `null` reaches the computed
  fallback at
  [`claude_code/statusline.rs:97`](./claude_code/statusline.rs).
- Codex `token_count.info` must be `#[serde(default)] info:
Option<TokenCountInfoDto>`, and folding must update
  `last_token_count_info` **only on `Some(info)`** to preserve the
  prior-state behavior at [`codex/parser.rs:195`](./codex/parser.rs).
- `#[serde(default)]` does **not** tolerate wrong-typed present
  fields (e.g. integer where float expected); current `Value::as_*`
  parsing is lenient. If wrong-type tolerance matters, DTO fields
  need `deserialize_with = "..."` per field or `Value` fallback
  wrappers.

> 💡 IDEA
>
> - **I — Intent:** make schemas discoverable without turning upstream
>   partial data into parse failures.
> - **D — Danger:** plain serde DTOs can clear token state to zero on
>   `info: None`, or reject a valid-but-partial line that current code
>   silently ignores.
> - **E — Explain:** `Option<T>` handles null/missing; it does not
>   handle wrong-type drift. `default` only applies when a field is
>   absent.
> - **A — Alternatives:** define DTOs as **lossy contracts** — `Option`
>   for nullable state, catch-all enum variants, and per-field
>   tolerant helpers (`deserialize_with`) where current `Value`
>   parsing defaults.

### R2.5. B' missing explicit boundary for transcript-path extraction

`TranscriptPathValidator` validates a raw path, but it does not answer
**where the raw path came from**. The four traits fit location, status
decoding, validation, and streaming — but **not** Claude's dynamic
extraction from status JSON vs. Codex's static path from location.
Without this boundary, either `StateDecoder` keeps returning non-state
metadata, or `AgentBindings` hides another side channel.

> 💡 IDEA
>
> - **I — Intent:** split provider concerns without losing the security
>   boundary around transcript files.
> - **D — Danger:** the new traits can recreate today's
>   `ParsedStatus.transcript_path` leak under a different name.
> - **E — Explain:** **extraction** and **validation** are separate
>   concerns; validation cannot replace extraction.
> - **A — Alternatives:** add `TranscriptPathSource` /
>   `TranscriptPathResolver`; or make `StatusObservation` contain
>   `{ status_snapshot, transcript_hint }` while keeping `StateDecoder`
>   status-only.

## Revised plan v2

Key changes from v1:

1. **Step 0 splits into 0a / 0b / 0c** (AttachContext, SessionRuntimeContext, TranscriptPathSource extraction).
2. **B' becomes a 5-trait split** (adds `TranscriptPathSource`).
3. **A' gets precise DTO specs** (per-field `Option<T> + #[serde(default)]`, Some-only fold for token state, wrong-type tolerance via custom deserializers).
4. **`StateDecoder` returns `StatusSnapshot`** (no `session_id`); runtime composes `AgentStatusEvent { session_id, ...snapshot }`.

| Step    | v1                       | v2                                                                                                                                                                                                                                                                                                                        | Addresses              |
| ------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **0a**  | "Seam prep"              | Define `AttachContext` in a **new** `crates/backend/src/agent/adapter/attach.rs` (NOT `base/`). Fields: `session_id`, `initial_cwd`, `shell_pid`, `agent_pid`, `pty_start`, `agent_type`, `codex_home`, `claude_home_or_resolver`, `proc_root`. Immutable attach-time facts.                                              | R2.3                   |
| **0b**  | _(implicit)_             | Add `SessionRuntimeContext` (distinct from `AttachContext`): carries the live `PtyState` handle for cwd lookups. AttachContext = immutable; SessionRuntimeContext = live.                                                                                                                                                 | R2.3, #7               |
| **0c**  | "move transcript_path"   | Introduce `TranscriptPathSource` extraction (trait or paired types): handles Claude's **dynamic** path (from status JSON) AND Codex's **static** path (from locator). `StatusSource` may carry a static hint; `StatusObservation` (returned by decoder) may carry a dynamic hint. Removes `ParsedStatus.transcript_path`. | #1, R2.1, R2.5         |
| **A'**  | loose DTOs (vague)       | Loose DTOs with **precise** specs: `Option<T> + #[serde(default)]` on every nullable/missing field; fold must preserve token state on `info: None` (Codex); wrong-type tolerance via `deserialize_with` per field or `Value` fallback wrappers.                                                                           | #3, R2.4               |
| **B'**  | 4-trait split            | **5-trait split**: `StatusSourceLocator`, `StateDecoder` (returns `StatusSnapshot`, **no `session_id`**), `TranscriptPathSource`, `TranscriptPathValidator`, `TranscriptStreamer`. Watcher runtime composes `AgentStatusEvent { session_id, ...snapshot }`.                                                               | #2, #4, #5, R2.2, R2.5 |
| **B''** | TranscriptState re-shape | **Unchanged.** Preserve: per-session `start_gate` Mutex ([`transcript_state.rs:117`](./base/transcript_state.rs)), old-before-new stop order ([`transcript_state.rs:153`](./base/transcript_state.rs)), regression test at line 428.                                                                                      | #6                     |
| **D'**  | `AgentWatcherService`    | **Unchanged.** Owns/clones `PtyState`, `AgentWatcherState`, `TranscriptState`, `EventSink`. `start(session_id)` builds `AttachContext` from live `PtyState`; `stop(session_id)` removes the watcher.                                                                                                                      | #7, #8                 |
| **C**   | common tailer            | **Unchanged.** Still optional. Engine must support Codex `CompletionMode` + partial-line buffering.                                                                                                                                                                                                                       | n/a                    |

### Revised cost estimates (post-Round-2)

- 0a (AttachContext): **~0.5 day**
- 0b (SessionRuntimeContext): **~0.25 day**
- 0c (TranscriptPathSource extraction): **~1 day**
- A' (precise DTOs + wrong-type tolerance): **~2 days**
- B' (5-trait split + AttachContext plumbing): **~1.5 day**
- B'' (TranscriptState re-shape): **~1.5 day**
- D' (AgentWatcherService): **~0.5–1 day**
- **Total v2: ~7–9 days** (vs. v1's ~5–7d, original ~2.5–3.5d)

---

# Round 3 (2026-05-22)

> **Reviewer:** codex-cli 0.133.0
> **Subject:** the v2 plan from Round 2

Codex was asked to (a) verify closure on R2.1–R2.5, (b) regression-check
the original 9, and (c) surface any new issues introduced by v2's
reshape. Output: 5 new findings (R3.1–R3.5).

## Closure check on Round 2's revised plan (v2)

| Round 2 finding                             | Closed by v2?                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| R2.1 `transcript_path` move backward-compat | **Mostly.** `StatusObservation` vs `StatusSnapshot` wording still ambiguous. See R3.1. |
| R2.2 Step 0 alone insufficient for #2       | **Closed.** `StatusSnapshot` + runtime session-id stamping is correct.                 |
| R2.3 `AttachContext` field set + location   | **Mostly.** `AgentBindings` underspecified. See R3.2.                                  |
| R2.4 A' DTO precision                       | **Closed.** Per-field `Option`, Some-only fold, wrong-type tolerance covered.          |
| R2.5 transcript-path extraction boundary    | **Partial.** `TranscriptPathSource` direction right but contract unpinned. See R3.1.   |

## Regression check on original 9 findings

| Round 1 finding        | v2 status                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| #1, #4                 | **Conditionally closed.** Transcript-path extraction & Codex locator binding still under-specified. |
| #2, #3, #5, #6, #7, #8 | **Not re-opened.**                                                                                  |
| #9 (cost realism)      | **Improved**, but A' scope (status-only vs. full schema-first) determines whether estimate holds.   |

## New findings (R3.1 – R3.5)

### R3.1. `TranscriptPathSource`, `StatusObservation`, `StatusSnapshot` ownership overlap

v2 says `StatusObservation` returned by the decoder may carry the
dynamic hint, but it also says `StateDecoder` returns `StatusSnapshot`
only. **Those cannot both be the stable contract.** Pin one flow before
implementation: either `StateDecoder::decode(raw) -> StatusSnapshot`
**and** `TranscriptPathSource::dynamic_hint(raw, &LocatedStatusSource) -> Option<RawTranscriptPath>`,
or rename the decoder contract to return an observation that explicitly
includes both status and hint.

> 💡 IDEA
>
> - **I — Intent:** preserve Claude's per-update transcript extraction
>   and Codex's once-bound rollout path without keeping
>   `ParsedStatus.transcript_path`.
> - **D — Danger:** the current wording can recreate today's non-state
>   side channel in a new wrapper, or force duplicate raw-JSON parsing
>   for Claude.
> - **E — Explain:** the watcher extracts transcript paths on every
>   parse path at [`base/watcher_runtime.rs:320`](./base/watcher_runtime.rs);
>   Codex currently smuggles the located path through a mutex at
>   [`codex/mod.rs:85`](./codex/mod.rs).
> - **A — Alternatives:** introduce `LocatedStatusSource { status_path,
trust_root, static_transcript_hint }` plus `StatusSnapshot`; let
>   `TranscriptPathSource` select `dynamic_hint(raw)` for Claude and
>   `static_hint` for Codex.

### R3.2. `AgentBindings` needs to be specified as the per-attach owner, not just named

v2 still does not define what `AgentBindings` owns, where it lives, or
how the factory builds it from `AttachContext`. **This is where Codex's
current stateful fields in [`codex/mod.rs:24`](./codex/mod.rs) must
disappear** — otherwise the 5-trait split still hides `pid`, `pty_start`,
roots, and resolved rollout state inside provider objects.

> 💡 IDEA
>
> - **I — Intent:** replace the monolithic adapter with explicit
>   provider capabilities.
> - **D — Danger:** without a concrete binding struct, `AttachContext`
>   exists but doesn't prevent opaque per-provider state bags.
> - **E — Explain:** `start_agent_watcher_inner` currently resolves
>   attach facts at [`mod.rs:148`](./mod.rs), then constructs one
>   adapter object at [`mod.rs:151`](./mod.rs).
> - **A — Alternatives:** add `crates/backend/src/agent/adapter/bindings.rs`
>   with `AgentBindings { agent_type, locator, decoder, transcript_paths,
validator, streamer }` and `AgentBindings::for_attach(&AttachContext)
-> Result<Self, String>`.

### R3.3. B'' needs an explicit visibility decision for `TranscriptStreamer`

`TranscriptState::start_or_replace` is currently `pub` and takes
`Arc<dyn AgentAdapter>` at
[`base/transcript_state.rs:101`](./base/transcript_state.rs). If it
changes to `Arc<dyn TranscriptStreamer>`, that trait must either be
`#[doc(hidden)] pub` too, or `start_or_replace` must become
`pub(crate)`. The current `TranscriptHandle::new` remains `pub(crate)`
at [`base/transcript_state.rs:26`](./base/transcript_state.rs); that
constraint must be preserved.

> 💡 IDEA
>
> - **I — Intent:** decouple transcript lifecycle from the full adapter
>   trait while preserving tested replace ordering.
> - **D — Danger:** an unplanned visibility mix can either fail Rust's
>   public-interface checks or accidentally widen the supported
>   extension API.
> - **E — Explain:** the existing `#[doc(hidden)] pub` surface is
>   already a compromise because `TranscriptHandle` appears in a public
>   trait signature.
> - **A — Alternatives:** make `TranscriptStreamer` `#[doc(hidden)]
pub` and keep the constructor gated, **or** reduce
>   `TranscriptState::start_or_replace` to `pub(crate)` if integration
>   tests don't need it.

### R3.4. Locator split should expose only `CompositeLocator` as `StatusSourceLocator`

v2 must explicitly say that `CompositeLocator` is the Codex
`StatusSourceLocator`, while `SqliteFirstLocator` and `FsScanFallback`
remain Codex-private strategies. Making each one a top-level locator
would leak fallback policy and schema-drift dispatch out of
[`codex/locator.rs:589`](./codex/locator.rs).

> 💡 IDEA
>
> - **I — Intent:** make location replaceable without making the
>   watcher runtime understand Codex internals.
> - **D — Danger:** exposing each sub-locator separately pushes the
>   `schema drift -> fs fallback` policy into `AgentBindings` or
>   runtime code.
> - **E — Explain:** today the fallback chain is cleanly contained in
>   `CompositeLocator::resolve_rollout` at
>   [`codex/locator.rs:603`](./codex/locator.rs).
> - **A — Alternatives:** implement the new `StatusSourceLocator` only
>   for `CompositeLocator`; keep `SqliteFirstLocator` / `FsScanFallback`
>   under a Codex-private `CodexSessionLocator`.

### R3.5. The ~7–9d estimate is realistic only if A' is status-first, not full schema-first

The estimate is now much closer to reality, but A' still reads like
the original "schema-first refactor" could include transcript tailers.
If A' includes Claude AND Codex transcript DTO conversion, **2 days is
still optimistic** given the stateful tail loops and Codex
`CompletionMode` paths in
[`codex/transcript.rs:28`](./codex/transcript.rs).

> 💡 IDEA
>
> - **I — Intent:** give the refactor a believable budget after adding
>   seam prep.
> - **D — Danger:** undercounting A' recreates the original risk: one
>   step touches status parsing, transcript parsing, watcher flow, and
>   fixture contracts.
> - **E — Explain:** status DTOs are bounded; full transcript DTO
>   migration crosses both transcript tailers plus partial-line and
>   replay behavior.
> - **A — Alternatives:** **split A' into `A-status` (before B') and
>   `A-transcript` (after B''/D')**, or explicitly defer transcript
>   DTOs.

## Revised plan v3

Key changes from v2:

1. **Pin the contract** between `StatusSource` / `StatusSnapshot` / `TranscriptPathSource`:
   - `LocatedStatusSource { status_path, trust_root, static_transcript_hint }`
   - `StatusSnapshot` (decoder output; status-only — no `session_id`, no transcript hint)
   - `TranscriptPathSource` with `static_hint(&LocatedStatusSource)` (Codex) and `dynamic_hint(raw)` (Claude) methods
2. **Specify `AgentBindings` concretely** in `crates/backend/src/agent/adapter/bindings.rs`: holds `{ agent_type, locator, decoder, transcript_paths, validator, streamer }`, built by `AgentBindings::for_attach(&AttachContext) -> Result<Self, String>`.
3. **Lock down visibility**: `TranscriptStreamer` is `#[doc(hidden)] pub`; `TranscriptState::start_or_replace` narrows to `pub(crate)` if tests don't need it.
4. **Constrain locator split**: only `CompositeLocator` implements `StatusSourceLocator`; `SqliteFirstLocator` / `FsScanFallback` stay Codex-private.
5. **Split A' into `A-status` (early) and `A-transcript` (late)**:
   - **`A-status`** lands **before B'** — status DTOs only (`statusline.rs` + `parser.rs` state-fold).
   - **`A-transcript`** lands **after D'** — transcript JSONL DTOs (`claude_code/transcript.rs` + `codex/transcript.rs`). Must preserve Codex `CompletionMode` + partial-line buffering.

### v3 ordering

| Step                          | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Addresses                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **0a**                        | Define `AttachContext` in `adapter/attach.rs` (immutable attach facts).                                                                                                                                                                                                                                                                                                                                                                                                                                  | R2.3                               |
| **0b**                        | Define `SessionRuntimeContext` (live `PtyState` handle for cwd lookups).                                                                                                                                                                                                                                                                                                                                                                                                                                 | R2.3, #7                           |
| **0c**                        | Introduce `LocatedStatusSource { status_path, trust_root, static_transcript_hint }` + `StatusSnapshot` + `TranscriptPathSource` with explicit `static_hint(&LocatedStatusSource) -> Option<RawPath>` (Codex) and `dynamic_hint(raw) -> Option<RawPath>` (Claude) methods. Remove `ParsedStatus.transcript_path` side channel.                                                                                                                                                                            | R2.1, R2.5, #1, R3.1               |
| **A-status**                  | Loose DTOs for STATUS only (`statusline.rs` + `parser.rs` state-fold). Per-field `Option<T> + #[serde(default)]`, Some-only fold for Codex token state, `deserialize_with` for wrong-type tolerance. **Defer transcript DTOs to `A-transcript`.**                                                                                                                                                                                                                                                        | #3, R2.4, R3.5                     |
| **B'**                        | 5-trait split, each `#[doc(hidden)] pub`: `StatusSourceLocator`, `StateDecoder` (returns `StatusSnapshot`), `TranscriptPathSource`, `TranscriptPathValidator`, `TranscriptStreamer`. **Only `CompositeLocator` implements `StatusSourceLocator`**; `SqliteFirstLocator` / `FsScanFallback` stay Codex-private. Define `AgentBindings { agent_type, locator, decoder, transcript_paths, validator, streamer }` in `adapter/bindings.rs` with `AgentBindings::for_attach(&AttachContext) -> Result<Self>`. | #2, #4, #5, R2.2, R2.5, R3.2, R3.4 |
| **B''**                       | TranscriptState re-shape to `Arc<dyn TranscriptStreamer>`. Narrow `start_or_replace` to `pub(crate)` if integration tests don't need it. Preserve concurrency invariants ([`transcript_state.rs:117`](./base/transcript_state.rs), [`transcript_state.rs:153`](./base/transcript_state.rs), test at line 428).                                                                                                                                                                                           | #6, R3.3                           |
| **D'**                        | `AgentWatcherService` registry facade. Unchanged shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | #7, #8                             |
| **A-transcript** _(deferred)_ | Loose DTOs for TRANSCRIPT JSONL (`claude_code/transcript.rs` + `codex/transcript.rs`). Must preserve Codex `CompletionMode` + partial-line buffering. Land AFTER D'.                                                                                                                                                                                                                                                                                                                                     | R3.5                               |
| **C** _(optional)_            | Common tailer engine. Lands after `A-transcript`. Must still absorb Codex `CompletionMode` + partial-line buffering.                                                                                                                                                                                                                                                                                                                                                                                     | n/a                                |

### Revised cost estimates (post-Round-3)

**Core path (0a → 0b → 0c → A-status → B' → B'' → D'): ~6–8 days**

- 0a (AttachContext): ~0.5d
- 0b (SessionRuntimeContext): ~0.25d
- 0c (`LocatedStatusSource` + `StatusSnapshot` + `TranscriptPathSource`): ~1d
- A-status (status DTOs only): ~1d
- B' (5-trait split + `AgentBindings` + locator scope): ~1.5d
- B'' (TranscriptState re-shape + visibility): ~1.5d
- D' (AgentWatcherService): ~0.5–1d

**Optional extensions:**

- A-transcript (transcript JSONL DTOs, after D'): +1.5–2d
- C (common tailer engine, after A-transcript): +1.5–2d

**Full delivery: ~9–12 days. Core-only: ~6–8 days.**

---

## Prompts used

### Round 1 prompt

```
Read crates/backend/src/agent/adapter/README.md — a pre-refactor design
analysis I just wrote. It proposes refactoring the AgentAdapter trait
through 4 directions (A: schema-first serde, B: split trait by concern
into Locator/StateDecoder/TranscriptStreamer, C: common tailer engine,
D: AgentSession facade) in order A->B->D, with C optional later.

Then read the actual code:
- crates/backend/src/agent/adapter/mod.rs, types.rs (trait surface)
- crates/backend/src/agent/adapter/base/ (runtime: watcher_runtime,
  transcript_state, diagnostics, path_security)
- crates/backend/src/agent/adapter/claude_code/ (statusline, transcript,
  test_runners)
- crates/backend/src/agent/adapter/codex/ (locator, parser, transcript,
  types)
- crates/backend/src/runtime/state.rs and src/agent/adapter/mod.rs::
  start_agent_watcher_inner (the IPC seam)

Your job: critique the refactor proposal. Identify dangers and blockers
I underestimated or missed. Be specific — name files, line numbers,
functions.

[focus list — A->B->D blockers, hidden coupling, cost realism, A/B/D
specifics]

Output: numbered findings (max 10), each with an IDEA block per
rules/common/idea-framework.md.
```

### Round 2 prompt

```
Round 2 of refactor roadmap review.

Read:
1. crates/backend/src/agent/adapter/README.md — original A->B->D proposal
2. crates/backend/src/agent/adapter/REVIEW.md — your previous 9 findings +
   REVISED sequence (Step 0 -> A' -> B' -> B'' -> D')

Then re-read the actual code [list of files].

Your job: critique the REVISED plan in REVIEW.md.

PART 1 — VALIDATE previous 9 findings closure.
PART 2 — NEW issues introduced by the revision (Step 0, A', B', B'', D', C).
PART 3 — STOP CRITERION: if no new issues AND v1 closes all 9, say
EXPLICITLY: "No new findings. The revised plan addresses all
previously-raised issues."

Otherwise: numbered findings (max 10), each with IDEA block.
```

### Round 3 prompt

```
Round 3 of refactor roadmap review.

[Reads README.md + REVIEW.md (now containing Round 1 + Round 2 + v2 plan)
+ the actual code.]

PART 1 — CLOSURE on R2.1-R2.5.
PART 2 — REGRESSION check on the original 9.
PART 3 — NEW issues introduced by v2:
  - Step 0a/0b/0c boundaries
  - 7-9d estimate realism
  - TranscriptState re-shape (B'') visibility constraints
  - AgentBindings concrete spec
  - Locator subtrait split (CompositeLocator only?)
PART 4 — STOP CRITERION: if no new issues, say EXPLICITLY:
  "No new findings. The revised plan addresses all previously-raised issues."

Otherwise: numbered findings prefixed R3.* (max 10), each with IDEA block.
```

To re-run any round:

```bash
codex exec "<the prompt above>" < /dev/null
```
