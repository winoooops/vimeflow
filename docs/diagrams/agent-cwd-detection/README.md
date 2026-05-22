# Agent cwd detection — before vs after

Sequence diagram comparing how `pane.cwd` followed (or failed to follow) the
agent's working directory before and after the structured-transcript channel
landed.

| File                | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `before-after.puml` | PlantUML source — single source of truth. Edit this. |
| `before-after.svg`  | Vector render. Embed in docs / PR descriptions.      |
| `before-after.png`  | Raster render. Use where SVG isn't supported.        |

## Re-render

PlantUML jar must be available locally (the repo doesn't vendor it):

```bash
# from this directory
java -jar ~/.local/share/plantuml/plantuml.jar -tsvg before-after.puml
java -jar ~/.local/share/plantuml/plantuml.jar -tpng before-after.puml
```

If `~/.local/share/plantuml/plantuml.jar` doesn't exist on your machine, grab
the latest jar from <https://plantuml.com/download>. Graphviz (`dot`) must be
on `PATH` for the sequence-diagram layout.

## What the diagram shows

- **BEFORE** — only OSC 7 and `agentCwdHint` (PTY text patterns) ever drove
  `pane.cwd`. Claude Code's built-in `EnterWorktree` tool runs in-process,
  never `cd`s the shell, and emits nothing the PTY text matcher can catch.
  The Header chip + branch label stayed pinned to the starting checkout.
- **AFTER** — the existing paths are unchanged, but vimeflow now also tails
  the structured `cwd` field that Claude Code stamps on every transcript
  JSONL entry. Transitions emit an `agent-cwd` event; the
  `WorkspaceView` bridge mirrors that into `pane.cwd` via the same
  `updatePaneCwd` the other sources use. No arbitration state machine —
  latest signal wins.

Tracked in #233; landed across the commit series on PR #239.
