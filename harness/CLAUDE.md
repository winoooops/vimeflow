# Harness — Autonomous Development Loop

The harness is the project's primary engineering cycle — it drove the CI/CD and linter infrastructure already in place. Default backend is `claude -p` subprocess per role (inherits the user's Claude Code CLI auth). The SDK path remains as an **opt-in fallback** via `--client sdk`. Adapted from [Anthropic's autonomous-coding demo](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding).

## Three-Phase Workflow

1. **Phase 1: Initializer** (first run, no `feature_list.json`) — reads `app_spec.md`, decomposes it into a phased `feature_list.json` with dependencies
2. **Phase 2: Feature Loop** — for each pending feature, runs a Coder (Claude) + Reviewer (Codex CLI) inner loop. The Coder implements, Codex reviews locally, findings are fed back to the Coder. Repeats until clean or the per-feature iteration budget is exhausted.
3. **Phase 3: Cloud Review** — the Coordinator pushes to GitHub, creates/finds a PR, polls for the cloud Codex review (via GitHub Action), and if issues are found, spawns a local Coder+Reviewer fix loop before pushing again. Up to `--max-relay-loops` cycles.

Phases 1 and 2 spawn `claude -p` sessions for Initializer/Coder work. Phase 3 spawns more for fix loops — all git/GitHub operations (push, PR, poll) are handled directly via subprocess by the Coordinator (Python).

## Environment Variables

Normal operation needs **no `ANTHROPIC_API_KEY`**. The default `cli` backend inherits the user's `claude` CLI auth.

| Variable                | Required | Description                                                                                                                                                                                                                                                                                     |
| ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`        | No       | Not required. Codex CLI 0.121+ authenticates via `~/.codex/auth.json` (set up once with `codex login`). The env var is only used by some older SDK-style workflows; harness code itself does not read it. If the Codex CLI reviewer errors, run `codex login`, not `export OPENAI_API_KEY=...`. |
| `HARNESS_POLICY_JUDGE`  | No       | Judge mode: `deny` (default — LLM not consulted), `ask` (LLM decides), `explain` (LLM advises, always deny)                                                                                                                                                                                     |
| `HARNESS_POLICY_CACHE`  | No       | Override the policy-judge cache path                                                                                                                                                                                                                                                            |
| `HARNESS_CLI_LIVE_TEST` | No       | Set to `1` to enable `scripts/dry_run_smoke.py` and the live `test_cli_client.py::test_cli_session_live_query` test                                                                                                                                                                             |

**Additional requirements:**

- `gh` CLI authenticated (`gh auth login`) for Phase 3 cloud operations.
- `codex` CLI authenticated (`codex login`) for Phase 2 local review and Phase 3 cloud review. Auth is stored in `~/.codex/auth.json`; the harness does **not** read `OPENAI_API_KEY`.

### Fallback: SDK backend (opt-in only)

If the `claude` CLI is unavailable (not installed, auth broken, or you need a custom `ANTHROPIC_BASE_URL`), pass `--client sdk`. That path uses the `claude_code_sdk` Python package and talks directly to the Anthropic API.

| Variable             | When                | Description                                |
| -------------------- | ------------------- | ------------------------------------------ |
| `ANTHROPIC_API_KEY`  | `--client sdk` only | API key for the SDK fallback               |
| `ANTHROPIC_BASE_URL` | `--client sdk` only | Optional custom endpoint (proxy/self-host) |

The API-key check fires inside `sdk_client.create_client` — it never blocks the default CLI path. To run with the fallback:

```bash
set -a && source .env && set +a   # provides ANTHROPIC_API_KEY
python3 autonomous_agent_demo.py --client sdk --max-iterations 1 \
  --skip-review --skip-relay
```

The harness does **not** auto-load `.env`. Source it manually when using `--client sdk` or when Codex review is enabled.

## Branch Requirement (MANDATORY)

**The harness must run on a feature branch, never on `main`.** Per [`rules/common/worktrees.md`](../rules/common/worktrees.md) §Principles, the interactive main agent works on a feature branch in the **primary checkout** — it does **not** enter a worktree for itself. The harness Python orchestrator runs in that same primary checkout on the same feature branch.

> _"Main agent works on a feature branch in the primary checkout — the interactive Claude Code agent checks out `feat/<name>` (or `fix/`, `refactor/`, etc.) in the primary checkout and commits there. It does not create a worktree for itself."_
>
> _"Subagents and harness always use a worktree"_ → this refers to **dispatched parallel subagents** and, as future work, per-feature Coder subprocesses isolated under `.claude/worktrees/<feature>/`. The current harness architecture does not yet implement per-feature worktrees; all Coder iterations happen in the same working tree as the orchestrator.

### Before Launching the Harness

From the project root (primary checkout):

```bash
# From main, create a feature branch
git checkout main
git checkout -b <branch-name>
# OR: if you're already on a feature branch, stay put

# (Optional) environment — only needed for --client sdk fallback:
# set -a && source .env && set +a

# Launch the harness (--project-dir defaults to the repo root)
cd harness && python3 -u autonomous_agent_demo.py --max-iterations 10 --skip-relay
```

**Do NOT call `EnterWorktree`** — it puts the main agent into a worktree the user's dev server and diff viewer can't see. The `block-main-commit.sh` PreToolUse hook will reject commits on `main` regardless, so the primary-checkout feature branch is the correct and safe location.

### Why This Matters

- The user runs `npm run tauri:dev` and watches the diff viewer from the primary checkout. Edits in `.claude/worktrees/` are invisible to that view. If the main agent works in a worktree, the user can't verify progress live.
- Running on `main` would violate branch protection — the hook blocks commits.
- A feature branch in the primary checkout is cheaply cleaned up once merged (see CLEANUP in `rules/common/worktrees.md`).

### After the Harness Completes

Stay on the feature branch for review-fix cycles:

```bash
gh pr create --title "feat: <description>" --body "..."
# Stay here — run /harness-plugin:github-review for code review cycles
# Only the user merges the PR
```

Cleanup (after the user merges or closes the PR):

```bash
git checkout main
git pull
git branch -D <branch-name>   # -D because squash-merge leaves the branch "not fully merged"
```

## Running

```bash
cd harness && pip3 install -r requirements.txt

# Source env vars first (see above), then:
python3 autonomous_agent_demo.py                        # Full loop (Phases 1-3)
python3 autonomous_agent_demo.py --max-iterations 5     # 5 iterations per feature
python3 autonomous_agent_demo.py --skip-review           # No local Codex review (Phase 2)
python3 autonomous_agent_demo.py --skip-relay            # No cloud review (Phase 3)
python3 autonomous_agent_demo.py --skip-review --skip-relay  # Coder only, no review
python3 autonomous_agent_demo.py --model claude-sonnet-4-5-20250929  # Override model
python3 autonomous_agent_demo.py --project-dir ../       # Custom project dir
python3 autonomous_agent_demo.py --no-sandbox            # Windows/WSL2 only
python3 autonomous_agent_demo.py --clean                 # Fresh start: wipe runtime files
python3 autonomous_agent_demo.py --clean --max-iterations 10  # Typical new-phase launch
```

Default model: `claude-sonnet-4-5-20250929`. Project dir defaults to repo root.

**Tip:** Always dry-run with `--max-iterations 1` first to verify the environment works before scaling up.

### CLI Flags

| Flag                  | Default                    | Description                                                                                         |
| --------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `--max-iterations`    | unlimited                  | Per-feature iteration budget (Coder → Review → Fix cycles)                                          |
| `--skip-review`       | false                      | Skip local Codex review in Phase 2 feature loop                                                     |
| `--skip-relay`        | false                      | Skip Phase 3 cloud review entirely (alias for `--phase-3 skip`)                                     |
| `--phase-3`           | `confirm`                  | How to handle Phase 3: `auto` (always run), `confirm` (prompt on tty, auto-skip on non-tty), `skip` |
| `--ignore-stale-list` | false                      | Proceed even when `.feature_list_stamp.json` is missing or doesn't match `app_spec.md`'s hash       |
| `--review-timeout`    | 300 (5 min)                | Max seconds to wait for cloud Codex review comment                                                  |
| `--max-relay-loops`   | 2                          | Max cloud review-fix cycles in Phase 3                                                              |
| `--model`             | claude-sonnet-4-5-20250929 | Claude model for Coder sessions                                                                     |
| `--project-dir`       | repo root                  | Target project directory                                                                            |
| `--no-sandbox`        | false                      | Disable OS-level sandbox (WSL2 only)                                                                |
| `--clean`             | false                      | Wipe runtime files before starting                                                                  |
| `--client`            | `cli`                      | Backend: `cli` (claude -p subprocess, default) or `sdk` (opt-in fallback, needs ANTHROPIC_API_KEY)  |

**Note:** `--max-iterations` is a **per-feature** budget, not a global count. With `--max-iterations 5` and 10 features, each feature gets up to 5 rounds of (code → review → fix).

## Safety Layers

| Layer                       | File              | Purpose                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settings isolation**      | `client.py`       | Harness passes `--settings <project-scoped file>` on every `claude -p` so project hooks fire; user hooks may also fire but defense-in-depth means our allowlist always sees the command first                                                                                                                                            |
| **Permissions**             | `client.py`       | `acceptEdits` (sandbox) or `bypassPermissions` (no-sandbox) with file ops restricted to project dir                                                                                                                                                                                                                                      |
| **Bash allowlist**          | `security.py`     | Only whitelisted commands pass (`npm`, `cargo`, `git`, `gh`, `node`, etc.). Sensitive commands (`rm`, `pkill`, `chmod`, `gh`) get extra validation                                                                                                                                                                                       |
| **gh subcommand validator** | `security.py`     | Allowlist-only for `gh`: only `pr create/view/list`, `repo view`, `api` (GET), `auth status`. Blocks write methods (`-X POST/DELETE/PUT/PATCH`) and data flags (`-f`, `-F`, `--field`) via token-based parsing                                                                                                                           |
| **Feature list protection** | `hooks.py`        | PreToolUse hook on Write — features cannot be removed and descriptions cannot be edited; must remain valid JSON array. Note: Edit tool is not validated by this hook.                                                                                                                                                                    |
| **Review comment auth**     | `review.py`       | Cloud review comments are only accepted from `github-actions[bot]` to prevent spoofing                                                                                                                                                                                                                                                   |
| **Policy judge**            | `policy_judge.py` | Default-deny for unknown bash commands. Opt-in via `HARNESS_POLICY_JUDGE=ask` (LLM decides) or `=explain` (LLM advises, always deny). Deterministic extension: list base commands in `harness/.policy_allow.local`. Judge decisions cached at `~/.claude/harness_policy_cache.json` (user-private; override via `HARNESS_POLICY_CACHE`). |

### Sandbox Configuration

OS-level sandbox is **enabled by default** (recommended for macOS/Linux). It provides an additional security layer via CLI-level bash isolation, on top of the Python allowlist hooks.

| Flag           | Sandbox | Permission Mode     | When to Use                       |
| -------------- | ------- | ------------------- | --------------------------------- |
| _(default)_    | ON      | `acceptEdits`       | macOS, native Linux               |
| `--no-sandbox` | OFF     | `bypassPermissions` | Windows/WSL2 (sandbox unreliable) |

Python hooks (`security.py`, `hooks.py`) fire regardless of sandbox or permission mode. They always see the raw command before any sandbox wrapping.

**WSL2 users:** The sandbox may be unreliable or a no-op on WSL2. If you encounter Bash commands being blocked unexpectedly, re-run with `--no-sandbox`. You accept the risk of running without OS-level isolation — Python hooks still validate every command.

### Hookify Pre-Launch Rules

In addition to the runtime safety layers above, the project uses [hookify](https://github.com/anthropics/claude-code/tree/main/plugins/hookify) rules to catch common mistakes **before** the harness is launched. These rules live in `.claude/hookify.*.local.md` and are evaluated automatically by the hookify plugin on every tool call.

| Rule                        | Event | Action | What it catches                                                                                                                                                             |
| --------------------------- | ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `block-harness-on-main`     | bash  | warn   | Running `autonomous_agent_demo.py` — reminds to check out a feature branch in the primary checkout first. The harness creates commits and must not run on `main`.           |
| `warn-worktree-npm-install` | bash  | warn   | Running `git worktree add` (for dispatched parallel subagents) without a reminder to `npm install` afterward. `node_modules/` is gitignored and missing in fresh worktrees. |
| `warn-harness-dry-run`      | bash  | warn   | Running the harness with `--max-iterations` > 1 without having done a single-iteration dry-run first. Catches env/hook/permission issues early.                             |

**How they work:** Hookify rules are markdown files with YAML frontmatter that define a regex pattern, an event type (bash/file/stop), and an action (block/warn). The hookify plugin evaluates all enabled rules on every matching hook event. All three rules use `warn` — they show guidance but don't hard-block, since hookify pattern matching alone cannot inspect git state at runtime.

**Pre-launch checklist (enforced by these rules):**

1. **Feature branch** — `git branch --show-current` must NOT return `main`. From the primary checkout, `git checkout -b <branch-name>`. Do NOT `EnterWorktree` for the main agent (per `rules/common/worktrees.md`).
2. **Dependencies** — `npm install` current in the primary checkout (should already be there for active development).
3. **Dry-run** — `python3 -u autonomous_agent_demo.py --max-iterations 1 --skip-relay` to verify the environment before scaling up. Add `--no-sandbox` only on WSL2.

**Editing rules:** Rules take effect immediately on the next tool call — no restart needed. To disable a rule, set `enabled: false` in its frontmatter. To inspect all active rules at runtime, use the `/hookify:list` skill.

## File Roles

| File                            | Role                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `autonomous_agent_demo.py`      | CLI entry point (argparse, asyncio.run, Phase 1-2-3 orchestration)                         |
| `agent.py`                      | Core loop — per-feature Coder+Reviewer iterations, cloud review relay loop                 |
| `cli_client.py`                 | Default `claude -p` subprocess backend: session + resume, stream-JSON parser               |
| `client.py`                     | Default CLI backend factory (`create_client`) + shared settings helpers                    |
| `sdk_client.py`                 | Opt-in SDK fallback factory (`create_client`) — only module that imports `claude_code_sdk` |
| `hook_runner.py`                | Bridge: Claude CLI's settings.json hooks → Python `security.py` / `hooks.py`               |
| `policy_judge.py`               | LLM fallback for the bash allowlist; cached per-command                                    |
| `security.py`                   | Bash command allowlist + validators for `pkill`/`chmod`/`rm`/`gh`                          |
| `hooks.py`                      | PreToolUse hook protecting `feature_list.json` integrity                                   |
| `review.py`                     | Local Codex CLI review, cloud review polling (gh api), PR creation, comment parsing        |
| `prompts.py`                    | Load prompt templates, inject review findings, copy `app_spec.md` on first run             |
| `progress.py`                   | Read `feature_list.json`, render progress bar                                              |
| `prompts/initializer_prompt.md` | Prompt for Phase 1 (decompose spec into features)                                          |
| `prompts/coding_prompt.md`      | Prompt for Coder sessions (implement features)                                             |
| `prompts/reviewer_prompt.md`    | Prompt for fix sessions (address cloud review findings)                                    |
| `prompts/app_spec.md`           | Default app specification template                                                         |

## Codex Code Review Integration

A cross-vendor automated code review using OpenAI Codex provides a second-opinion gate that catches blind spots a same-model review would miss.

### Local Review (Phase 2)

Each feature iteration runs `codex exec review --base main` locally after the Coder finishes. If Codex finds issues, findings are fed back to the Coder on the next iteration. This loop continues until the review is clean or the iteration budget is exhausted.

### Cloud Review (Phase 3)

After all features are complete, the Coordinator:

1. Pushes the branch and creates/finds a PR (`gh pr create`)
2. Polls for a cloud Codex review comment (`gh api`, filtered by `github-actions[bot]`)
3. If findings exist, spawns a local Coder+Reviewer fix loop (budget: 2 iterations)
4. Pushes fixes and polls for the next review (up to `--max-relay-loops` cycles)

### GitHub Action

The Codex GitHub Action (`.github/workflows/codex-review.yml`) runs `openai/codex-action@v1` on every PR. It posts a formatted markdown comment with severity-tagged findings (CRITICAL/HIGH/MEDIUM/LOW). The structured output schema lives at `.github/codex/codex-output-schema.json`.

### Interactive Fix Loop

`npm run review:fix` or the `/harness-plugin:github-review` skill in Claude Code provides a self-driving fix loop: fetch Codex review → fix findings → push → poll for next review → repeat until clean (max 10 rounds).

### Deferring Findings to Follow-Up Issues

Not every Codex finding should be fixed in the current PR. When a finding is valid but represents a **design trade-off, architectural limitation, or scope expansion** rather than a bug in the current change, defer it:

1. **Create a GitHub issue** (`gh issue create`) with the finding details, impact, and proposed fix options
2. **Reply to the Codex comment on the PR** acknowledging the finding and linking the issue
3. **Move on** — don't loop endlessly on findings that require a different approach or separate PR

**When to defer** (vs fix in the current PR):

- The finding requires a different architectural approach (e.g., changing what data the UI displays)
- Fixing it would significantly expand the PR scope beyond the original feature
- The same finding keeps recurring across review rounds because the fix conflicts with the current design
- The finding is about a limitation documented in the design spec

**When NOT to defer** (must fix now):

- CRITICAL security vulnerabilities (command injection, path traversal, etc.)
- Data loss bugs that affect the happy path
- Regressions in existing functionality
- Findings fixable in <10 lines without design changes

### Project Context

Codex reads `AGENTS.md` at the repo root for project-specific review guidelines during both local and cloud reviews.

## Feature Tracking (`feature_list.json`)

Tracks implementation progress across phases. Each feature has:

- `id`, `phase`, `category`, `description`, `steps[]`, `dependencies[]`
- `"passes": true` = complete, `"passes": false` = pending

The coder agent picks the next feature whose dependencies are all satisfied. Features that exhaust their iteration budget without passing are marked as exhausted and skipped.

## Adding New Work

1. Write a new `app_spec.md` **at the project root** (not in `prompts/`)
   - `prompts.py` only copies `prompts/app_spec.md` → root if the root copy doesn't exist
   - Safest approach: write directly to the root `app_spec.md`
2. Run with `--clean` to wipe runtime files and trigger a fresh initializer:

   ```bash
   python3 autonomous_agent_demo.py --clean --max-iterations 10
   ```

   `--clean` removes `feature_list.json` and `claude-progress.txt` from the project root before starting. It **preserves `app_spec.md`** — that's your authored product spec, not harness runtime state. If the root has no `app_spec.md`, the initializer copies `prompts/app_spec.md` in as a one-time default; once you've authored your real spec at the root, `--clean` leaves it alone.

   Without `--clean`, the harness resumes from the existing `feature_list.json` — useful for continuing a previous run.

## SDK Hook API

The Claude Code SDK (v0.0.25+) passes the **full hook context** to PreToolUse hooks, not just the tool's input params. The tool parameters are nested inside `input_data["tool_input"]`:

```python
async def my_hook(input_data, tool_use_id=None, context=None):
    # input_data keys: session_id, transcript_path, cwd, permission_mode,
    #                  hook_event_name, tool_name, tool_input, tool_use_id
    tool_input = input_data.get("tool_input", input_data)
    command = tool_input.get("command", "")
```

## Plugin Installation

The harness skills are distributed as a Claude Code plugin. If `/harness-plugin:loop`, `/harness-plugin:review`, and `/harness-plugin:github-review` are not available, install the plugin:

```bash
# 1. Add the project's local marketplace (one-time)
/plugin marketplace add .

# 2. Install the harness plugin
/plugin install harness-plugin@harness
```

The marketplace definition is at `.claude-plugin/marketplace.json` (project root) and the plugin source is at `plugins/harness/`.

## Troubleshooting

| Symptom                                           | Cause                                                                                      | Fix                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `python: command not found`                       | WSL2/Linux may only have `python3`                                                         | Use `python3` instead of `python`                                                                                                                                                                   |
| All Bash commands blocked with "Empty command"    | Hook reads `input_data["command"]` instead of `input_data["tool_input"]["command"]`        | Already fixed in `security.py` and `hooks.py`                                                                                                                                                       |
| `spawn rg EACCES` in Glob/Grep                    | Claude Code's vendored ripgrep binary lost +x permission                                   | Preflight check auto-fixes this; or run `chmod +x ~/.npm-global/lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/x64-linux/rg`                                                             |
| User-level hook interferes with a harness run     | `claude -p` merges user settings on top of the project settings file                       | Disable the offending hook locally via `~/.claude/settings.json`; the harness deliberately does NOT wipe your config dir (that breaks CLI auth)                                                     |
| `app_spec.md` empty at root                       | `prompts.py` skips copy if root file exists                                                | Write spec directly to root `app_spec.md`, not `prompts/app_spec.md`                                                                                                                                |
| `ANTHROPIC_API_KEY not set` (with `--client sdk`) | `.env` not sourced while using the SDK fallback                                            | Run `set -a && source .env && set +a` before launching, or drop `--client sdk` to use the default CLI backend                                                                                       |
| Codex review always errors                        | `codex` CLI not installed or not authenticated (auth file missing at `~/.codex/auth.json`) | `npm i -g @openai/codex` if missing, then `codex login` to authenticate. The harness does NOT use `OPENAI_API_KEY`. Temporary workaround: `--skip-review` on Phase 2, or `--skip-relay` on Phase 3. |
| Cloud review times out                            | GitHub Action slow or `gh` not authenticated                                               | Run `gh auth login` and increase `--review-timeout`                                                                                                                                                 |
| `gh api` blocked by harness                       | Command uses a blocked method or data flag                                                 | Only GET requests allowed; check `security.py` `GH_BLOCKED_METHODS` and `GH_API_DATA_FLAGS`                                                                                                         |
| `claude: command not found` on `--client cli`     | `claude` CLI not installed or not on PATH                                                  | Install Claude Code CLI, or fall back with `--client sdk` (requires `ANTHROPIC_API_KEY`)                                                                                                            |
| Policy judge keeps blocking a safe command        | Command isn't in the allowlist and the default policy is deny                              | Add the command base to `harness/.policy_allow.local` (one per line) — deterministic, user-local. Or add to `ALLOWED_COMMANDS` in `security.py` for a codebase-wide allow.                          |
