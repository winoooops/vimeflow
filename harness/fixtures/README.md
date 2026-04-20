# harness/fixtures

Real `claude -p --output-format stream-json --verbose` output captured for
deterministic parser tests in `harness/test_cli_client.py`.

## `stream_sample.jsonl`

One full Claude Code session exercising the event shapes we must parse:

- `system.hook_started` / `system.hook_response` (user-level SessionStart hook; parser ignores)
- `system.init` (parser ignores)
- `assistant` with a `thinking` block (parser ignores thinking)
- `assistant` with a `tool_use` block (→ `ToolUseBlock`)
- `user` with a `tool_result` block (→ `UserMessage[ToolResultBlock]`)
- `assistant` with a `text` block (→ `AssistantMessage[TextBlock]`)
- `result.success` (→ `ResultEvent` with `session_id`, `is_error=False`)

## Regeneration

From a machine where the `claude` CLI is authenticated:

```bash
mkdir -p /tmp/cli-fixture-scratch
cd /tmp/cli-fixture-scratch && echo "hello fixture file contents" > sample.txt
claude -p "Read sample.txt. Then reply with exactly: FIXTURE_OK" \
  --output-format stream-json --verbose --allowed-tools "Read" \
  > <repo>/harness/fixtures/stream_sample.jsonl
```

Regenerate only if the CLI wire format changes (new event kinds, renamed
fields, etc.). Hook-generated `system.*` lines are environment-specific —
the parser skips them.
