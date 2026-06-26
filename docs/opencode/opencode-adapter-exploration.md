<!-- cspell:ignore opencode sqlite Drizzle jsonl pty cwd lsof shm pageno -->

# opencode Adapter Exploration

Date: 2026-06-20

## Scope

This is a read-only exploration for adding an opencode adapter to Vimeflow.
No adapter code was implemented. The only repository change is this report.

Goal: identify where opencode persists local session status/history, validate it
against the live `/Users/winoooops/projects/rustgo` opencode process, and map
the result onto Vimeflow's existing Claude Code, Codex, and Kimi adapter shape.

## Sources Used

Official/current opencode references:

- OpenCode docs intro: <https://opencode.ai/docs/>
- OpenCode CLI docs: <https://opencode.ai/docs/cli/>
  - `opencode db path`
  - `opencode session list`
  - `opencode stats`
  - `opencode export [sessionID] --sanitize`
  - `--version`
- OpenCode troubleshooting docs: <https://opencode.ai/docs/troubleshooting/>
  - data root and log root under `~/.local/share/opencode/`
- Upstream repository: <https://github.com/anomalyco/opencode>
- Upstream latest release API result:
  - `v1.17.8`
  - published `2026-06-17T21:27:18Z`
  - <https://github.com/anomalyco/opencode/releases/tag/v1.17.8>

Upstream source files inspected from the active `dev` branch:

- `packages/core/src/database/database.ts`
  - sets SQLite WAL pragmas
  - resolves `Database.path()` to `Global.Path.data/opencode.db` for latest,
    beta, and prod channels unless `OPENCODE_DB` overrides it
- `packages/core/src/session/sql.ts`
  - defines `session`, `message`, `part`, `session_message`,
    `session_input`, and `session_context_epoch`
- `packages/core/src/project/sql.ts`
  - defines `project` and `project_directory`
- `packages/core/src/event/sql.ts`
  - defines `event_sequence` and `event`
- `packages/core/src/session/projector.ts`
  - projects session/message/part/event data into SQLite and maintains
    denormalized usage totals from `step-finish` parts
- `packages/core/src/session/event.ts`
  - defines durable session events for prompt, shell, step, text, reasoning,
    tool, retry, and compaction lifecycles
- `packages/core/src/v1/session.ts`
  - defines persisted part shapes, including `step-finish` token/cost usage
    and tool states `pending`, `running`, `completed`, and `error`
- `packages/opencode/src/cli/cmd/db.ts`
  - implements `opencode db path` and read/query helpers
- `packages/opencode/src/cli/cmd/export.ts`
  - implements `--sanitize` redaction for exported session data

Local Vimeflow references:

- `crates/backend/src/agent/adapter/traits.rs`
- `crates/backend/src/agent/adapter/bindings.rs`
- `crates/backend/src/agent/adapter/base/watcher_runtime.rs`
- `crates/backend/src/agent/adapter/claude_code/`
- `crates/backend/src/agent/adapter/codex/`
- `crates/backend/src/agent/adapter/kimi/`
- `crates/backend/src/agent/types.rs`
- `crates/backend/src/agent/config.rs`
- `src/agents/registry.ts`
- `src/features/agent-status/types/index.ts`
- `src/features/sessions/types/index.ts`

## Local Instance Observations

Observed live process:

```text
PID: 23210
PPID: 73581
Started: 2026-06-19 22:38:45 -0700
Command: opencode
CWD: /Users/winoooops/projects/rustgo
Binary: /Users/winoooops/.opencode/bin/opencode
Version: 1.17.8
```

Read-only commands used:

```text
ps -p 23210 -o pid,ppid,lstart,command
lsof -a -p 23210 -d cwd
lsof -p 23210
opencode --version
opencode db path
sqlite3 'file:/Users/winoooops/.local/share/opencode/opencode.db?mode=ro' ...
```

The official `opencode db path` command printed:

```text
/Users/winoooops/.local/share/opencode/opencode.db
```

`lsof` confirmed the running process has the following relevant files open:

```text
/Users/winoooops/.local/share/opencode/opencode.db
/Users/winoooops/.local/share/opencode/opencode.db-wal
/Users/winoooops/.local/share/opencode/opencode.db-shm
/Users/winoooops/.local/share/opencode/log/opencode.log
```

Exact state/history paths discovered for this machine:

```text
/Users/winoooops/.local/share/opencode/opencode.db
/Users/winoooops/.local/share/opencode/opencode.db-wal
/Users/winoooops/.local/share/opencode/opencode.db-shm
/Users/winoooops/.local/share/opencode/log/opencode.log
/Users/winoooops/.local/share/opencode/repos
/Users/winoooops/.local/share/opencode/snapshot
/Users/winoooops/.local/share/opencode/snapshot/global/69fc0edd4e2953aea9102f80baf32b61b0a8a88a
```

The snapshot path is a Git repository used by opencode step snapshots. It is
useful for future diff/revert support but not necessary for a first status and
activity adapter. The rustgo repository currently has no commits, so its
worktree `HEAD` is unresolved; opencode still records per-step snapshot hashes
in `part.data.snapshot`.

No project-local `.opencode` state was found under
`/Users/winoooops/projects/rustgo`.

## Documentation Drift Note

The troubleshooting docs still describe `~/.local/share/opencode/project/...`
as the session/message storage area. The local `1.17.8` process and current
upstream source show the active storage path is SQLite:

```text
~/.local/share/opencode/opencode.db
```

Treat the docs as authoritative for the data/log root and CLI commands, but use
the current source and local DB inspection for the schema.

## Local SQLite Schema Summary

The live database uses WAL mode. The app source sets:

```text
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA busy_timeout = 5000
PRAGMA cache_size = -64000
PRAGMA foreign_keys = ON
```

Tables present:

```text
account
account_state
control_account
credential
data_migration
event
event_sequence
message
migration
part
permission
project
project_directory
session
session_context_epoch
session_input
session_message
session_share
todo
workspace
```

Credential-bearing tables exist (`account`, `control_account`, `credential`,
`session_share`). This exploration inspected their schema only and did not read
stored token, credential, or share-secret values.

High-value tables for an adapter:

| Table                   | Role                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `project`               | Maps a worktree path to a project id.                                                                |
| `project_directory`     | Additional project directory aliases/root/worktree mappings.                                         |
| `session`               | Current and historical session rows, denormalized model/cost/token totals.                           |
| `message`               | Persisted user/assistant message metadata as JSON in `data`.                                         |
| `part`                  | Persisted message parts as JSON in `data`; includes tool state, step usage, text/reasoning, patches. |
| `event_sequence`        | Per-session aggregate cursor, latest durable event `seq`.                                            |
| `event`                 | Durable event stream by `aggregate_id`, `seq`, `type`, JSON `data`.                                  |
| `todo`                  | Current todo list by session. Optional for Vimeflow.                                                 |
| `session_context_epoch` | Context compaction/epoch state. Optional for Vimeflow v1.                                            |

Row counts in the local rustgo DB:

```text
project|1
workspace|0
session|1
session_message|0
message|27
part|144
session_input|0
event|453
permission|0
todo|2
```

Applied migrations are current through:

```text
20260612174303_project_dir_strategy
```

`data_migration` is empty on this local DB.

## Rustgo Project and Session Rows

Project row for the live cwd:

```text
id: global
worktree: /Users/winoooops/projects/rustgo
vcs: git
name: null
time_created: 1781933927295 (2026-06-19 22:38:47 -0700)
time_updated: 1781934061523 (2026-06-19 22:41:01 -0700)
time_initialized: 1781934061523
```

Latest session row:

```text
id: ses_11c75e7adffeWYBkANUK1LMZ2P
project_id: global
workspace_id: null
directory: /Users/winoooops/projects/rustgo
path: null
version: 1.17.8
agent: build
model.providerID: opencode
model.id: big-pickle
cost: 0.0
tokens_input: 51590
tokens_output: 5612
tokens_reasoning: 4163
tokens_cache_read: 623872
tokens_cache_write: 0
time_created: 1781933938770 (2026-06-19 22:38:58 -0700)
time_updated: 1781934061524 (2026-06-19 22:41:01 -0700)
event_sequence.seq: 452
time_archived: null
```

The session creation time is 13 seconds after the opencode process start. A
locator must tolerate a startup window where the process is detected but the
session row is not written yet.

## Sanitized Message and Part Shape

Message role counts:

```text
assistant|26
user|1
```

Message `data` keys observed, with counts:

```text
agent|27
cost|26
finish|26
mode|26
model|1
modelID|26
parentID|26
path|26
providerID|26
role|27
summary|1
time|27
tokens|26
```

Nested message paths observed:

```text
$.role
$.agent
$.providerID
$.modelID
$.model.providerID
$.model.modelID
$.path.cwd
$.path.root
$.time.created
$.time.completed
$.cost
$.tokens.input
$.tokens.output
$.tokens.reasoning
$.tokens.cache.read
$.tokens.cache.write
$.tokens.total
$.summary.diffs[*].file
$.summary.diffs[*].patch
```

Part type counts:

```text
patch|9
reasoning|24
step-finish|26
step-start|26
text|5
tool|54
```

Tool state counts:

```text
tool|completed|54
```

Tool names in this session:

```text
bash|completed|6
edit|completed|8
glob|completed|7
read|completed|29
todowrite|completed|3
write|completed|1
```

Important part `data` paths:

```text
$.type
$.text
$.tokens.input
$.tokens.output
$.tokens.reasoning
$.tokens.cache.read
$.tokens.cache.write
$.cost
$.snapshot
$.tool
$.callID
$.state.status
$.state.input.command
$.state.input.filePath
$.state.input.path
$.state.input.pattern
$.state.input.timeout
$.state.output
$.state.error
$.state.time.start
$.state.time.end
$.state.metadata.exit
$.state.metadata.display.path
$.state.metadata.display.text
$.state.metadata.filediff.file
$.state.metadata.filediff.patch
```

`step-finish` parts are the status decoder's most useful source of token/cost
usage. The denormalized `session.tokens_*` columns are maintained from those
parts by upstream projector code, so a status decoder should prefer the
`session` row for current totals and use `part` rows for current usage detail
or fixture parity.

## Sanitized Event Stream Shape

The local `event` table is the best transcript/activity tail source. It stores
durable per-session events with:

```text
id
aggregate_id
seq
type
data
```

For the rustgo session:

```text
aggregate_id: ses_11c75e7adffeWYBkANUK1LMZ2P
latest seq: 452
```

Event type counts:

```text
message.part.updated.1|317
message.updated.1|106
session.created.1|1
session.updated.1|29
```

Event data top-level keys:

```text
message.part.updated.1|part
message.part.updated.1|sessionID
message.part.updated.1|time
message.updated.1|info
message.updated.1|sessionID
session.created.1|info
session.created.1|sessionID
session.updated.1|info
session.updated.1|sessionID
```

Early sequence sample, sanitized to structural fields:

```text
0|session.created.1|sessionID=ses_...
1|message.updated.1|message=user
2|message.part.updated.1|part=text
3|session.updated.1|sessionID=ses_...
4|message.updated.1|message=assistant
7|message.part.updated.1|part=step-start
8|message.part.updated.1|part=reasoning
10|message.part.updated.1|part=tool tool=read state=pending
11|message.part.updated.1|part=tool tool=read state=running
12|message.part.updated.1|part=tool tool=read state=completed
31|message.part.updated.1|part=step-finish
```

Late sequence sample:

```text
413|message.part.updated.1|part=tool tool=bash state=pending
414..423|message.part.updated.1|part=tool tool=bash state=running
424|message.part.updated.1|part=tool tool=bash state=completed
425|message.part.updated.1|part=step-finish
431|message.part.updated.1|part=step-start
434|message.part.updated.1|part=tool tool=todowrite state=pending
435|message.part.updated.1|part=tool tool=todowrite state=running
436|message.part.updated.1|part=tool tool=todowrite state=completed
437|message.part.updated.1|part=step-finish
443|message.part.updated.1|part=step-start
448|message.part.updated.1|part=step-finish
451|session.updated.1
452|message.updated.1|message=user
```

This is enough to emit:

- `agent-turn` from the first user `message.updated.1` or from prompt/session
  event boundaries.
- `agent-tool-call` running from `tool` part state `pending`/`running`.
- `agent-tool-call` done from `tool` part state `completed`.
- `agent-tool-call` failed from `tool` part state `error`.
- `agent-status` after `session.updated.1`, after `step-finish`, and on poll.
- test-run snapshots from completed `bash` tool parts using the shared
  Claude test-runner command/output parser.

## Mapping to Vimeflow Adapter Contracts

Vimeflow's current split adapter contract is:

```text
StatusSourceLocator
StateDecoder
TranscriptPathSource
TranscriptPathValidator
TranscriptStreamer
```

opencode can fit the contract, but not as a pure drop-in adapter against the
current text-file watcher. The current watcher in
`crates/backend/src/agent/adapter/base/watcher_runtime.rs` calls
`std::fs::read_to_string(status_path)` in notify, inline-init, and poll paths.
An SQLite database is not a UTF-8 status file.

That means an implementation needs one small shared-runtime extension before or
alongside the opencode adapter.

Recommended shape:

1. Keep `LocatedStatusSource.status_path` and `trust_root`, but add a
   provider-neutral DB-aware status reader/source abstraction, defaulting to the
   current text-file read for Claude/Codex/Kimi.
2. For opencode, the reader opens the SQLite DB in read-only mode, resolves the
   current opencode session id, and returns either a provider-owned raw JSON
   snapshot string or a `StatusSnapshot` directly.
3. The opencode streamer independently tails the `event` table by session id
   and `seq`.

Lower-quality workaround, not recommended:

- Use `opencode.log` as the text `status_path`, ignore its raw contents in the
  decoder, and have the decoder query SQLite on every log/poll tick. This
  avoids base runtime changes but makes status freshness depend on log writes,
  not the DB event stream.

### StatusSourceLocator

Purpose: bind a detected `opencode` process and Vimeflow PTY session to the
right opencode SQLite DB and opencode session row.

Inputs already available in `AttachContext`:

```text
session_id
initial_cwd
shell_pid
agent_pid
pty_start
agent_type
provider_home
proc_root
```

Needed locator behavior:

1. Resolve the opencode data root.
   - Local default: `/Users/winoooops/.local/share/opencode`
   - Cross-machine default: `$HOME/.local/share/opencode`
   - Official override: `OPENCODE_DB`
   - Source also supports channel-specific DB names when not latest/beta/prod.
2. Open `<data_root>/opencode.db` read-only.
3. Find the project:
   - primary: `project.worktree = initial_cwd`
   - fallback: `project_directory.directory = initial_cwd`
   - fallback: component-boundary ancestor/descendant match if the PTY starts
     inside a subdirectory of the project.
4. Find the session:
   - `session.project_id = project.id`
   - `session.directory = initial_cwd` or path-compatible with it
   - `session.time_archived IS NULL`
   - prefer rows whose `time_created` is after detected `agent_pid` start minus
     small clock slack.
   - then choose newest `time_updated`.
5. Cache the resolved opencode session id inside the locator/adapter, like Kimi
   caches its resolved session directory.
6. Return:

```text
LocatedStatusSource {
  status_path: /Users/winoooops/.local/share/opencode/opencode.db,
  trust_root: /Users/winoooops/.local/share/opencode,
  static_transcript_hint: Some("/Users/winoooops/.local/share/opencode/opencode.db"),
  agent_session_id: Some("ses_11c75e7adffeWYBkANUK1LMZ2P"),
}
```

The actual `status_path` can remain the DB path if the base runtime gets a
DB-aware source reader. Without that runtime change, this will fail because the
watcher reads status paths as UTF-8 text.

Open issue: macOS has no `/proc/<pid>/environ`, so detecting `OPENCODE_DB`
from a manually configured running process is not available with the current
process abstraction. The safe v1 can support the default DB path and document
custom `OPENCODE_DB` as unsupported until the PTY spawn path captures env or the
adapter can inspect process-open files portably.

### StateDecoder

Purpose: emit Vimeflow `StatusSnapshot`.

Recommended DB query:

```sql
SELECT
  s.id,
  s.version,
  s.agent,
  json_extract(s.model, '$.providerID') AS provider,
  json_extract(s.model, '$.id') AS model,
  s.cost,
  s.tokens_input,
  s.tokens_output,
  s.tokens_reasoning,
  s.tokens_cache_read,
  s.tokens_cache_write,
  s.time_created,
  s.time_updated,
  es.seq
FROM session s
LEFT JOIN event_sequence es ON es.aggregate_id = s.id
WHERE s.id = ?;
```

Mapping:

| Vimeflow field                              | opencode source                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `agent_session_id`                          | `session.id`                                                                |
| `model_id`                                  | `session.model.id`, fallback latest assistant `message.data.modelID`        |
| `model_display_name`                        | same as `model_id` unless a display registry is added                       |
| `version`                                   | `session.version`                                                           |
| `context_window.context_window_size`        | unknown from local DB; use model metadata if available later, otherwise `0` |
| `context_window.total_input_tokens`         | `session.tokens_input`                                                      |
| `context_window.total_output_tokens`        | `session.tokens_output`                                                     |
| `current_usage.input_tokens`                | latest `step-finish` part `tokens.input`                                    |
| `current_usage.output_tokens`               | latest `step-finish` part `tokens.output`                                   |
| `current_usage.cache_read_input_tokens`     | latest `step-finish` part `tokens.cache.read`                               |
| `current_usage.cache_creation_input_tokens` | latest `step-finish` part `tokens.cache.write`                              |
| `cost.total_cost_usd`                       | `session.cost`, `0.0` means zero/unknown depending provider                 |
| `rate_limits`                               | no local rate-limit artifact observed                                       |
| `usage_fetched`                             | `false`                                                                     |

Context-window caveat:

- The local DB has token totals and per-step usage but no obvious model context
  window or rate-limit reset fields.
- Upstream `opencode stats` can compute usage, but the adapter should not shell
  out for status.
- A first adapter should report token totals, current step usage, cost, and
  model/version, with `context_window_size = 0` and `used_percentage = null` or
  `0` depending the existing `StatusSnapshot` constraints.

### TranscriptPathSource

opencode has no JSONL transcript path. The transcript/activity source is the
same SQLite DB plus the resolved `session.id`.

Recommended behavior:

```text
static_hint(located) -> Some(db_path)
dynamic_hint(raw) -> None
```

The adapter must keep the resolved opencode `session.id` in shared adapter
state for the decoder and streamer. The DB path alone is not enough to identify
which session to tail when multiple sessions share one database.

### TranscriptPathValidator

Purpose: prevent arbitrary DB reads.

Recommended validation:

1. Reject NUL or non-absolute paths.
2. Canonicalize the raw path.
3. Canonicalize the opencode data root.
4. Require the DB path to be under the opencode data root.
5. Require the file name to match an allowed DB name:
   - `opencode.db`
   - `opencode-<channel>.db` if channel-specific support is added
6. Reject WAL/SHM paths as transcript paths. The streamer opens the main DB
   read-only and lets SQLite manage WAL reads.

Local accepted path:

```text
/Users/winoooops/.local/share/opencode/opencode.db
```

Local trust root:

```text
/Users/winoooops/.local/share/opencode
```

### TranscriptStreamer

Purpose: emit Vimeflow activity and test-run events.

Recommended tail strategy:

1. Open SQLite read-only with a busy timeout.
2. Resolve `agent_session_id` from the shared locator state.
3. Read current `event_sequence.seq` for the session.
4. On startup, catch up from seq `0` through current seq, deduping by event id
   and part id/state. This gives immediate activity history in the panel.
5. Poll every 250-1000ms for:

```sql
SELECT id, seq, type, data
FROM event
WHERE aggregate_id = ?
  AND seq > ?
ORDER BY seq ASC;
```

6. Update the last processed seq only after a row is parsed or explicitly
   skipped.
7. Stop on the existing `TranscriptHandle` stop signal.

Event mapping:

| opencode event row                                                                               | Vimeflow event                                                   |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `message.updated.1` with `info.role = "user"`                                                    | `AgentTurnEvent`, once per user message id                       |
| `message.part.updated.1` with `part.type = "tool"` and `state.status = "pending"` or `"running"` | `AgentToolCallEvent` running/start                               |
| `message.part.updated.1` with `part.type = "tool"` and `state.status = "completed"`              | `AgentToolCallEvent` done                                        |
| `message.part.updated.1` with `part.type = "tool"` and `state.status = "error"`                  | `AgentToolCallEvent` failed                                      |
| completed `tool = "bash"`                                                                        | feed command/output/exit metadata into shared test-runner parser |
| `message.updated.1` assistant `path.cwd`                                                         | `AgentCwdEvent` if cwd changes                                   |
| `session.updated.1`                                                                              | optional title/model/status refresh                              |

Tool-call ids:

- Use `part.callID` as primary id for tool lifecycle.
- Use `part.id` as fallback if `callID` is missing.
- Track `(callID, status)` or `(part.id, status)` to avoid emitting repeated
  running updates for the same tool.

Arguments preview:

- For shell: `state.input.command`.
- For read/edit/write/glob: prefer `state.input.filePath`, `state.input.path`,
  or `state.input.pattern`.
- Avoid logging or emitting full `state.output` in Vimeflow tool args. Use it
  only for test-run parsing and output excerpts under existing truncation rules.

Test-run mapping:

- opencode's `bash` tool exposes:
  - `state.input.command`
  - `state.output`
  - `state.metadata.exit`
  - `state.time.start`
  - `state.time.end`
- This is enough to reuse `claude_code/test_runners/*`, similar to Codex.

## Required Vimeflow Changes

Backend:

- `crates/backend/src/agent/types.rs`
  - add `AgentType::OpenCode`
  - regenerate TypeScript bindings with `npm run generate:bindings`
- `crates/backend/src/agent/config.rs`
  - add `AGENT_SPECS` entry:

```rust
AgentSpec {
    agent_type: AgentType::OpenCode,
    display_name: "opencode",
    binary_names: &["opencode"],
    home_subdir: Some(".local/share/opencode"),
}
```

- `crates/backend/src/agent/config.rs`
  - update registry coverage tests and binary-name tests.
  - consider whether `home_subdir` should be renamed/generalized; the current
    name works for `.local/share/opencode` but was originally documented for
    direct dotdirs like `.codex` and `.kimi-code`.
- `crates/backend/src/agent/adapter/mod.rs`
  - add `pub mod opencode;`
- `crates/backend/src/agent/adapter/bindings.rs`
  - construct shared `OpenCodeLocator` and `OpenCodeAdapter` for
    `AgentType::OpenCode`, following the Kimi shared-locator pattern.
- `crates/backend/src/agent/adapter/opencode/`
  - new module with:
    - `mod.rs`
    - `locator.rs`
    - `parser.rs`
    - `transcript.rs`
    - `types.rs`
    - `fixtures/`
- `crates/backend/src/agent/adapter/base/watcher_runtime.rs`
  - add a DB-aware source reader/status source abstraction, or otherwise stop
    assuming every `status_path` is UTF-8 text.
- `crates/backend/Cargo.toml`
  - likely reuse existing `rusqlite` already present for Codex. No new DB crate
    should be needed.

Frontend:

- `src/bindings/AgentType.ts`
  - generated update after Rust type change.
- `src/features/agent-status/types/index.ts`
  - add opencode to the `agentType` union.
- `src/features/sessions/types/index.ts`
  - add opencode to pane/session `agentType` unions.
- `src/agents/brandIcons.tsx`
  - add an opencode icon if one is vendored, or use a glyph-only entry.
- `src/agents/registry.ts`
  - add an `opencode` registry entry and map backend agent type to it.
- `src/agents/registry.test.ts`
  - update `ALL_AGENTS` and mapping tests.
- Theme tokens:
  - add `--color-agent-opencode-*` tokens in both Catppuccin and Flexoki
    themes, or deliberately map opencode to existing shell colors for v1.
- Any session chrome tests that enumerate supported agent types need updates.

Fixtures/tests:

- Rust locator tests:
  - default DB path under `~/.local/share/opencode`
  - `project.worktree` exact match
  - `project_directory` fallback
  - newest unarchived session selection
  - freshness gate vs stale same-cwd session
  - missing DB/session returns not-yet-ready
- Rust parser tests:
  - status snapshot from `session` row
  - latest `step-finish` current usage
  - missing/invalid JSON in `session.model` tolerated
  - missing context window/rate limits produce safe defaults
- Rust transcript tests:
  - user message emits one turn
  - tool pending/running/completed emits start/done once
  - tool error emits failed
  - repeated running updates are deduped
  - bash completed event feeds test-run parser
  - seq cursor resumes without replay duplicates
- Fixture shape:
  - Prefer a SQL fixture that creates only non-secret tables/rows needed by
    tests, not a copy of the user's DB.
  - Include message/part/event rows with redacted text/output.

## Risks and Unknowns

1. Current watcher assumes text files.
   - This is the main implementation blocker. opencode status is SQLite.
   - A clean adapter needs a small base-runtime extension.

2. Custom DB path support is unresolved.
   - Upstream supports `OPENCODE_DB`.
   - The local process used the default path.
   - On macOS, Vimeflow's detector uses `ps`/`pgrep`, not process env or open
     file inspection. A v1 adapter may not discover a custom DB path unless
     Vimeflow captures env at PTY spawn or adds a portable process-open-files
     probe.

3. Session row may not exist when the process is first detected.
   - Local evidence: process start at `22:38:45`, session row at `22:38:58`.
   - The locator needs retry/backoff and should not permanently fail the pane
     before the first prompt/session row exists.

4. Multiple same-cwd opencode sessions share one DB.
   - Use `agent_pid` start time, `session.time_created`, `time_updated`,
     `time_archived`, and possibly terminal cwd to disambiguate.
   - On macOS there is no `/proc` fd/environ path to prove ownership.

5. `session_message` exists but was empty locally.
   - Upstream still defines it, but current local runtime uses `message`/`part`
     and `event` for the session history observed here.
   - Adapter should target `message`/`part`/`event`, not `session_message`.

6. Rate limits and context window are not locally obvious.
   - opencode persisted model, cost, and tokens.
   - No local rate-limit reset or model context window field was observed.
   - v1 should emit safe defaults rather than fake precision.

7. Secret-bearing tables are in the same DB.
   - Adapter queries must never read `account`, `control_account`,
     `credential`, or `session_share` contents.
   - Keep SQL projections narrow and table-specific.

8. WAL consistency.
   - The running process writes in WAL mode.
   - Adapter must open the main DB read-only and let SQLite read WAL state.
   - Do not read or parse `opencode.db-wal` directly.

9. Upstream schema drift.
   - OpenCode has frequent migrations and recent schema changes.
   - Adapter parsers should be tolerant: optional fields, JSON type checks,
     unknown event/part types skipped with diagnostic logs.

## Recommended Implementation Sequence

1. Add a minimal DB-aware status source/read abstraction in the base watcher,
   defaulting existing agents to the current `read_to_string` behavior.
2. Add `AgentType::OpenCode`, `AGENT_SPECS`, binding dispatch, and generated
   TS types.
3. Implement `OpenCodeLocator` with read-only SQLite project/session binding
   and Kimi-style shared resolved session state.
4. Implement `OpenCodeStateDecoder` from `session` plus latest `step-finish`
   part.
5. Implement DB path validation under the opencode data root.
6. Implement `OpenCodeTranscriptStreamer` that tails the `event` table by
   `aggregate_id` and `seq`.
7. Add redacted SQL fixtures and focused Rust tests before wiring frontend
   branding.
8. Add frontend registry/theme/type support once backend events are stable.

## Bottom Line

opencode 1.17.8 persists the live rustgo session in:

```text
/Users/winoooops/.local/share/opencode/opencode.db
```

The exact local session is:

```text
ses_11c75e7adffeWYBkANUK1LMZ2P
```

The right implementation model is closest to Codex/Kimi, not Claude:

- one global provider DB under a user data root,
- locator resolves the current agent session id from project/session rows,
- status is a fold over persisted DB state,
- activity is a tail over a durable event stream,
- transcript path is a static attach-time DB path plus shared locator state.

The only major mismatch is Vimeflow's current watcher expecting status sources
to be UTF-8 files. Solve that once in the adapter base, then opencode can fit
the existing five-trait adapter pattern cleanly.
