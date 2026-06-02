# Linear Workflow

Issue tracking for this repo lives in **Linear** (team **Vimeflow**, key `VIM`). Code and pull requests stay on GitHub and sync to Linear. Work status moves three ways — agents via MCP, pull requests via GitHub automation, and direct API access via a personal key.

## How status moves

| Context                                            | Mechanism                                       | Notes                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| An agent (Claude Code / Codex) acting in a session | **Linear MCP server**                           | Read/create/update issues, projects, comments. Auth via OAuth.                                                  |
| A pull request                                     | **GitHub ↔ Linear automation**                  | PR open → In Progress, merge → Done. PR is linked on the issue.                                                 |
| QA runner role bots (`fixer`, `orchestrator`)      | **GraphQL API + Linear app client credentials** | App credentials in `linear-agent.env` / `linear-orchestrator.env`; comments are attributed to the matching app. |
| A script / git hook / CI step (non-agent, non-PR)  | **GraphQL API + personal key**                  | `api.linear.app/graphql`; key in `linear.env`. MCP ignores it.                                                  |

## Agent access (MCP) — the default

The Linear MCP server is how agents touch Linear. Set up once per machine:

```bash
# Claude Code
claude mcp add --transport http linear-server https://mcp.linear.app/mcp   # then /mcp to authenticate
# Codex
codex mcp add linear --url https://mcp.linear.app/mcp && codex mcp login linear
```

Newly-added MCP servers load on the next Claude Code start — a mid-session `claude mcp add` won't appear until `/mcp` reconnect or restart.

## Pull requests ⇄ issues

Reference the Linear issue in the PR so status flows automatically:

- Put a closing magic word + the issue id in the **PR title or body**: `Closes VIM-6` (also `Fixes` / `Resolves`); non-closing: `Refs VIM-6`.
- Magic words work **regardless of the git branch name** — no need to rename the branch.
- PR open → **In Progress**; merge to the default branch → **Done**.

## Direct API access (scripts / hooks / CI only)

The Linear MCP uses OAuth and does **not** use a personal key — this path is only for non-agent automation.

- For the QA runner, prefer role-specific Linear OAuth apps:
  - `linear-agent.env` for the fixer app.
  - `linear-orchestrator.env` for the orchestrator app.
  - Enable **Client credentials** in each Linear app.
  - Store `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, and `LINEAR_SCOPES=read,write`.
  - `scripts/qa-runner/lib/linear-status.js --as fixer|orchestrator` mints an app-actor token at runtime and posts as that app.
- Create a key: `Linear → Settings → Security & access → Personal API keys`.
- Copy `linear.env.example` → `linear.env` (repo root, gitignored), fill `LINEAR_API_KEY`, then `source linear.env`. The `export` propagates the key to child processes.
- Call `https://api.linear.app/graphql` with `Authorization: $LINEAR_API_KEY`. Use curl `--fail-with-body` (keep error bodies) **and** check the response `errors[]` array — GraphQL returns errors with HTTP 200.

## Conventions

- **Team / key:** Vimeflow / `VIM`; issues are `VIM-<n>`.
- **Statuses:** Backlog → Todo → In Progress → In Review → Done; `Canceled` / `Duplicate` for dropped work (map GitHub `wontfix` → Canceled, `duplicate` → a Duplicate relation).
- **Never commit a real key** — `linear.env` and `linear-*.env` are gitignored; only `*.env.example` placeholders are tracked.

Background, cost analysis, and migration steps live in `docs/explorations/linear-migration-analysis.html` + `docs/explorations/linear-setup-runbook.md`.
