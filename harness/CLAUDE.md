# Harness — Autonomous Development Loop

The harness is the project's primary engineering cycle — it drove the CI/CD and linter infrastructure already in place. Built on the Claude Code SDK, adapted from [Anthropic's autonomous-coding demo](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding).

## Two-Agent Pattern

1. **Initializer** (first run, no `feature_list.json` present) — reads `app_spec.md`, decomposes it into a phased `feature_list.json` with dependencies
2. **Coder** (all subsequent runs) — picks the next pending feature, implements it, marks `"passes": true` when done, auto-continues to the next feature

Each iteration creates a fresh SDK client (`client.py`) → loads the appropriate prompt (`prompts/initializer_prompt.md` or `prompts/coding_prompt.md`) → runs a session → prints progress → sleeps 3s → loops.

## Environment Variables

| Variable             | Required | Description                                              |
| -------------------- | -------- | -------------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | Yes      | API key from console.anthropic.com (or compatible proxy) |
| `ANTHROPIC_BASE_URL` | No       | Override API endpoint (for proxies or self-hosted)       |

The harness does **not** auto-load `.env`. Source it before running:

```bash
set -a && source .env && set +a
```

## Running

```bash
cd harness && pip3 install -r requirements.txt

# Source env vars first (see above), then:
python3 autonomous_agent_demo.py                        # Unlimited iterations
python3 autonomous_agent_demo.py --max-iterations 5     # Capped
python3 autonomous_agent_demo.py --model claude-sonnet-4-5-20250929  # Override model
python3 autonomous_agent_demo.py --project-dir ../       # Custom project dir
python3 autonomous_agent_demo.py --no-sandbox            # Windows/WSL2 only
```

Default model: `claude-sonnet-4-5-20250929`. Project dir defaults to repo root.

**Tip:** Always dry-run with `--max-iterations 1` first to verify the environment works before scaling up.

## Safety Layers

| Layer                       | File          | Purpose                                                                                                                                |
| --------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Settings isolation**      | `client.py`   | `CLAUDE_CONFIG_DIR` set to temp dir — prevents user-level hooks from interfering                                                       |
| **Permissions**             | `client.py`   | `bypassPermissions` mode with file ops restricted to project dir                                                                       |
| **Bash allowlist**          | `security.py` | Only whitelisted commands pass (`npm`, `cargo`, `git`, `node`, etc.). Sensitive commands (`rm`, `pkill`, `chmod`) get extra validation |
| **Feature list protection** | `hooks.py`    | PreToolUse hook on Write — features cannot be removed or reordered, only `passes` field can change, must remain valid JSON array       |

### Sandbox Configuration

OS-level sandbox is **enabled by default** (recommended for macOS/Linux). It provides an additional security layer via CLI-level bash isolation, on top of the Python allowlist hooks.

| Flag           | Sandbox | Permission Mode     | When to Use                       |
| -------------- | ------- | ------------------- | --------------------------------- |
| _(default)_    | ON      | `acceptEdits`       | macOS, native Linux               |
| `--no-sandbox` | OFF     | `bypassPermissions` | Windows/WSL2 (sandbox unreliable) |

Python hooks (`security.py`, `hooks.py`) fire regardless of sandbox or permission mode. They always see the raw command before any sandbox wrapping.

**WSL2 users:** The sandbox may be unreliable or a no-op on WSL2. If you encounter Bash commands being blocked unexpectedly, re-run with `--no-sandbox`. You accept the risk of running without OS-level isolation — Python hooks still validate every command.

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

1. Write a new `app_spec.md` **at the project root** (not in `prompts/`)
   - `prompts.py` only copies `prompts/app_spec.md` → root if the root copy doesn't exist
   - Safest approach: write directly to the root `app_spec.md`
2. Delete `feature_list.json` (or start fresh) to trigger the Initializer
3. Run the harness — it generates a new feature list and begins implementing

## SDK Hook API

The Claude Code SDK (v0.0.25+) passes the **full hook context** to PreToolUse hooks, not just the tool's input params. The tool parameters are nested inside `input_data["tool_input"]`:

```python
async def my_hook(input_data, tool_use_id=None, context=None):
    # input_data keys: session_id, transcript_path, cwd, permission_mode,
    #                  hook_event_name, tool_name, tool_input, tool_use_id
    tool_input = input_data.get("tool_input", input_data)
    command = tool_input.get("command", "")
```

## Troubleshooting

| Symptom                                        | Cause                                                                               | Fix                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `python: command not found`                    | WSL2/Linux may only have `python3`                                                  | Use `python3` instead of `python`                                                                                                       |
| All Bash commands blocked with "Empty command" | Hook reads `input_data["command"]` instead of `input_data["tool_input"]["command"]` | Already fixed in `security.py` and `hooks.py`                                                                                           |
| `spawn rg EACCES` in Glob/Grep                 | Claude Code's vendored ripgrep binary lost +x permission                            | Preflight check auto-fixes this; or run `chmod +x ~/.npm-global/lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/x64-linux/rg` |
| User-level hooks interfere                     | SDK subprocess loads `~/.claude/settings.json`                                      | `client.py` sets `CLAUDE_CONFIG_DIR` to an isolated temp dir                                                                            |
| `app_spec.md` empty at root                    | `prompts.py` skips copy if root file exists                                         | Write spec directly to root `app_spec.md`, not `prompts/app_spec.md`                                                                    |
| `ANTHROPIC_API_KEY not set`                    | `.env` not sourced                                                                  | Run `set -a && source .env && set +a` before launching                                                                                  |
