# QA runner

Automates the PR-review-resolution loop (what `/lifeline:upsource-review` does by
hand) so reviews drive themselves to zero, with **Linear as the status surface**.
Design + rationale: [`docs/explorations/linear-agent-cicd-pilot.html`](../../docs/explorations/linear-agent-cicd-pilot.html).

## Shape

```
 ① watch.mjs (outer watcher)  — poll open PRs for actionable review findings,
    gate on opt-in (`auto-review` label) + a per-PR lock, dispatch the inner
    runner per eligible PR, and post status to Linear via the API key.
                 │
                 ▼  per PR, in its own worktree:
 ② kimi --afk  following playbook.md  — poll → fix → CODEX GATE → commit →
    push → reply/resolve threads → repeat until clean.   (the inner contract)
                 │
                 ▼
 ③ Linear  — control plane / observability via the `linear.env` API key
    (headless ⇒ scoped API key, not interactive MCP — see
    rules/common/linear-workflow.md).
```

- **codex** is the verify **gate** — kimi writes the fix, codex gates it (the
  quality backstop). Confirmed callable (`codex exec` + `codex review`).
- **Honest scope:** this runs on **your host** — the toolchain (`kimi`, `codex`,
  `gh`, `git`) cannot run serverless. Linear observes; it does not execute.

## Status

| Increment | What                                                                                                 | State             |
| --------- | ---------------------------------------------------------------------------------------------------- | ----------------- |
| **1**     | `watch.mjs scan` — read-only: list eligible PRs + what it WOULD do                                   | ✅ **safe, here** |
| 2         | `watch.mjs run --execute` — lock → dispatch kimi → codex gate → push → reply/resolve → Linear status | ⬜ not wired      |
| 3         | host: self-hosted GitHub Actions runner on `pull_request_review`                                     | ⬜ later          |

## Usage (increment 1)

```bash
node scripts/qa-runner/watch.mjs scan          # eligible PRs (need the `auto-review` label)
node scripts/qa-runner/watch.mjs scan --all    # ignore the label gate (debug)
node scripts/qa-runner/watch.mjs scan --pr 311 # evaluate a single PR
```

`scan` is **read-only** (GitHub queries only) — it dispatches nothing.

## Host (v1 → v2)

- **v1 — your machine:** a cron / `/loop` calling `scan`, then `run` per eligible PR. Everything's already authed locally.
- **v2 — a self-hosted GitHub Actions runner** on a small always-on box, triggered by `pull_request_review`: event-driven for free, full toolchain, your secrets.

## Guardrails

- **Opt-in only** (`auto-review` label) — narrow blast radius for the pilot.
- **One run per PR** — lock files under `.locks/` (gitignored).
- kimi works **only on the PR branch in an isolated worktree**; never `main`, never `--force`.
- **codex gate + bounded retry** before any commit.
- Linear status via the **scoped API key**; never echo untrusted review text into a shell.
