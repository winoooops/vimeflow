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

| State          | When                                                                                                                                        | Action (armed)                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **NEEDS_FIX**  | unresolved review threads > 0, Codex review adjudication says reviewer findings should be fixed, or deterministic non-review CI failure     | `--execute` → `run.js <pr> --push`             |
| **CI_RED**     | transient reviewer reruns are exhausted/unavailable                                                                                         | report only                                    |
| **WAITING**    | CI/Claude still running · draft · not mergeable · no trusted Claude review yet · adjudication evidence insufficient · transient check rerun | report only or rerun transient reviewer checks |
| **GOOD_SHAPE** | 0 threads · trusted reviewer comments adjudicated clean by Codex · non-review CI green · `MERGEABLE`                                        | `--approve` → squash-merge + delete            |

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

When CI and review checks are green and review threads are clear, the daemon does
not treat Claude's `Overall: patch is correct` line as the single source of
truth. It polls the trusted `## Claude Code Review` comments, fetches the PR
diff, and calls `codex exec --sandbox read-only` with
`review-adjudication.schema.json`. Codex applies `agents/code-reviewer.md` and
`rules/common/idea-framework.md`: only findings with >80% confidence, plausible
real-world impact or meaningful future-change cost, and proportional fix cost are
blocking. Reviewer severity is evidence, not policy; a MEDIUM finding can block
when the IDEA/reality/fix-cost checks justify fixing it now, and can be ignored
when the danger is weak or the fix is disproportionate. Results are cached by PR
head + review-comment hash + diff hash, so unchanged evidence does not call
Codex repeatedly.

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

It runs `watch.js tick --execute` for queued PRs. `auto-review` is the opt-in
label that makes the daemon process a PR. `auto-approve` is only a modifier for a
PR the daemon is already processing; when present, that single PR cycle receives
the equivalent of `QA_APPROVE=1` / `--approve`.

Set `QA_LABEL` to change the work opt-in label. Set `QA_APPROVE_LABEL` to change
the approval modifier label; set it to an empty value to disable label-based
approval globally.

### Split-plane worker dispatch

The daemon owns webhooks, queue state, polling, and Linear observability. By
default, claimed PR work still runs locally through `watch.js tick --execute`.
For the cloud split-plane rollout, keep the control host light and delegate each
claimed PR cycle to a burst-worker dispatcher:

```bash
QA_MAX_PARALLEL=1 \
QA_TICK_RUNNER=command \
QA_TICK_COMMAND=/usr/local/sbin/vimeflow-qa-dispatch-worker \
node scripts/qa-runner/daemon.js
```

`QA_TICK_RUNNER=command` makes the daemon run `QA_TICK_COMMAND` instead of local
`watch.js`. The command receives the one-cycle contract through environment
variables:

| Env                           | Meaning                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `QA_PR`                       | GitHub PR number claimed from the daemon queue                      |
| `QA_REASON`                   | Webhook/poll reason such as `pr:labeled`, `ci:check_run`, or `poll` |
| `QA_LABEL`                    | Opt-in label, normally `auto-review`                                |
| `QA_APPROVE`                  | `1` only for an `auto-review` PR that also has `auto-approve`       |
| `QA_LINEAR_DECISION_COMMENTS` | `1` when decision comments should be posted                         |
| `QA_LINEAR_CREATE_ISSUES`     | `1` when missing Linear issues may be created                       |
| `QA_LINEAR_TEAM_KEY`          | Linear team key for issue creation                                  |
| `QA_MAX_CI_RERUNS`            | Bounded transient reviewer rerun cap                                |

The dispatcher must block until the burst worker completes that PR cycle and then
exit with the worker's `watch.js tick` exit code. The control daemon keeps its
existing post-cycle behavior: it re-snapshots the PR, records progress or retry
state, writes `.state/events.jsonl`, and posts Linear milestones. This keeps the
`t2.micro` from doing expensive Kimi/Codex/test work while preserving one
authoritative queue and one Linear status surface.

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
- **Approval is a second label** (`auto-approve`) — it never triggers work by itself.
- **One run per PR** — lock files under `.locks/` (gitignored); concurrency capped at `--max` (2).
- kimi works **only on the PR branch in an isolated worktree**; never `main`, never `--force`.
- **codex gate + bounded retry** before any commit.
- **author ≠ approver** — the fixer bot never merges its own work; the orchestrator does.
- Branch deletion on merge is a **remote API ref-delete**, not `gh --delete-branch`
  (whose local delete fails when a worktree holds the branch).
- Linear status via role-specific **app credentials**; never echo untrusted review
  text into a shell.
