# QA runner

Automates the PR-review-resolution loop (what `/lifeline:upsource-review` does by
hand) so reviews drive themselves to zero, with **Linear as the status surface**.
Design + rationale: [`docs/explorations/linear-agent-cicd-pilot.html`](../../docs/explorations/linear-agent-cicd-pilot.html).

## Shape

```
 ① watch.js (outer watcher + state machine, as the ORCHESTRATOR bot)  — poll open
    PRs, gate on opt-in (`auto-review` label) + a per-PR lock, compute each PR's
    review STATE, and act:
       NEEDS_FIX  → dispatch the inner runner (--execute), up to --max in parallel
       GOOD_SHAPE → squash-merge as the orchestrator bot + delete branch (--approve)
       WAITING    → report only, or rerun transient reviewer checks when armed
       CI_RED     → report only once automatic reruns are exhausted/unavailable
                 │
                 ▼  per NEEDS_FIX PR, concurrently, each in its own worktree:
 ② run.js → kimi --afk (as the FIXER bot) · upsource-review skill  — poll → fix →
    CODEX GATE → commit → push → reply/resolve threads → repeat until clean.
                 │
                 ▼
 ③ Linear  — control plane / observability. Each state transition mirrors to the
    linked issue (a `VIM-N` in the PR body). The native GitHub↔Linear sync moves
    the issue → Done on merge; the watcher's own posts use role-specific Linear
    app credentials (`linear-agent.env` / `linear-orchestrator.env`) so comments
    are attributed to the fixer or orchestrator app. Personal `linear.env` remains
    a fallback for non-role scripts only.
```

**Two bot identities** so the bot that writes a fix is never the bot that approves
it (author ≠ approver — and it satisfies "require approval from a non-author"
branch protection): the **fixer** runs as `bot.env`, the **orchestrator** merges as
`orchestrator.env`. Either absent ⇒ that action falls back to your own `gh`.

- **codex** is the verify **gate** — kimi writes the fix, codex gates it (the
  quality backstop). Confirmed callable (`codex exec` + `codex review`).
- **Honest scope:** this runs on **your host** — the toolchain (`kimi`, `codex`,
  `gh`, `git`) cannot run serverless. Linear observes; it does not execute.

## The review state machine

`computeState(pr)` returns exactly one of four states. The **reviewer** CI checks
(`Claude Code Review`, `Codex Code Review`, `Post Review Comment`) are excluded
from the CI gate, so a clean patch is never held `WAITING` by its own reviewers.

| State          | When                                                                                                     | Action (armed)                                 |
| -------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **NEEDS_FIX**  | unresolved review threads > 0, Claude verdict "patch has issues", or deterministic non-review CI failure | `--execute` → `run.js <pr> --push`             |
| **CI_RED**     | transient reviewer reruns are exhausted/unavailable                                                      | report only                                    |
| **WAITING**    | CI/Claude still running · draft · not mergeable · no Claude review yet · transient reviewer check rerun  | report only or rerun transient reviewer checks |
| **GOOD_SHAPE** | 0 threads · Claude clean · non-review CI green · `MERGEABLE`                                             | `--approve` → squash-merge + delete            |

Deterministic non-review CI failures include unit tests, Rust tests, type/check
binding verification, code quality/lint, and build failures. The watcher passes
the failed check names and GitHub Actions URLs into the fixer as
`QA_FIX_CONTEXT`, so the fixer can inspect logs and repair code even when there
are no unresolved review threads.

Transient reviewer checks (`Claude Code Review`, `Codex Code Review`, and
`Post Review Comment`) can be rerun automatically with `gh run rerun --failed`
when `--execute` is armed. Reruns are capped by PR + head SHA + check identity
(default **3**, configurable with `--max-ci-reruns` / `QA_MAX_CI_RERUNS`), so the
daemon cannot spin forever.

`NEEDS_FIX` PRs are dispatched **concurrently**, capped at `--max` (default **2**) —
each kimi runs in its own `qa-pr-N` worktree behind its own `.locks/pr-N.lock`, so
parallel runs never collide. Output is teed to `logs/pr-N.log` and prefixed `[#N]`
on the console so you can watch interleaved runs.

`GOOD_SHAPE` is the codified "good shape" exit of `/lifeline:upsource-review`: the
review bots have to be satisfied before anything merges. That gate is the point —
it's how the bots improve the code as part of the self-improvement loop. The
**whitelist override** (a verified Linear/whitelist member comments to force
`/approve-pr` before good-shape is fully met) is the deliberate human escape hatch,
designed but not yet wired; its load-bearing security boundary is verifying the
authenticated comment author is on the whitelist.

## Status

| Increment | What                                                                                              | State                    |
| --------- | ------------------------------------------------------------------------------------------------- | ------------------------ |
| **1**     | `watch.js scan` — read-only: list eligible PRs                                                    | ✅ done                  |
| **2**     | `run.js` — lock → dispatch kimi (upsource-review skill) → codex gate → push, fixer bot identity   | ✅ done                  |
| **3**     | `watch.js tick/watch` — outer state machine, `--execute` fixes, `--approve` merges, Linear wiring | ✅ done — proven on #317 |
| **4**     | two-bot loop (fixer ≠ orchestrator) + parallel fixes (cap `--max`)                                | ✅ done                  |
| 5         | host: cron / `/loop`, then a self-hosted GitHub Actions runner on `pull_request_review`           | ⬜ next                  |

## Usage

```bash
# read-only eligibility (no side effects, ever)
node scripts/qa-runner/watch.js scan            # eligible PRs (need the `auto-review` label)
node scripts/qa-runner/watch.js scan --all      # ignore the label gate (debug)
node scripts/qa-runner/watch.js scan --pr 317   # a single PR

# one pass of the state machine — REPORT-ONLY by default
node scripts/qa-runner/watch.js tick            # classify every eligible PR, do nothing
node scripts/qa-runner/watch.js tick --pr 317   # classify one PR

# arm the actions (each is independent and opt-in)
node scripts/qa-runner/watch.js tick --execute            # NEEDS_FIX  → run upsource cycles (parallel, cap 2)
node scripts/qa-runner/watch.js tick --execute --max 3    # …up to 3 at once
node scripts/qa-runner/watch.js tick --approve            # GOOD_SHAPE → squash-merge
node scripts/qa-runner/watch.js tick --execute --approve  # full autonomy
node scripts/qa-runner/watch.js tick --execute --max-ci-reruns 3
                                                          # rerun transient reviewer failures up to 3 times
node scripts/qa-runner/watch.js tick --pr 317 --linear-decisions --reason manual-debug
                                                          # post one deduped Linear decision comment
node scripts/qa-runner/watch.js tick --pr 317 --linear-create-issues --linear-team VIM
                                                          # create a missing Linear issue for an unlinked PR

# loop forever (Ctrl-C to stop)
node scripts/qa-runner/watch.js watch --execute --approve
```

`run.js` (the inner runner) can also be driven directly; it is **dry-run by
default**, `--push` arms the live path, and it adopts the fixer bot identity from
`bot.env` if present:

```bash
node scripts/qa-runner/run.js 317          # dry-run: kimi fixes + codex gate, nothing pushed
node scripts/qa-runner/run.js 317 --push   # live: commit/push as the fixer bot, reply/resolve, Linear status
```

## Host (v1 → v2)

- **v1 — your machine:** a cron / `/loop` calling `watch.js tick --execute --approve`
  (or `watch`). Everything's already authed locally.
- **v2 — a self-hosted GitHub Actions runner** on a small always-on box, triggered by
  `pull_request_review`: event-driven for free, full toolchain, your secrets.

## Daemon rollout

The webhook daemon is safe-by-default for the staged rollout:

```bash
GITHUB_WEBHOOK_SECRET=... QA_TRUSTED_SENDERS=you node scripts/qa-runner/daemon.js
```

Run the daemon from a neutral checkout of the repository, normally `main` or the
integration branch that contains the runner code. It does not need PR branches
preloaded. For each `NEEDS_FIX` PR, `run.js` resolves the PR head branch, fetches
`origin/<branch>`, and creates or resets `.claude/worktrees/qa-pr-N` from that
remote branch before running the fixer. This is the expected shape for a fresh
dedicated host: the root clone stays neutral, while each PR gets its own isolated
worktree and lock file.

If the PR branch is already checked out in another local worktree, the runner
refuses to self-review and records a dispatch-blocked event instead of counting
failed fixer attempts. On a dedicated daemon host this should normally only happen
when an operator manually checks out the PR branch in the daemon clone.

It runs `watch.js tick --execute` for queued PRs. It does **not** pass
`--approve` unless explicitly armed with `QA_APPROVE=1`, which belongs to the
orchestrator-bot rung.

By default the daemon also passes `--linear-decisions --reason <event>` into each
tick. The watcher posts one structured, deduped Linear decision comment per PR
head/state/action combination, so operators can see why a signal became
`WAITING`, `NEEDS_FIX`, `CI_RED`, or `GOOD_SHAPE` without reading local logs.
Decision comments can be disabled with `QA_LINEAR_DECISION_COMMENTS=0` or
`linearDecisionComments: false` in `config.json`.

If `QA_LINEAR_CREATE_ISSUES=1` / `linearCreateIssues: true` is enabled, an
eligible PR with no `VIM-N` in the body or branch name gets a new Linear issue
created through the orchestrator tool `create_linear_issue_for_pr`. The issue
description links back to the GitHub PR, and the runner caches the PR→issue
mapping for future comments.

When the fixer completes a live `/lifeline:upsource-review` cycle, `run.js` posts
a structured fixer comment with the PR, branch, pushed head, Kimi exit, stop mode,
and worktree cleanliness.

## Identity

### GitHub (`lib/bot-identity.js`)

Two optional, gitignored env files — each a **separate GitHub account** so machine
actions are attributable and split by role. Either absent ⇒ that role acts as your
own `gh` (backward-compatible). **Never paste a token into chat** — they're read
from these files.

| File               | Keys        | Role                                      | Used by                  |
| ------------------ | ----------- | ----------------------------------------- | ------------------------ |
| `bot.env`          | `GH_BOT_*`  | inner **fixer**                           | `run.js` (kimi)          |
| `orchestrator.env` | `GH_ORCH_*` | outer **orchestrator** (reviews + merges) | `watch.js` (`--approve`) |

Each = a classic PAT (`repo` scope) on a Write-collaborator account; see the
`*.example` files. The identity flows through three points: API actor (`GH_TOKEN`),
commit author (`GIT_AUTHOR_*`), and HTTPS push (the `gh` credential helper).

### Linear (`lib/linear-status.js`)

Two optional, gitignored env files — each a **separate Linear OAuth app** with
Client credentials enabled. `linear-status.js --as fixer|orchestrator` mints an
app-actor token on demand, so issue comments show the bot app identity in Linear.

| File                      | Keys                                       | Role                   | Used by                       |
| ------------------------- | ------------------------------------------ | ---------------------- | ----------------------------- |
| `linear-agent.env`        | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` | inner **fixer**        | `run.js` status posts         |
| `linear-orchestrator.env` | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` | outer **orchestrator** | `watch.js` status/merge posts |

Use `LINEAR_SCOPES=read,write`. `LINEAR_ACCESS_TOKEN` / `LINEAR_AGENT_TOKEN` are
kept only as compatibility fallbacks for existing OAuth tokens; client credentials
are preferred for the daemon because the helper can re-mint app tokens without an
interactive login.

## Guardrails

- **Opt-in only** (`auto-review` label) — narrow blast radius for the pilot.
- **Report-only by default** — `--execute` / `--approve` must be passed explicitly.
- **One run per PR** — lock files under `.locks/` (gitignored); concurrency capped at `--max` (2).
- kimi works **only on the PR branch in an isolated worktree**; never `main`, never `--force`.
- **codex gate + bounded retry** before any commit.
- **author ≠ approver** — the fixer bot never merges its own work; the orchestrator does.
- Branch deletion on merge is a **remote API ref-delete**, not `gh --delete-branch`
  (whose local delete fails when a worktree holds the branch).
- Linear status via role-specific **app credentials**; never echo untrusted review
  text into a shell.
