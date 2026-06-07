# Agent adapter — architecture diagrams

Class + sequence diagrams covering the `agent::adapter` module
(`crates/backend/src/agent/adapter/`). Generated 2026-05-22 before a
planned refactor of the `AgentAdapter` trait surface; see the prose
analysis at
[`crates/backend/src/agent/adapter/README.md`](../../../crates/backend/src/agent/adapter/README.md).

## Diagrams

| #   | File                                     | Type     | What it shows                                                                                                                                                     |
| --- | ---------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `01-trait-architecture.{png,puml}`       | Class    | `AgentAdapter` trait + 3 implementations + the `adapter::types` + `adapter::base` boundary types                                                                  |
| 2   | `02-base-runtime.{png,puml}`             | Class    | `base/` runtime: `AgentWatcherState` + `WatcherHandle`, `TranscriptState` + `TranscriptHandle`, diagnostics, path security                                        |
| 3   | `03-claude-code.{png,puml}`              | Class    | `claude_code/` internals: `statusline` parser + `transcript` tailer + the shared `test_runners` subpackage                                                        |
| 4   | `04-codex.{png,puml}`                    | Class    | `codex/` internals: `locator` (Composite / SqliteFirst / FsScan) + `parser` (CodexFoldState) + `transcript` tailer                                                |
| 5   | `05-lifecycle-sequence.{png,puml}`       | Sequence | End-to-end attach: IPC → adapter factory → `base::start_for` → notify + poll → first event emission                                                               |
| 6   | `06-transcript-engine.{png,puml}`        | Class    | **(post-refactor)** Step C engine: `TranscriptDecoder` trait + `TranscriptTailService` + the two provider decoders + thin `start_tailing`                         |
| 7   | `07-transcript-tail-workflow.{png,puml}` | Sequence | **(post-refactor)** A line through the engine: read/buffer/strip/skip → `decode_line` → `process_line` → events; replay→live boundary, G3 carve-out, single-parse |

`.puml` files are the source of truth — edit those, then re-render.

A self-contained HTML walkthrough at [`transcript-engine.html`](transcript-engine.html)
narrates diagrams 6 + 7 together (the step-C refactor's payoff — engine
consolidation, the G3 split-line fix, and the response_item single-parse
delay fix). Open it in any browser; the PNGs load by relative path.

> **Diagrams 1–5** were generated 2026-05-22 and depict the **pre-refactor**
> monolithic `AgentAdapter` trait. **Diagrams 6–7** (added 2026-05-27) reflect
> the **post-refactor** transcript engine landed by the A-transcript + C work
> (#246 → #286, #287): the single `AgentAdapter` trait is now five `pub(crate)`
> traits + `AgentBindings`, and the two duplicated per-provider `tail_loop`s are
> one shared `TranscriptTailService` + an injected `TranscriptDecoder`.

## Re-render

PlantUML jar must be available locally (the repo doesn't vendor it):

```bash
# from this directory
java -jar ~/.local/share/plantuml/plantuml.jar -tpng *.puml
```

If `~/.local/share/plantuml/plantuml.jar` doesn't exist, grab the latest
jar from <https://plantuml.com/download>. Graphviz (`dot`) must be on
`PATH` for the class + sequence layouts.

## When to use which

- **Onboarding** — read in order 1 → 5 → 2 → 3 / 4.
- **Touching the trait surface** — open #1 (trait) plus #5 (lifecycle).
- **Touching the watcher / transcript registry** — open #2.
- **Adding a third agent adapter (Aider, Cursor, Roo)** — open #3 + #4
  side by side to see how `claude_code` and `codex` solve the same
  problems differently. For the transcript side, #6 shows the only piece a
  new agent must supply — a `TranscriptDecoder` — and #7 the loop it plugs into.
- **Touching transcript tailing / the shared engine** — open #6 (engine
  class) + #7 (workflow sequence).
