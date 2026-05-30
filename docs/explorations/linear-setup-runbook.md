# Linear integration — kickoff runbook

Operational do-list for the plan in [`linear-migration-analysis.html`](./linear-migration-analysis.html).
All Linear facts verified against live docs on 2026-05-30; cost target = **free tier**.

**Legend:** 🧑 = needs your login / OAuth (an agent can't do it) · 🤖 = agent- or script-runnable

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

## Phase 4 — scripted status for hooks/CI (optional) 🤖

10. 🧑 Create a personal API key → `Settings → Security & access → Personal API keys`; copy `scripts/linear.env.example` → `scripts/linear.env`, fill `LINEAR_API_KEY`, `source` it.
11. 🤖 Verify the key: `./scripts/linear-status.sh whoami`
12. 🤖 List a team's states: `./scripts/linear-status.sh states VIM`
13. 🤖 Move an issue: `./scripts/linear-status.sh set VIM-1 <STATE_UUID>` (use `--dry-run` first to inspect the request)

## Later — full delegation (Path C)

Assign-an-issue-to-an-agent autonomy needs an OAuth `actor=app` integration with Agent-session webhooks, or the still-**open** native path ([anthropics/claude-code#12925](https://github.com/anthropics/claude-code/issues/12925)). Not required for daily use — Phases 1–2 already give agents status control.
