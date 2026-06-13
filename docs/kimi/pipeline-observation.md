# Agent state pipeline observation for a Kimi adapter

## 1 unified events and their Rust types

The unified backend event surface is provider-neutral. `AgentType` is the root discriminator and currently serializes as camelCase with `ClaudeCode`, `Codex`, `Aider`, and `Generic` in [types.rs](crates/backend/src/agent/types.rs:5).

Primary event payloads:

- Detection: `AgentDetectedEvent { session_id, agent_type, pid }` in [types.rs](crates/backend/src/agent/types.rs:21); disconnect shape is `AgentDisconnectedEvent` in [types.rs](crates/backend/src/agent/types.rs:35).
- Status: `AgentStatusEvent` carries `agent_session_id`, model, version, `ContextWindowStatus`, `CostMetrics`, and `RateLimits` in [types.rs](crates/backend/src/agent/types.rs:132). The emitter sends `"agent-status"` in [events.rs](crates/backend/src/agent/events.rs:13).
- Title: `AgentSessionTitleEvent` plus `TitleSource` in [types.rs](crates/backend/src/agent/types.rs:157), emitted as `"agent-session-title"` in [events.rs](crates/backend/src/agent/events.rs:11).
- CWD: `AgentCwdEvent` in [types.rs](crates/backend/src/agent/types.rs:243), emitted as `"agent-cwd"` in [events.rs](crates/backend/src/agent/events.rs:34).
- Turns: `AgentTurnEvent` in [types.rs](crates/backend/src/agent/types.rs:275), emitted as `"agent-turn"` in [events.rs](crates/backend/src/agent/events.rs:27).
- Tools: `AgentToolCallEvent` and `ToolCallStatus` in [types.rs](crates/backend/src/agent/types.rs:304), emitted as `"agent-tool-call"` in [events.rs](crates/backend/src/agent/events.rs:20).
- Lifecycle: `AgentLifecycleEvent` and `AgentPhase` in [types.rs](crates/backend/src/agent/types.rs:366), emitted as `"agent-lifecycle"` in [events.rs](crates/backend/src/agent/events.rs:48).

For Kimi, the best fit is to translate Kimi-native state into these existing structs rather than adding Kimi-specific UI events.

## 2 the for_attach dispatch and AttachContext LocatedStatusSource StatusSnapshot

Production binding is built by `AgentBindings::for_attach` in [bindings.rs](crates/backend/src/agent/adapter/bindings.rs:70). The current dispatch has a Claude arm in [bindings.rs](crates/backend/src/agent/adapter/bindings.rs:84), a Codex arm in [bindings.rs](crates/backend/src/agent/adapter/bindings.rs:95), and a `NoOpAdapter` fallback in [bindings.rs](crates/backend/src/agent/adapter/bindings.rs:162).

`AttachContext` is the attach-time input: `session_id`, `initial_cwd`, shell and agent pids, `pty_start`, `agent_type`, `provider_home`, and `proc_root` in [attach.rs](crates/backend/src/agent/adapter/attach.rs:41). It is created from PTY state, detector state, `config::spec_for`, and `default_proc_root` in [mod.rs](crates/backend/src/agent/adapter/mod.rs:240).

`LocatedStatusSource` is the locator output: `status_path`, `trust_root`, optional `static_transcript_hint`, and optional `agent_session_id` in [adapter/types.rs](crates/backend/src/agent/adapter/types.rs:20). `StatusSnapshot` is the decoder output before the PTY session id is stamped onto it in [adapter/types.rs](crates/backend/src/agent/adapter/types.rs:62). `stamp_snapshot` turns it into `AgentStatusEvent` in [adapter/types.rs](crates/backend/src/agent/adapter/types.rs:112).

## 3 the four traits a new adapter implements with exact signatures plus the transitional AgentAdapter facade

The four split adapter traits are in [traits.rs](crates/backend/src/agent/adapter/traits.rs:45):

```rust
pub(crate) trait StatusSourceLocator: Send + Sync {
    fn locate(
        &self,
        cwd: &std::path::Path,
        session_id: &str,
    ) -> Result<LocatedStatusSource, String>;
}
```

```rust
pub(crate) trait StateDecoder: Send + Sync {
    fn decode(
        &self,
        session_id: Option<&str>,
        raw: &str,
    ) -> Result<StatusSnapshot, String>;
}
```

```rust
pub(crate) trait TranscriptPathValidator: Send + Sync {
    fn validate(&self, raw: &str) -> Result<PathBuf, ValidateTranscriptError>;
}
```

```rust
pub(crate) trait TranscriptStreamer: Send + Sync {
    fn tail(
        &self,
        events: Arc<dyn EventSink>,
        session_id: String,
        cwd: Option<PathBuf>,
        transcript_path: PathBuf,
    ) -> Result<TranscriptHandle, String>;
}
```

Production `AgentBindings` also requires `TranscriptPathSource`, defined separately in [adapter/types.rs](crates/backend/src/agent/adapter/types.rs:137), with `static_hint` and `dynamic_hint`. Codex uses static hints; Claude uses dynamic hints.

The transitional facade is `AgentAdapter` in [adapter/mod.rs](crates/backend/src/agent/adapter/mod.rs:38). Its signatures are `agent_type`, `located_status_source`, `parse_status`, `validate_transcript`, and `tail_transcript`. The module explicitly notes this facade is transitional and production lifecycle paths use the split bindings in [adapter/mod.rs](crates/backend/src/agent/adapter/mod.rs:75).

## 4 a Codex adapter walkthrough covering locator strategies state fold and transcript tail with file and line references

Codex wires one shared `CompositeLocator` into both the locator and the decoder path. `CodexAdapter::with_locator` stores it in [codex/mod.rs](crates/backend/src/agent/adapter/codex/mod.rs:72). Its `TranscriptPathSource` returns `located.static_transcript_hint` and has no dynamic hint in [codex/mod.rs](crates/backend/src/agent/adapter/codex/mod.rs:111).

Locator strategy:

- `CompositeLocator::new` builds a SQLite-first locator plus filesystem fallback in [locator.rs](crates/backend/src/agent/adapter/codex/locator.rs:784).
- SQLite discovery scans Codex home for `.sqlite` state/log DBs in [locator.rs](crates/backend/src/agent/adapter/codex/locator.rs:55).
- Primary resolution tries resume arg, proc fds, logs thread id, then recent state candidate in [locator.rs](crates/backend/src/agent/adapter/codex/locator.rs:386).
- Filesystem fallback scans recent `sessions/YYYY/MM/DD/rollout-*.jsonl` files and matches first-line cwd in [locator.rs](crates/backend/src/agent/adapter/codex/locator.rs:540).
- `StatusSourceLocator for CompositeLocator` returns the rollout path as both `status_path` and `static_transcript_hint`, with Codex home as trust root and thread id as `agent_session_id`, in [locator.rs](crates/backend/src/agent/adapter/codex/locator.rs:876).

State fold:

- `parse_rollout_snapshot` reads complete JSONL lines, skips an incomplete trailing line, folds each `CodexRolloutLine`, and returns a `StatusSnapshot` in [parser.rs](crates/backend/src/agent/adapter/codex/parser.rs:67).
- `CodexFoldState` holds agent session id, CLI version, model, context size, token info, rate limits, and duration in [parser.rs](crates/backend/src/agent/adapter/codex/parser.rs:214).
- `into_snapshot` computes context window, placeholder cost, default rate limits, and fallback model values in [parser.rs](crates/backend/src/agent/adapter/codex/parser.rs:234).
- `StateDecoder for CodexAdapter` overlays account rate limits from the locator logs cache when available in [codex/mod.rs](crates/backend/src/agent/adapter/codex/mod.rs:127).

Transcript tail:

- Path validation rejects null bytes, canonicalizes under `~/.codex`, and requires a file in [transcript.rs](crates/backend/src/agent/adapter/codex/transcript.rs:113).
- `start_tailing` opens the rollout JSONL and starts `TranscriptTailService` with `CodexTranscriptDecoder` in [transcript.rs](crates/backend/src/agent/adapter/codex/transcript.rs:172).
- The decoder maps `task_started`/`task_complete` and user messages into lifecycle/turn events in [transcript.rs](crates/backend/src/agent/adapter/codex/transcript.rs:281).
- Tool calls come from `response_item` function/custom tool records and completions from `event_msg` exec/patch events in [transcript.rs](crates/backend/src/agent/adapter/codex/transcript.rs:379).
- CWD is intentionally sourced only from `session_meta.payload.cwd` and `exec_command.arguments.workdir`, not `turn_context.cwd`, in [transcript.rs](crates/backend/src/agent/adapter/codex/transcript.rs:62).
- Codex has an additional title watcher for `<codex_home>/session_index.jsonl`, spawned only when `agent_session_id` is present in [watcher_runtime.rs](crates/backend/src/agent/adapter/base/watcher_runtime.rs:1237), with watcher behavior in [session_index.rs](crates/backend/src/agent/adapter/codex/session_index.rs:1).

## 5 the exact registration checklist to add a new AgentType covering the enum the AGENT_SPECS entry in config.rs the for_attach arm the module dir the ts-rs bindings regeneration and the frontend registry.ts plus agentTypeToRegistryKey

1. Add `Kimi` to `AgentType` in [types.rs](crates/backend/src/agent/types.rs:10). With `serde(rename_all = "camelCase")`, a `Kimi` variant serializes as `kimi`.

2. Add a Kimi `AgentSpec` to `AGENT_SPECS` in [config.rs](crates/backend/src/agent/config.rs:54). Existing entries show the required shape: `agent_type`, `binary_names`, `display_name`, and optional `provider_home`.

3. Add a `kimi` module under `crates/backend/src/agent/adapter/` and expose it from [adapter/mod.rs](crates/backend/src/agent/adapter/mod.rs:7).

4. Add a `Kimi` arm to `AgentBindings::for_attach` in [bindings.rs](crates/backend/src/agent/adapter/bindings.rs:70), returning concrete `Arc`s for `locator`, `decoder`, `transcript_paths`, `validator`, and `streamer`.

5. If Kimi follows the Codex single-JSONL model, use `LocatedStatusSource.static_transcript_hint` and implement `TranscriptPathSource::static_hint`; avoid `dynamic_hint` unless Kimi writes the transcript path inside the status payload. The runtime prefers dynamic hints before static hints in [watcher_runtime.rs](crates/backend/src/agent/adapter/base/watcher_runtime.rs:37).

6. Regenerate Rust-to-TypeScript bindings with `npm run generate:bindings`; the script is defined in [package.json](package.json:31). This worktree currently has only `src/bindings/index.ts`, so generated per-type files will be recreated by that command.

7. Frontend: add Kimi to `AgentStatus['agentType']` in [src/features/agent-status/types/index.ts](src/features/agent-status/types/index.ts:48).

8. Frontend: add `kimi: 'kimi'` to `AGENT_TYPE_MAP` in [useAgentStatus.ts](src/features/agent-status/hooks/useAgentStatus.ts:22), assuming the Rust enum variant is `Kimi`.

9. Frontend: add a Kimi entry to `AGENTS` in [registry.ts](src/agents/registry.ts:21), then map `case 'kimi': return 'kimi'` in `agentTypeToRegistryKey` in [registry.ts](src/agents/registry.ts:72).

10. Frontend: update remaining local unions such as `StatusCard`’s `AgentType` and `agentNames` in [StatusCard.tsx](src/features/agent-status/components/StatusCard.tsx:6) if that component is still part of the rendered surface.

## 6 gotchas for a Codex style single JSONL adapter

- The watcher reads the same file as status and transcript. That is valid, but the parser must tolerate partial trailing JSONL lines like Codex does in [parser.rs](crates/backend/src/agent/adapter/codex/parser.rs:71).
- `status_path` must be under `trust_root`; `ensure_trusted` enforces that before watching in [path_security.rs](crates/backend/src/agent/adapter/base/path_security.rs:90).
- If the transcript path is static, put it in `LocatedStatusSource.static_transcript_hint`; otherwise the runtime will only start tailing if `dynamic_hint(raw_status)` returns a path.
- `agent_session_id` matters. The frontend resets stale status when it changes in [useAgentStatus.ts](src/features/agent-status/hooks/useAgentStatus.ts:408), and lifecycle events use it to reject stale tails.
- Tool event IDs must be stable. The backend docs tell consumers to dedup by `tool_use_id` in [types.rs](crates/backend/src/agent/types.rs:319).
- CWD should come from a monotonic, agent-authoritative field. Codex explicitly ignores `turn_context.cwd` because it causes false reverts; Kimi should avoid any similarly stale per-turn field.
- If Kimi has title metadata outside the main transcript, copy Codex’s pattern only if there is a stable `agent_session_id`; the Codex title side-channel is gated on that id.
- Frontend activity classification is name-sensitive: unknown tool names fall into `meta` in [toolCallsToEvents.ts](src/features/agent-status/utils/toolCallsToEvents.ts:4). Normalize Kimi tools to existing categories if you want good feed grouping.
