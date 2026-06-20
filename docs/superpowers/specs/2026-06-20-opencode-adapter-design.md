# opencode adapter — observability v1 design

Date: 2026-06-20
Status: codex-reviewed (5 findings applied)
Scope: add **opencode** as a supported coding agent in Vimeflow, at **parity with the existing Kimi/Codex observability adapters**. Interaction (sending prompts, aborting, approving permissions) is explicitly **out of scope** for v1.

Grounding (committed on this branch, authoritative):

- `docs/opencode/opencode-event-stream-research.zh.html` — the two-plane model (observation=read vs interaction=write), the verified opencode plugin event catalog + payload shapes, security red-lines.
- `docs/opencode/opencode-adapter-technical-note.zh.html`, `docs/opencode/opencode-adapter-exploration.md` — opencode SQLite schema and the five-trait mapping.

---

## 1. Goal

When a user runs `opencode` in a Vimeflow terminal pane, Vimeflow should light up the **agent-status sidebar**, the **status card**, and the **tool-activity feed** for that session — model, version, token/cost totals, turn count, live tool calls, and test-run snapshots — exactly as it already does for Claude Code, Codex, and Kimi. This is a pure **observability** capability: read-only, no write-back to opencode.

Non-goals for v1 (deferred to a follow-up epic): programmatic interaction via `opencode serve` HTTP API (send-prompt/abort), a permission-approval UI, custom `OPENCODE_DB` discovery on macOS, and DB-backfill of pre-existing sessions.

## 2. Background

opencode (v1.17.8) does not persist a JSONL transcript the way Claude/Codex/Kimi do; its live state lives in a user-level SQLite database and its **only** clean, durable, semantic event surface is its **plugin hook system** (verified empirically — see the research note). The existing Vimeflow adapter framework consumes a **UTF-8 JSONL file** per session: a `StatusSourceLocator` resolves the file, a `StateDecoder` folds it into a `StatusSnapshot`, and a `TranscriptStreamer` tails it into activity events via the shared `TranscriptTailService`. opencode produces no such file natively.

## 3. Approaches considered

### 3.1 Plugin-to-JSONL (CHOSEN)

A tiny opencode **bridge plugin**, vendored in this repo and auto-installed by Vimeflow into `~/.config/opencode/plugins/`, subscribes to opencode's hooks and appends each relevant event as one JSON line to a per-session JSONL file under a Vimeflow-owned bridge directory. The Rust adapter is then a **pure-filesystem locator + JSONL tail**, structurally identical to the Kimi adapter — **no rusqlite, no opencode-DB-schema coupling, no proximity to opencode's secret tables**.

- **Pros:** the Rust side stays 100% within the proven Kimi pattern (lowest implementation risk for an autonomous multi-PR build); events are clean and semantic (`tool.execute.after` carries `exit`/`output`; `session.status` is `busy|idle|retry`); durable on disk; zero coupling to opencode's undocumented `event`-table schema; the plugin previews/minimizes payloads at the source (§4.1).
- **Cons:** the plugin only captures events from when opencode is (re)started with it loaded — an already-running opencode session shows no live data until its next launch. Vimeflow writes one file into the user's opencode config dir (idempotent, version-stamped, clearly named). These are documented v1 limitations, not bugs.

### 3.2 DB-mirror-to-JSONL (rejected for v1)

The Rust backend opens `opencode.db` read-only, tails the `event` table by `aggregate_id`+`seq`, and writes a JSONL mirror the tail engine consumes (Codex-locator precedent uses rusqlite). Works immediately for already-running sessions with no opencode-side install.

- **Rejected because:** it requires a **novel** long-lived SQLite-poller + JSONL-writer subsystem with bespoke lifecycle, WAL-safety, cursor persistence, and secret-table whitelisting — there is **no existing template** in the codebase for a Rust adapter that *writes* a derived feed (Kimi/Codex only *read* files their agent already writes). For an autonomous build that must pass codex review and stay green, the novelty/risk is not worth it in v1. It remains the natural **v2 backfill** path.

### 3.3 Hybrid (deferred)

Plugin for live + DB for backfill of pre-plugin history. This is the eventual end-state but doubles v1 surface area; deferred.

## 4. Architecture

```
opencode process ──(hooks)──▶ vimeflow bridge plugin ──(append JSONL)──▶
   ${XDG_DATA_HOME:-~/.local/share}/vimeflow/opencode-bridge/
     ├── index.jsonl            # {sessionID, pid, directory, slug, time} per session.created/updated
     └── <sessionID>.jsonl      # one normalized line per whitelisted event

Vimeflow backend (per PTY attach):
   OpenCodeLocator (filesystem) ─resolve agent_pid→sessionID via index.jsonl─▶ LocatedStatusSource
   StateDecoder    ─fold <sessionID>.jsonl────────────────────────────▶ StatusSnapshot
   TranscriptStreamer ─tail <sessionID>.jsonl via TranscriptTailService▶ Agent{Turn,ToolCall,Cwd,Status} events + test-run snapshots
```

**Bridge directory — one derivation rule, identical on both sides, decoupled from opencode's home** (this is the adapter's `trust_root`):

```
$VIMEFLOW_OPENCODE_BRIDGE_DIR
  ?? ${XDG_DATA_HOME:-$HOME/.local/share}/vimeflow/opencode-bridge
```

The plugin (TS) and the Rust locator each compute the byte-identical path independently — never via `home_subdir`/`provider_home` (which locate opencode's own install and are unused by the v1 locator). A test asserts the literal default path on both sides.

### 4.1 Bridge plugin (`vimeflow-opencode-bridge.ts`)

Vendored at `crates/backend/src/agent/adapter/opencode/plugin/vimeflow-opencode-bridge.ts` and treated as a build asset. Behavior:

- Exports a `Plugin` (`(input) => Promise<Hooks>`). Registers the universal `event` hook plus `tool.execute.before`/`tool.execute.after`.
- **Event whitelist** (everything else ignored to avoid the verified noise — `message.part.delta`, `catalog.updated`, `plugin.added` dominate volume): `session.created`, `session.updated`, `session.idle`, `session.status`, `session.error`, `session.diff`, `message.updated`, `message.part.updated` (only `part.type` in `{"tool", "step-finish", "step-start"}` — `step-finish` carries the per-step token/cost usage the decoder needs; `step-start` and user `message.updated` mark turn boundaries), `todo.updated`; plus the structured `tool.execute.before`/`tool.execute.after` hooks. **`permission.updated`/`permission.replied` are NOT whitelisted in v1** — they belong to the deferred interaction plane, and dropping them removes all permission payloads from the bridge file.
- **Line schema** (one compact JSON object per line, newline-terminated):
  ```jsonc
  { "v": 1, "ts": 1781965827596, "kind": "event", "type": "session.created", "data": { /* event.properties */ } }
  { "v": 1, "ts": 1781965831335, "kind": "tool.before", "tool": "bash", "sessionID": "...", "callID": "...", "args": { /* truncated */ } }
  { "v": 1, "ts": 1781965831382, "kind": "tool.after",  "tool": "bash", "sessionID": "...", "callID": "...", "result": { "title": "...", "output": "...", "metadata": { "exit": 0, "truncated": false } } }
  ```
- **Per-session routing & identity:** every line carries its `sessionID` (from `data.sessionID` / hook input). The plugin writes each session's lines to `<bridge>/<sessionID>.jsonl` and appends `{sessionID, pid, directory, slug, time}` to `<bridge>/index.jsonl` on `session.created` and on `session.updated` when `directory` changes. **`pid` is the opencode process's own `process.pid`** — the same value Vimeflow detected as `agent_pid` — and is the locator's primary disambiguator when two opencode sessions share a cwd (cwd+time is only a fallback).
- **Data minimization (not a "no-secrets" guarantee):** the bridge file is **user-local session-sensitive data**, the same trust class as the Kimi/Codex transcripts Vimeflow already tails — it may legitimately contain the user's own prompts and tool arguments. The plugin (a) writes tool **args as a short preview** (bash → `command`; read/edit/write/glob → `filePath`/`path`/`pattern`), (b) writes tool **output only as a bounded excerpt** (≤ 2 KiB head+tail) for the test-runner — never full file contents, (c) truncates every other string to ≤ 2 KiB, (d) emits no permission/credential/account payloads (none whitelisted), and (e) writes files `0600`. All I/O is wrapped in try/catch so a write error never breaks the host opencode session.

### 4.2 Auto-install

On opencode attach, the backend idempotently writes the pinned plugin to `~/.config/opencode/plugins/vimeflow-opencode-bridge.ts` if absent or if its embedded `// vimeflow-bridge-version: N` header differs. The plugin source is embedded in the Rust binary via `include_str!`. This is a one-time, version-gated FS write inside the user's opencode config (documented; removable). A startup log line records install/skip.

### 4.3 Five-trait mapping (mirror `kimi/`)

| Trait | opencode impl |
| --- | --- |
| `StatusSourceLocator` | `OpenCodeLocator` (filesystem). Resolve bridge dir; read `index.jsonl`; **match by `pid == ctx.agent_pid` first** (exact process identity — disambiguates same-cwd sessions); only if no pid match, fall back to the newest entry whose canonicalized `directory == cwd` and whose `time >= pty_start − slack`. Return `LocatedStatusSource { status_path: <bridge>/<sessionID>.jsonl, trust_root: <bridge>, static_transcript_hint: Some(same path), agent_session_id: Some(sessionID) }`. Cache resolved `(sessionID, path)` in shared `Arc<Mutex<…>>` (Kimi shared-state pattern). Retry/backoff like Kimi for the startup window where the index row / session file does not exist yet. |
| `StateDecoder` | Fold `read_to_string(status_path)` line-by-line into a `StatusSnapshot`: `agent_session_id`, `model_id`/`model_display_name` (from `session.created/updated` → `info.model.id`), `version`, `context_window` totals (from `info.tokens`), current-step usage (from the latest `step-finish` part's `tokens`), `cost` (`info.cost`), `rate_limits` (safe default — none in source), `usage_fetched=false`. `context_window_size` unknown → `0`. |
| `TranscriptPathSource` | `static_hint` returns `located.static_transcript_hint.clone()`; `dynamic_hint` → `None` (path fixed at attach). |
| `TranscriptPathValidator` | `validate_transcript_path_with_root(raw, &locator.effective_bridge_root())`: NUL check → canonicalize → must be under the canonicalized bridge root → must be a `*.jsonl` file. |
| `TranscriptStreamer` | `start_tailing` opens the JSONL, builds `OpencodeTranscriptDecoder` (impl `TranscriptDecoder`), wraps in `TranscriptTailService::new(decoder, "opencode transcript")`, spawns the tail thread. |

### 4.4 Transcript event mapping

| Bridge line | Vimeflow event |
| --- | --- |
| `message.updated` with `info.role == "user"` | `AgentTurnEvent` (once per user message id; **not** `session.created` — it carries no user-message id) |
| `tool.before` / `message.part.updated` tool `pending`/`running` | `AgentToolCallEvent` start/running |
| `tool.after` / tool `completed` | `AgentToolCallEvent` done |
| tool `error` | `AgentToolCallEvent` failed |
| `tool.after` where `tool === "bash"` | feed `args.command` + `result.output` + `result.metadata.exit` into the **shared** `claude_code::test_runners` parser (reuse `match_command`/`maybe_build_snapshot`/`TestRunEmitter`) |
| `session.idle` / `session.status` / `step-finish` part | status / phase / per-step-usage refresh |
| `session.updated` `info.path.cwd` change | `AgentCwdEvent` |

`OpencodeTranscriptDecoder` carries `in_flight` tool calls keyed by `callID` (fallback `part.id`), `num_turns`, `last_cwd`, a `TestRunEmitter`, and a `replay_done` one-shot guard. `on_caught_up` must be **idempotent** (fires every ~500 ms) — gate replay-flush behind `replay_done`. DTOs use `serde(other)` catch-alls on both the line-kind and event-type enums and `serde_helpers::lenient_*` on every scalar so an unknown/newer event type or a type-drifted field degrades gracefully instead of poisoning the line.

## 5. Registration (exhaustive — from the codebase map)

### 5.1 Backend

- `crates/backend/src/agent/types.rs` — add `Opencode` variant to `AgentType` (serde camelCase ⇒ wire string **`"opencode"`** — verify against generated `src/bindings/AgentType.ts`).
- `crates/backend/src/agent/config.rs` — `AGENT_SPECS` entry `AgentSpec { agent_type: Opencode, display_name: "opencode", binary_names: &["opencode"], home_subdir: Some(".local/share/opencode") }` (binary name verified from a live process: argv[0] = `opencode`; home is the XDG **data** dir, not `~/.opencode` which is the binary install). Update the `registry_covers_every_agent_type` **compile-time match** and **runtime loop**, and `agent_type_for_binary` test.
- `crates/backend/src/agent/detector.rs` — add a detection test for `opencode`.
- `crates/backend/src/agent/adapter/mod.rs` — `pub mod opencode;`.
- `crates/backend/src/agent/adapter/bindings.rs` — named `AgentType::Opencode` arm (before the `other =>` NoOp fallback). Build **one** `Arc<OpenCodeLocator>`, share it into both `bindings.locator` and `OpenCodeAdapter::with_locator(locator.clone())` (the shared-Arc invariant — avoids the cycle-11 F31 double-retry hazard). Home resolution chain: `provider_home_override → $OPENCODE_HOME → ctx.provider_home → default_opencode_home()`. Add `opencode_ctx` test helper + dispatch tests.
- New module `crates/backend/src/agent/adapter/opencode/`: `mod.rs`, `locator.rs`, `parser.rs`, `transcript.rs`, `transcript_dto.rs`, `types.rs`, `plugin/vimeflow-opencode-bridge.ts`, `fixtures/`.
- `crates/backend/src/agent/types.rs` etc. must also implement the transitional `AgentAdapter` facade on `OpenCodeAdapter` (delegates to the split traits).
- `runtime/state.rs::ensure_rename_supported` and `watcher_runtime.rs` Codex-only branches: **no change** (opencode has no `/rename` and no title-sync index in v1).

### 5.2 Frontend (wire string `opencode`)

- Type unions: `src/features/agent-status/types/index.ts:51`, `src/features/sessions/types/index.ts:53,121` — add `'opencode'`.
- Maps/guards: `src/features/agent-status/utils/agentStatusModel.ts` (`AGENT_TYPE_MAP` `opencode: 'opencode'` + test), `src/features/sessions/utils/groupSessionsFromInfos.ts` (`KNOWN_AGENT_TYPES`), `src/features/sessions/utils/agentForSession.ts` (`AGENT_BY_SESSION_TYPE` + test).
- Registry: `src/agents/registry.ts` (`AGENTS.opencode` entry + `agentTypeToRegistryKey` case) + `registry.test.ts` (`ALL_AGENTS`, identity/icon/glyph tests — glyph must be a single code point).
- Icon: `src/agents/brandIcons.tsx` `export const Opencode` (BrandSvg, `fill=currentColor`) + `brandIcons.test.tsx` table entry.
- Theme: `src/theme/types.ts` `AGENT_IDS` + `types.test.ts` exact-equality assertion; **all six** theme files (`obsidian-lens`, `flexoki`, `tokyo-night`, `dracula`, `gruvbox-dark`, `gruvbox-light`) gain an `agents.opencode` accent block (distinct palette color, avoid the browser/kimi collisions); regenerate `src/theme/theme.css` via `npx tsx scripts/generate-theme-css.ts && npx prettier --write src/theme/theme.css` (the `themeCss.test.ts` exact-equality gate).
- Diff inline-feedback (`activePanePicker.ts`, `WorkspaceView.tsx`): **out of scope** v1 (claude/codex only); leave unchanged.

## 6. Security & robustness

- **No DB access:** the Rust side never opens `opencode.db` in v1, so opencode's secret tables (`account`/`credential`/`session_share`) are structurally out of reach.
- **Bridge file = user-local session data, minimized (§4.1), not "secret-free":** it is the same trust class as the Kimi/Codex transcripts Vimeflow already tails. The plugin emits no permission/credential/account payloads, previews tool args, excerpts tool output, and writes `0600`; the bridge dir lives under the user's own data dir.
- `trust_root` = the canonicalized bridge dir; the validator rejects any transcript path escaping it (path-traversal guard, mirror `kimi/transcript.rs`).
- Lenient DTOs + `serde(other)` everywhere for opencode schema drift.
- `on_caught_up` idempotency guard; shared-Arc locator; `proc_root` is unused in v1 (filesystem locator), so no `/proc` gating needed.

## 7. Testing

- Rust locator: bridge-dir resolution; `index.jsonl` newest-match-by-cwd; freshness gate vs stale same-cwd session; missing index/file ⇒ not-yet-ready (retry).
- Rust decoder: snapshot from `session.created/updated`; current usage from latest tool/step; missing/invalid JSON tolerated; safe defaults for context-window/rate-limits.
- Rust transcript: user message ⇒ one turn; tool before/after ⇒ start/done once (deduped by callID); tool error ⇒ failed; bash `tool.after` ⇒ test-run parser; seq/replay resumes without duplicate events; `on_caught_up` idempotent.
- Fixtures: a sanitized `fixtures/sample_bridge.jsonl` (+ `sample_index.jsonl`) — **authored**, not copied from a real user DB.
- Frontend: registry/theme/icon/union tests enumerated in §5.2; `cargo test` regenerates `src/bindings/AgentType.ts` (verify the emitted `"opencode"` string).

## 8. Milestone overview (one PR each; detailed in the plan)

1. **Backend registration** — `AgentType::Opencode`, `AGENT_SPECS`, detector, exhaustiveness tests, generated bindings; opencode detected (NoOp adapter, `other =>` fallback). Frontend type-union + map updates so the tree compiles. Green.
2. **Bridge plugin + wire schema + auto-install + fixtures** — the TS plugin, `include_str!` embed, idempotent version-gated installer, `sample_bridge.jsonl`/`sample_index.jsonl`.
3. **`OpenCodeLocator` + `types.rs` + path validator** — filesystem resolution, shared-Arc state, retry; tests.
4. **`StateDecoder` + DTOs + parser** — fold → `StatusSnapshot`; tests.
5. **`TranscriptStreamer` + `OpencodeTranscriptDecoder`** — activity + test-run events; wire the real `bindings.rs` `Opencode` arm; tests.
6. **Frontend registration** — registry entry, brand icon, six theme files + `theme.css` regen, remaining unions/maps, all frontend tests.

(Each milestone builds green and is independently reviewable; later milestones depend on earlier ones in order.)

## 9. Risks & open questions

- **Restart caveat** (accepted): live data needs opencode (re)launched with the bridge installed. Documented in README; v2 DB-backfill closes the gap.
- **Wire string** must be verified against ts-rs output (`"opencode"` expected) before frontend strings are committed — M1 gate.
- **`home_subdir` semantics** (low-risk now): `.local/share/opencode` is a nested path, not a dotdir; the v1 locator ignores `provider_home` (bridge root is XDG-derived), but still confirm `resolve_bind_inputs` tolerates a multi-component `home_subdir` for the registry/detector plumbing.
- **Bridge dir agreement**: plugin (TS) and locator (Rust) must derive the identical path; the single `$VIMEFLOW_OPENCODE_BRIDGE_DIR ?? ${XDG_DATA_HOME:-~/.local/share}/vimeflow/opencode-bridge` rule is pinned on both sides and covered by a test asserting the literal default.
- **pid disambiguation residual**: pid reuse across opencode restarts is mitigated because each session's file is keyed by the live `sessionID` and the cwd+time fallback gates on `pty_start`; a stale index row with a reused pid is rejected by the freshness check.
- **glyph/accent collisions**: pick an opencode glyph + palette distinct from existing agents (theme tests enforce exact `AGENT_IDS`).

<!-- codex-reviewed: 2026-06-20T15:55:36Z -->
