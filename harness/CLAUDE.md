# Harness — Autonomous Development Loop

The harness is the project's primary engineering cycle — it drove the CI/CD and linter infrastructure already in place. Built on the Claude Code SDK, adapted from [Anthropic's autonomous-coding demo](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding).

## Two-Agent Pattern

1. **Initializer** (first run, no `feature_list.json` present) — reads `app_spec.md`, decomposes it into a phased `feature_list.json` with dependencies
2. **Coder** (all subsequent runs) — picks the next pending feature, implements it, marks `"passes": true` when done, auto-continues to the next feature

Each iteration creates a fresh SDK client (`client.py`) → loads the appropriate prompt (`prompts/initializer_prompt.md` or `prompts/coding_prompt.md`) → runs a session → prints progress → sleeps 3s → loops.

## Running

```bash
cd harness && pip install -r requirements.txt

# Requires ANTHROPIC_API_KEY in env (or .env at project root)
python autonomous_agent_demo.py                        # Unlimited iterations
python autonomous_agent_demo.py --max-iterations 5     # Capped
python autonomous_agent_demo.py --model claude-sonnet-4-5-20250929  # Override model
python autonomous_agent_demo.py --project-dir ../       # Custom project dir
```

Default model: `claude-sonnet-4-5-20250929`. Project dir defaults to repo root.

## Safety Layers

| Layer                       | File          | Purpose                                                                                                                                |
| --------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Sandbox**                 | `client.py`   | OS-level bash isolation (`sandbox.enabled: true`)                                                                                      |
| **Permissions**             | `client.py`   | File ops restricted to project dir (`acceptEdits` mode)                                                                                |
| **Bash allowlist**          | `security.py` | Only whitelisted commands pass (`npm`, `cargo`, `git`, `node`, etc.). Sensitive commands (`rm`, `pkill`, `chmod`) get extra validation |
| **Feature list protection** | `hooks.py`    | PreToolUse hook on Write — features cannot be removed or reordered, only `passes` field can change, must remain valid JSON array       |

## File Roles

| File                       | Role                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `autonomous_agent_demo.py` | CLI entry point (argparse, asyncio.run)                                               |
| `agent.py`                 | Core session loop — query SDK, stream response, handle tool use blocks                |
| `client.py`                | SDK client factory — security config, system prompt, hooks registration               |
| `security.py`              | Bash command allowlist + validators for `pkill`/`chmod`/`rm`                          |
| `hooks.py`                 | PreToolUse hook protecting `feature_list.json` integrity                              |
| `prompts.py`               | Load prompt templates from `prompts/` dir, copy `app_spec.md` on first run            |
| `progress.py`              | Read `feature_list.json`, render progress bar                                         |
| `prompts/`                 | Markdown prompt templates: `initializer_prompt.md`, `coding_prompt.md`, `app_spec.md` |

## Feature Tracking (`feature_list.json`)

Tracks implementation progress across phases. Each feature has:

- `id`, `phase`, `category`, `description`, `steps[]`, `dependencies[]`
- `"passes": true` = complete, `"passes": false` = pending

The coder agent picks the next feature whose dependencies are all satisfied.

## Adding New Work

1. Write a new `app_spec.md` in `prompts/` describing the next phase of work
2. Delete `feature_list.json` (or start fresh) to trigger the Initializer
3. Run the harness — it generates a new feature list and begins implementing
