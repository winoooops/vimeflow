# Kimi Code — agent state capture (for the `kimi` adapter)

> **Status:** live-derived 2026-06-13 from **kimi-code v0.14.2** (`~/.kimi-code/bin/kimi`,
> a Node SEA). Schema confirmed by running a real `kimi -p` session and decoding the
> persisted `wire.jsonl`. Mirrors the per-provider documentation style of
> [`crates/backend/src/agent/adapter/README.md`](../../crates/backend/src/agent/adapter/README.md).

## Only kimi-code (TS) is supported

The legacy Python `kimi-cli` stored state under `~/.kimi/` with a **different** layout
(`~/.kimi/sessions/<md5(cwd)>/<conversation-uuid>/{context.jsonl,wire.jsonl,state.json}`,
where `context.jsonl` used `{"role":"_usage"|"tool"|"assistant"|...}` lines). That tree is
a migration leftover (`~/.kimi/.migrated-to-kimi-code`) and **must be ignored**. The adapter
targets `~/.kimi-code/` exclusively.

## Where kimi-code state lives

- **Root:** `~/.kimi-code/` (override env: `KIMI_CODE_HOME`). This is the adapter
  `provider_home` / `trust_root` — the kimi analogue of Codex's `~/.codex`.
- **Index:** `~/.kimi-code/session_index.jsonl` — one JSON object per line:
  `{"sessionId":"session_<uuid>","sessionDir":"<abs>","workDir":"<cwd>"}`.
- **Session dir:** `<sessionDir>` = `~/.kimi-code/sessions/wd_<basename(cwd)>_<sha256(cwd)[:12]>/session_<uuid>/`
  - `state.json` — session metadata only: `{createdAt, updatedAt, title, isCustomTitle, agents:{main:{homedir,type,parentAgentId}}, custom}`. **Not** model/token state.
  - `agents/main/wire.jsonl` — **the transcript** (status + activity folded into one JSONL). This is the file the adapter tails.
  - `agents/<subagentId>/wire.jsonl` — subagent transcripts.

### Locator strategy (StatusSourceLocator)

1. Read `<provider_home>/session_index.jsonl`; take the **last** line whose `workDir` equals
   the attach cwd → `sessionDir` + `sessionId`.
2. `status_path = <sessionDir>/agents/main/wire.jsonl`; `trust_root = <provider_home>`;
   `static_transcript_hint = status_path`; `agent_session_id = sessionId`.
3. Retry until the index entry + file exist (fresh attach races the agent writing them).
4. Fallback (no index hit): hash `wd_<basename(cwd)>_<sha256(cwd)[:12]>`, then newest session by mtime.

## `wire.jsonl` grammar

Every line is `{ "type": <string>, "time": <epoch_ms>, ...payload }`. The granular
agent-loop lifecycle is **nested** inside `context.append_loop_event.event`.

| top-level `type`            | payload                                                                            | meaning                                                     |
| --------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `metadata`                  | `app_version, created_at, protocol_version`                                        | session header (CLI version)                                |
| `config.update`             | `{profileName, systemPrompt}` **or** `{modelAlias, thinkingLevel}`                 | **model** = `modelAlias` (`"kimi-code/kimi-for-coding"`)    |
| `tools.set_active_tools`    | `{names:[...]}`                                                                    | active tool registry                                        |
| `permission.set_mode`       | `{mode}`                                                                           | permission mode                                             |
| `turn.prompt`               | `{input:[{type,text}], origin:{kind}}`                                             | **user turn** when `origin.kind=="user"` (skip `injection`) |
| `context.append_message`    | `{message:{role, content:[{type,text}], toolCalls, origin:{kind,variant}}}`        | message appended to context                                 |
| `context.append_loop_event` | `{event:{...}}`                                                                    | wraps the granular lifecycle below                          |
| `usage.record`              | `{model, usage:{inputOther,output,inputCacheRead,inputCacheCreation}, usageScope}` | **token usage** snapshot                                    |

`context.append_loop_event.event.type`:

| `.event.type`  | payload                                                                                                               | meaning                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `step.begin`   | `{uuid, turnId, step}`                                                                                                | step start                                        |
| `content.part` | `{..., part:{type:"think"\|"text", think/text}}`                                                                      | assistant reasoning / visible text                |
| `tool.call`    | `{toolCallId, name, args, description, display:{kind,operation,path}}`                                                | **tool-call START**                               |
| `tool.result`  | `{parentUuid, toolCallId, result:{output}}`                                                                           | **tool-call DONE** (link by `toolCallId`)         |
| `step.end`     | `{uuid, turnId, step, usage:{...}, finishReason:"tool_use"\|"end_turn", llmFirstTokenLatencyMs, llmStreamDurationMs}` | step end + per-step usage; `end_turn` = turn done |

## Mapping → vimeflow unified events

- **`agent-status`** (`AgentStatusEvent`)
  - model ← `config.update.modelAlias` / `usage.record.model`; version ← `metadata.app_version`
  - context window: used = `inputOther + output + inputCacheRead + inputCacheCreation` (latest), size = `262144` (kimi-for-coding `max_context_size`; default constant), `used_percentage = used/size`
  - `current_usage` ← `{input_tokens: inputOther, output_tokens: output, cache_read_input_tokens: inputCacheRead, cache_creation_input_tokens: inputCacheCreation}`
  - cost = none (managed subscription); rate_limits = none
- **`agent-tool-call`** (`AgentToolCallEvent`): START ← loop `tool.call` (`id = toolCallId`, `name`, `display.path`); DONE ← loop `tool.result` (match `toolCallId`); dedup by `toolCallId`
- **`agent-turn`** (`AgentTurnEvent`): one per `turn.prompt` with `origin.kind == "user"`
- **`agent-cwd`** (`AgentCwdEvent`): the session `workDir` (from the index); static per session (v1)
- **`agent-lifecycle`** (optional v1): `turn.prompt` → active; `step.end finishReason=="end_turn"` → idle
- **`test-run`** (deferrable): detect test commands in loop `tool.call name=="Bash"` `args.command` via the shared `test_runners`

## Detection

Binary name `kimi` (on PATH as `~/.kimi-code/bin/kimi`). The detector is registry-driven, so
detection is one `AGENT_SPECS` entry: `{ agent_type: Kimi, binary_names: ["kimi"], display_name: "Kimi", provider_home: ~/.kimi-code }`.

## Gotchas / divergences discovered

- **stream-json stdout ≠ persisted `wire.jsonl`.** `kimi -p --output-format stream-json`
  emits OpenAI-style `{role, tool_calls, tool_call_id}` lines (event names `agent_message_chunk`,
  `tool_call_started`, `tool_result`). The persisted file uses the `context.append_*` /
  dotted-namespace grammar above. The adapter tails the **file**, so parse the file grammar.
- **Tolerate a partial trailing JSONL line** — the file is appended live (same as Codex).
- **Usage field names** are `inputOther / output / inputCacheRead / inputCacheCreation`
  (NOT `input_tokens` etc.).
- **Auth:** kimi-code reads its OAuth token from `<KIMI_CODE_HOME>/credentials/<profile>.json`;
  `api_key` is read only from `config.toml`; the `KIMI_API_KEY` env var is **not** auto-read.
  The 0.14.2 migration copies config but not the OAuth token (left at the legacy
  `~/.kimi/credentials/kimi-code.json`), so a migrated install needs `kimi login` or the
  token relocated to `~/.kimi-code/credentials/kimi-code.json`.

## Known limitations (deferred follow-ups)

- **Reused-PTY freshness on no-proc paths.** The locator's freshness gate uses `pty_start`
  (terminal creation time). When the proc-fd primary is unavailable (macOS, or Linux where
  kimi has closed its `wire.jsonl` fd) AND the same PTY previously ran kimi, an old
  `wire.jsonl` can satisfy the `pty_start` floor during a new session's index-write race, so
  the watcher may briefly tail stale history. A full fix needs the detected kimi process's own
  start time (cross-platform: `/proc/<pid>/stat` on Linux, `ps -o lstart` on macOS). The Linux
  proc-fd primary already binds the exact per-process session, so this only affects no-proc
  reused-PTY restarts.
- **Two concurrent same-cwd kimi panes on macOS.** Without `/proc`, two simultaneously-live
  kimi sessions in one project can't be disambiguated; the index/exact-bucket fallback picks
  newest-by-mtime. Linux resolves this via the per-process fd.
- **A running kimi renames its `argv0` to `kimi-code`.** A live kimi process rewrites
  `process.title`, so `/proc/<pid>/cmdline` reads `kimi-code`, not `kimi`. Detection
  (`AGENT_SPECS.binary_names`) must match BOTH `kimi` (on-disk launch name) and `kimi-code`
  (running-process name) or a real session goes undetected. Caught by a live production-attach
  test on 2026-06-13; the registry now lists both names.
- **The proc-fd locator primary is inert for kimi v0.14.2.** kimi append-writes `wire.jsonl`
  line-by-line and does not keep it open as a tracked fd, so `/proc/<pid>/fd` never exposes it;
  resolution falls through to the freshness-gated `session_index.jsonl` path (which binds the
  live session correctly). The proc-fd code is retained for builds that hold the fd open.
