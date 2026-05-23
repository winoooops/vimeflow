# Agent adapter — architecture diagrams

Class + sequence diagrams covering the `agent::adapter` module
(`crates/backend/src/agent/adapter/`). Generated 2026-05-22 before a
planned refactor of the `AgentAdapter` trait surface; see the prose
analysis at
[`crates/backend/src/agent/adapter/README.md`](../../../crates/backend/src/agent/adapter/README.md).

## Diagrams

| #   | File                               | Type     | What it shows                                                                                                              |
| --- | ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `01-trait-architecture.{png,puml}` | Class    | `AgentAdapter` trait + 3 implementations + the `adapter::types` + `adapter::base` boundary types                           |
| 2   | `02-base-runtime.{png,puml}`       | Class    | `base/` runtime: `AgentWatcherState` + `WatcherHandle`, `TranscriptState` + `TranscriptHandle`, diagnostics, path security |
| 3   | `03-claude-code.{png,puml}`        | Class    | `claude_code/` internals: `statusline` parser + `transcript` tailer + the shared `test_runners` subpackage                 |
| 4   | `04-codex.{png,puml}`              | Class    | `codex/` internals: `locator` (Composite / SqliteFirst / FsScan) + `parser` (CodexFoldState) + `transcript` tailer         |
| 5   | `05-lifecycle-sequence.{png,puml}` | Sequence | End-to-end attach: IPC → adapter factory → `base::start_for` → notify + poll → first event emission                        |

`.puml` files are the source of truth — edit those, then re-render.

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
  problems differently.
