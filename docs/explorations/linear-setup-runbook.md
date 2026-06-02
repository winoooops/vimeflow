# Linear integration — kickoff runbook

Operational do-list for the plan in [`linear-migration-analysis.html`](./linear-migration-analysis.html).
All Linear facts verified against live docs on 2026-05-30; cost target = **free tier**.

**Legend:** 🧑 = needs your login / OAuth (an agent can't do it) · 🤖 = agent-runnable (via MCP)

---

## Phase 0 — workspace 🧑

1. 🧑 Sign up at <https://linear.app>, create a team **Vimeflow** (suggested key `VIM`). Stay on the **Free** plan.
2. 🧑 `Settings → Team → Issue statuses` — confirm the workflow: Backlog → Todo → In Progress → In Review → Done / Canceled.
3. 🧑 Recreate labels you use: `bug`, `enhancement`, `security`, `ui-handoff-migration`, `documentation` (map `wontfix`/`duplicate` → Canceled + label).

## Phase 1 — GitHub link 🧑 (unlocks free auto-status)

4. 🧑 `Settings → Integrations → GitHub` → install on `winoooops/vimeflow` (read metadata/checks, read+write issues & PRs).
5. After this, a PR with `Fixes VIM-1` in the title moves the issue to **In Progress** on open and **Done** on merge — no agent change needed.

## Phase 2 — agents read/write status (MCP) 🧑

6. 🧑 Claude Code: `claude mcp add --transport http linear-server https://mcp.linear.app/mcp` then run `/mcp` to authenticate.
7. 🧑 Codex: `codex mcp add linear --url https://mcp.linear.app/mcp` then `codex mcp login linear`.
8. 🤖 Smoke test: ask the agent "find VIM-1 in Linear and move it to In Review" — it should act via MCP.

## Phase 3 — port existing issues 🧑

9. 🧑 `Settings → Import/Export → Import → GitHub` (lift everything; note: created/modified dates do **not** carry over), **or** hand-create the live handful.

## Phase 4 — direct API access (optional, non-agent only) 🧑

10. 🧑 For the QA runner role bots, create two Linear OAuth apps:
    - **Kimi Review Runner** → copy `linear-agent.env.example` to `linear-agent.env`.
    - **Vimeflow Orchestrator** → copy `linear-orchestrator.env.example` to `linear-orchestrator.env`.
11. 🧑 In each app, enable **Client credentials**, grant access to the VIM team, and store `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, and `LINEAR_SCOPES=read,write` in the matching gitignored env file.
12. 🤖 Smoke test each role:

```bash
node scripts/qa-runner/lib/linear-status.js VIM-18 "fixer Linear app smoke" --as fixer
node scripts/qa-runner/lib/linear-status.js VIM-18 "orchestrator Linear app smoke" --as orchestrator
```

13. 🧑 Only for git hooks / CI that are not role bots and are not tied to a PR. Create a personal API key → `Settings → Security & access → Personal API keys`; copy `linear.env.example` → `linear.env` (repo root, gitignored), fill `LINEAR_API_KEY`, then `source linear.env`. The MCP server uses OAuth and does **not** use this key. Details: `rules/common/linear-workflow.md`.

## Later — full delegation (Path C)

Assign-an-issue-to-an-agent autonomy needs an OAuth `actor=app` integration with Agent-session webhooks, or the still-**open** native path ([anthropics/claude-code#12925](https://github.com/anthropics/claude-code/issues/12925)). Not required for daily use — Phases 1–2 already give agents status control.
