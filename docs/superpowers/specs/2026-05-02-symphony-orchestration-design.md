# Symphony-Style Orchestration for Vimeflow

**Date:** 2026-05-02
**Status:** Design - first implementation slice for issue [#108](https://github.com/winoooops/vimeflow/issues/108)
**Reference:** [OpenAI Symphony service specification](https://github.com/openai/symphony/blob/main/SPEC.md)

## Problem

Vimeflow can manage coding-agent terminal sessions and workspace state, but it does not yet provide a durable work queue. The user still has to pick an issue, create an isolated workspace, start an agent, monitor progress, and decide what to do after failure or completion.

Symphony's useful product shape is a small scheduler around coding agents:

- read eligible issues from a tracker,
- create deterministic per-issue workspaces,
- launch agent runs with a repo-owned workflow prompt,
- bound concurrency and retries,
- reconcile issue state changes,
- expose operator-visible run state.

This design adapts that shape to Vimeflow's Tauri desktop architecture. It is not a verbatim port.

## Goals

- Add an orchestration domain that can poll an issue tracker and normalize issues.
- Support a repo-owned `WORKFLOW.md` contract with typed, validated front matter and a prompt body.
- Create or reuse deterministic per-issue workspaces with path containment checks.
- Launch no more than the configured number of agent runs.
- Prevent duplicate dispatch of the same issue while it is claimed, running, or retrying.
- Stop or release work when tracker state changes make an issue ineligible.
- Track attempt status, timestamps, workspace path, last event, retry state, and errors.
- Surface queue and run state in the Vimeflow UI.
- Keep secrets out of persisted config, logs, prompts, and UI.

## Non-Goals

- A distributed scheduler or multi-tenant service.
- Automatic merging, deployment, or ticket-state mutation policy.
- Supporting every tracker in the first PR.
- Perfect restoration of in-memory scheduler state after restart.
- Running agents while Vimeflow is closed.
- Background daemon mode outside the Tauri app process.

## Key Decisions

| Question          | Decision                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First tracker     | GitHub Issues first. This repo already uses GitHub Issues for the exact workflow this feature targets. Keep `TrackerClient` generic so Linear can be added later. |
| First runner      | Generic command runner first, with Codex and Claude Code presets expressed as config. The orchestrator should not hard-code one agent.                            |
| Execution surface | Backend owns process execution and emits events. The frontend observes and controls; it does not schedule work directly.                                          |
| Runtime owner     | One async orchestrator actor owns scheduling state. Tauri commands send control messages to it.                                                                   |
| Durable state     | Use tracker state + workspace folders + an append-only local event log for recovery and audit. Do not introduce a database in v1.                                 |
| Workspace root    | Default under the Tauri app data directory. A workflow may override via env-backed path, but paths are canonicalized and contained.                               |
| Approval posture  | Default paused. The operator must enable polling for a workflow before any agent process launches.                                                                |
| Secrets           | Workflow config may reference secrets only through `$ENV_VAR` indirection. Resolved values are never written to event logs or UI payloads.                        |
| Hooks             | Support no hooks in the first implementation. Reserve schema for `before_run` and `after_run`, but defer execution until the scheduler is stable.                 |

## Architecture

Backend modules:

```text
src-tauri/src/orchestrator/
|-- mod.rs
|-- commands.rs
|-- config.rs
|-- events.rs
|-- github_tracker.rs
|-- runner.rs
|-- state.rs
|-- tracker.rs
|-- workflow.rs
`-- workspace.rs
```

Frontend modules:

```text
src/features/orchestrator/
|-- OrchestratorView.tsx
|-- components/
|-- hooks/
|-- services/
|-- types/
`-- data/
```

Layering:

1. **Workflow Loader** reads `WORKFLOW.md`, parses YAML front matter, validates config, and returns the prompt template.
2. **Tracker Client** fetches and normalizes issues. V1 implements GitHub Issues.
3. **Orchestrator Actor** owns scheduling state, poll ticks, reconciliation, retries, and concurrency.
4. **Workspace Manager** maps issue identifiers to canonical workspace paths and prepares folders.
5. **Agent Runner** renders prompts and launches configured agent commands inside workspaces.
6. **Event Log** appends sanitized lifecycle events for UI history and crash recovery hints.
7. **Tauri Commands and Events** expose state and controls to React.
8. **Frontend Work Queue** renders queue, active runs, attempts, controls, and errors.

## Workflow Contract

`WORKFLOW.md` lives in the target repository root unless the user selects another path.

Example:

```markdown
---
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: $GITHUB_TOKEN
  labels: ['agent-ready']
  active_states: ['open']
  terminal_states: ['closed']
polling:
  interval_ms: 30000
agent:
  max_concurrent: 1
  max_attempts: 3
  max_retry_backoff_ms: 300000
  command: 'codex'
  args: ['exec', '--full-auto', '{{ prompt_file }}']
workspace:
  root: '$VIMEFLOW_ORCHESTRATOR_WORKSPACES'
  base_ref: 'main'
  branch_prefix: 'agent'
---

You are working on GitHub issue {{ issue.identifier }}.

Title: {{ issue.title }}
URL: {{ issue.url }}

Follow the repository rules. Commit the fix, push a branch, and open a PR when complete.
```

Required validation:

- YAML front matter, when present, must parse to an object.
- `tracker.kind` is required and must be supported.
- For `github_issues`, `owner`, `repo`, and `token` are required.
- `$ENV_VAR` tokens must resolve before polling starts.
- `agent.command` is required and non-empty.
- `agent.max_concurrent` must be between 1 and a conservative upper bound, initially 4.
- `workspace.root`, when provided, must canonicalize to an absolute directory.
- Template rendering fails on unknown variables.

Template variables:

- `issue.id`
- `issue.identifier`
- `issue.title`
- `issue.description`
- `issue.state`
- `issue.url`
- `issue.labels`
- `issue.priority`
- `attempt.number`
- `attempt.previous_error`
- `workspace.path`
- `prompt_file`

`prompt_file` is the path of a generated Markdown prompt inside the workspace. Passing a file path instead of a huge shell argument avoids command-line quoting and length issues.

## Domain Model

### Normalized Issue

```rust
pub struct OrchestratorIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub url: Option<String>,
    pub labels: Vec<String>,
    pub priority: Option<i64>,
    pub updated_at: Option<String>,
}
```

For GitHub Issues:

- `id` is the GraphQL node ID when available, otherwise the REST numeric ID string.
- `identifier` is `#<number>`, for example `#108`.
- `priority` is `None` unless a label convention later maps to a number.
- labels are lowercased.

### Runtime State

The orchestrator actor owns:

```text
running: issue_id -> RunningRun
claimed: set issue_id
retry_queue: issue_id -> RetryEntry
last_snapshot: Vec<QueueIssue>
paused: bool
config_status: Valid | Invalid(error)
```

Run statuses:

- `queued`
- `claimed`
- `preparing_workspace`
- `rendering_prompt`
- `running`
- `retry_scheduled`
- `succeeded`
- `failed`
- `stopped`
- `released`

The UI may render these statuses, but only the actor mutates them.

### Event Log

Append sanitized JSONL under app data:

```text
<app_data_dir>/orchestrator/events.jsonl
```

Events are audit and recovery hints, not scheduling authority. They include:

- timestamp,
- workflow path,
- issue id and identifier,
- run id,
- attempt number,
- status,
- workspace path,
- summarized last agent event,
- sanitized error.

No token, full prompt, environment map, or command with secret expansions may be written.

## Polling and Reconciliation

Poll tick:

1. Load and validate the workflow.
2. If paused or invalid, emit status and skip dispatch.
3. Fetch active issues from the tracker.
4. Reconcile running and retrying issues against current tracker state.
5. Release claims for terminal, missing, or no-longer-eligible issues.
6. Sort eligible issues by priority, updated timestamp, then identifier.
7. Dispatch while `running.len() < max_concurrent`.
8. Emit an updated queue snapshot.

Duplicate prevention:

- An issue is never dispatched if it is in `claimed`, `running`, or `retry_queue`.
- Claim insertion happens before workspace preparation.
- Any preparation failure removes the claim or schedules retry in one actor transaction.

Retry behavior:

- Retry only transient classes: tracker timeout, workspace preparation IO error, agent launch failure, agent timeout, and nonzero exit when attempts remain.
- Do not retry validation errors, missing workflow, unsupported tracker kind, missing secret env vars, or path containment failures.
- Backoff starts at 5 seconds and doubles up to `max_retry_backoff_ms`.
- Retry entries store the last sanitized error for UI display.

Restart recovery:

- On app start, load `WORKFLOW.md` only after operator selects or confirms a workflow.
- Rebuild queue from tracker state.
- Scan workspace root for known workspace keys and attach paths to matching issues.
- Treat previously running event-log entries as `failed_after_app_restart` unless a live process/session can be proven.
- Do not silently relaunch agents after restart. The operator must resume polling.

## GitHub Issues Tracker

V1 uses GitHub Issues via REST or GraphQL through a Rust HTTP client.

Config:

```yaml
tracker:
  kind: github_issues
  owner: winoooops
  repo: vimeflow
  token: $GITHUB_TOKEN
  labels: ['agent-ready']
  active_states: ['open']
  terminal_states: ['closed']
```

Fetch rules:

- Active issues are open issues matching configured labels.
- Pull requests returned by the issues API are filtered out.
- Closed issues are terminal by default.
- A future field may support assignee, milestone, or search query filters.

Security:

- The token must come from env indirection.
- The token is held in memory only.
- API errors must redact authorization headers and token-like strings.

## Workspace Manager

Workspace key:

```text
github-issues-<owner>-<repo>-<issue-number>
```

Sanitization:

- Replace anything outside `[A-Za-z0-9._-]` with `_`.
- Reject empty results.
- Canonicalize `workspace.root`.
- Join root + key, canonicalize the parent, and verify the final path remains inside root.

Preparation:

- Verify the directory containing `WORKFLOW.md` is a Git repository.
- Create a per-issue Git worktree when the workspace path is missing.
- Use `workspace.base_ref` as the worktree starting point.
- Derive a branch name from `workspace.branch_prefix` and the issue identifier, for example `agent/108-symphony-orchestration`.
- Reuse an existing workspace only after verifying that it is still inside the workspace root and belongs to the selected repository.
- Write the rendered prompt to `.vimeflow/orchestrator/prompt.md`.
- Write non-secret run metadata to `.vimeflow/orchestrator/run.json`.

This makes the workspace isolation real: the agent command's current working directory is a per-issue checkout, not the user's primary checkout.

## Agent Runner

The runner launches the configured command in the workspace directory.

V1 command model:

```yaml
agent:
  command: 'codex'
  args: ['exec', '--full-auto', '{{ prompt_file }}']
  timeout_ms: 3600000
```

Rules:

- `command` is executed without shell interpolation.
- `args` are rendered as individual arguments.
- The current working directory is the prepared workspace path.
- The environment starts from the app process environment plus explicit non-secret config.
- The rendered prompt is stored in a file and passed via `{{ prompt_file }}`.
- Stdout and stderr are streamed into sanitized run events.
- On stop, send graceful termination first, then kill after a timeout.

Presets:

- `codex`: command `codex`, args `["exec", "{{ prompt_file }}"]`
- `claude_code`: command `claude`, args `["-p", "{{ prompt_file }}"]`
- `custom`: explicit command and args

The preset expands to the same generic command model; it does not create a separate runner path.

## Tauri API

Commands:

- `orchestrator_load_workflow(path: String) -> WorkflowStatus`
- `orchestrator_start(path: String) -> OrchestratorSnapshot`
- `orchestrator_pause() -> OrchestratorSnapshot`
- `orchestrator_refresh() -> OrchestratorSnapshot`
- `orchestrator_stop_run(run_id: String) -> OrchestratorSnapshot`
- `orchestrator_retry_issue(issue_id: String) -> OrchestratorSnapshot`
- `orchestrator_snapshot() -> OrchestratorSnapshot`

Events:

- `orchestrator-snapshot`
- `orchestrator-run-event`
- `orchestrator-error`

All payloads use generated TypeScript bindings via `ts-rs` once the Rust model stabilizes.

## Frontend Surface

Add a Work Queue surface under `src/features/orchestrator`.

Views:

- Workflow status: path, validation state, polling state, tracker kind, concurrency.
- Queue table: issue identifier, title, labels, tracker state, orchestration status, next retry time.
- Running runs: workspace path, attempt number, started time, last event, stop button.
- History: recent sanitized events from the event log.
- Errors: workflow validation errors, tracker errors, path validation errors, agent failures.

Controls:

- Load workflow.
- Start polling.
- Pause polling.
- Refresh now.
- Stop run.
- Retry issue.
- Open workspace path in file explorer or terminal.

The UI should default to paused and should never launch an agent from merely opening the screen.

## Security and Trust Boundaries

- `WORKFLOW.md` is executable policy. The UI must show the selected workflow path and require operator start.
- Tokens use `$ENV_VAR` indirection. Literal token-looking values should fail validation with a clear message.
- Logs and events must pass through the existing secret sanitization patterns used by test-runner output.
- Workspace paths must be canonicalized and contained before command launch.
- Agent commands run local code and can mutate files. The first UI copy should label this clearly in the workflow status area.
- Stop controls must kill only processes launched by the orchestrator run, not arbitrary system processes.
- The tracker adapter must not write issue comments, labels, or state in v1. Agent prompts may ask the coding agent to do that using its own tools, but the orchestrator itself is read-only toward the tracker.

## Testing Plan

Backend unit tests:

- workflow parse success and failures,
- env indirection resolution,
- literal secret rejection,
- template unknown variable failure,
- GitHub issue normalization,
- workspace key sanitization,
- workspace containment rejection,
- Git worktree creation command construction,
- duplicate claim prevention,
- retry backoff computation,
- non-retryable validation errors,
- stop transition behavior.

Backend integration tests:

- fake tracker with two eligible issues and `max_concurrent: 1`,
- fake runner success,
- fake runner nonzero exit with retry,
- tracker state changes releasing a running issue,
- app-restart reconciliation from event log + workspace folder.

Frontend tests:

- workflow invalid state,
- paused state does not dispatch,
- queue rows render issue metadata,
- stop and retry controls call the service,
- error panel redacts token-like text.

## Implementation Slices

1. **Design spec** - this document.
2. **Workflow loader and config validation** - parse `WORKFLOW.md`, resolve env indirection, validate fields, render prompt templates.
3. **Domain types and fake tracker** - add orchestrator state model, event model, and tests without network calls.
4. **Workspace manager** - deterministic keys, containment checks, prompt file generation.
5. **GitHub Issues tracker adapter** - read-only issue polling and normalization.
6. **Orchestrator actor** - polling, claims, concurrency, retries, reconciliation with fake runner.
7. **Agent runner** - generic command launch, stdout/stderr event streaming, stop semantics.
8. **Tauri commands/events** - snapshots, controls, generated bindings.
9. **Frontend Work Queue** - status surface and controls.
10. **Restart reconciliation** - event-log interpretation and workspace scan.
11. **End-to-end fake tracker/fake runner harness** - prove a full queued issue can dispatch, succeed, retry, and stop.

## Acceptance Criteria

- A project can define `WORKFLOW.md` and Vimeflow can validate it without launching agents.
- Vimeflow can poll GitHub Issues and list eligible issues.
- Vimeflow creates deterministic per-issue Git worktree paths and rejects path escape.
- Dispatch respects `agent.max_concurrent`.
- Duplicate dispatch of a claimed/running/retrying issue is impossible in the state model.
- State changes from the tracker can stop or release ineligible work.
- Attempts record status, timestamps, workspace path, last event, and sanitized errors.
- The UI can show queue, running, retrying, stopped, failed, and completed states.
- Retry behavior is deterministic and covered by tests.
- Secrets are not displayed in UI logs or persisted in generated files.

## Deferred Decisions

- Linear adapter.
- Advanced branch cleanup, rebase, or PR handoff policy.
- Workflow hooks.
- Automatic PR creation from the orchestrator itself.
- Background daemon mode.
- Durable database beyond the local JSONL event log.
