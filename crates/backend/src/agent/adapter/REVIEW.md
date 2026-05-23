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

## Prompt used

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

To re-run:

```bash
codex exec "<the prompt above>" < /dev/null
```
