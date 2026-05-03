# Claude parser JSON boundary

**Date:** 2026-05-03
**Status:** Accepted
**Scope:** Claude Code adapter parser internals under `src-tauri/src/agent/adapter/claude_code/`. Does not decide Codex/Aider parser structure before their schemas are implemented.

## Context

Stage 1 of the `AgentAdapter` refactor introduced `agent::adapter::json` as a shared set of JSON path helpers:

```rust
json::str_at(item, &["input", "command"])
json::u64_or(value, &["context_window", "total_input_tokens"], 0)
```

During review, this looked shallower than the abstraction it implied. Today only Claude Code uses these helpers. Codex/Aider parser needs are not yet known, so a shared adapter-level JSON utility suggests cross-provider reuse before we have evidence. The helper also moves readability from explicit JSON shape:

```rust
item
    .get("input")
    .and_then(|v| v.get("command"))
    .and_then(Value::as_str)
```

to a slice-path mini-language that is shorter but not always clearer.

## Options considered

1. Keep `agent::adapter::json` as a shared parser utility.
2. Remove all helpers and write raw `.get().and_then()` chains everywhere.
3. Prefer Claude-specific domain functions, using raw access for shallow reads and Claude-private helpers only for deep or repeated reads.

## Decision

Choose option 3.

Parser flow should call domain functions first, for example `bash_command(item)`, `total_input_tokens(value)`, or `current_usage(value)`. Inside those functions:

- 1-2 nested reads use explicit `.get().and_then(...)` because they show the JSON shape directly.
- 3+ nested reads, or repeated numeric/default extraction, may use small Claude-private helpers.
- Generic helpers stay implementation details of the Claude parser. They are not exposed as `agent::adapter::json` until another adapter proves the same abstraction is useful.

## Justification

1. **The main parser reads in domain language.** `bash_command(item)` is clearer than `json::str_at(item, &["input", "command"])` because it names the Claude concept, not the path syntax.
2. **Simple JSON access remains obvious.** For two-level paths, explicit `.get().and_then()` is easier to reason about than `try_fold` hidden behind `at`.
3. **Deep repeated access still avoids boilerplate.** Statusline fields such as `context_window.current_usage.cache_creation_input_tokens` are noisy when fully expanded. Claude-private helpers keep that noise local without implying cross-adapter reuse.
4. **Avoids premature shared abstractions.** Codex CLI support is Stage 2. We should not design a shared JSON API before seeing Codex's actual rollout/session schema in production code.

## Alternatives rejected

### Option 1 — Shared `agent::adapter::json` helpers

Rejected because the module advertises a cross-adapter boundary before a second adapter exists. It also encourages parser code to remain a collection of JSON paths rather than domain operations.

### Option 2 — Raw `.get().and_then()` everywhere

Rejected because statusline parsing has many repeated nested numeric/default reads. Expanding every field would make parser intent harder to scan and increase copy/paste risk.

## Known risks & mitigations

- **Risk:** Claude-private helpers duplicate code that Codex might later need.
  **Mitigation:** Promote only after Codex lands and demonstrates concrete reuse.
- **Risk:** Too many tiny domain functions can fragment the parser.
  **Mitigation:** Use domain functions where they clarify a semantic concept or repeated field group; keep trivial one-off reads inline when the call site is already clear.
- **Risk:** Deep-path helpers can still become a mini query language.
  **Mitigation:** Keep helper calls behind domain functions rather than using them as the parser's primary vocabulary.

## References

- `docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md`
- `docs/superpowers/plans/2026-05-03-claude-adapter-refactor-stage-1.md`
- `src-tauri/src/agent/adapter/claude_code/statusline.rs`
- `src-tauri/src/agent/adapter/claude_code/transcript.rs`
