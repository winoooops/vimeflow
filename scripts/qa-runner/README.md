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
       REVOKE     → post PR/Linear rework request; do not dispatch fixer
       GOOD_SHAPE → squash-merge as the orchestrator bot + delete branch (--approve)
       WAITING    → report only, or rerun transient reviewer checks when armed
       WAITING_CONFLICT → post PR/Linear conflict handoff; do not dispatch fixer
       CI_RED     → report only once automatic reruns are exhausted/unavailable
                 │
                 ▼  per NEEDS_FIX PR, concurrently, each in its own worktree:
 ② run.js → fixer engine (as the FIXER bot) · upsource-review skill  — poll →
    fix → CODEX GATE → commit → push → reply/resolve threads → repeat until clean.
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

- **Fixer engine** defaults to Kimi Code. Set `QA_FIXER_ENGINE=codex` to have
  the worker run the whole review-fix cycle through `codex exec` instead.
- **codex** remains the verify **gate** in the lifeline skill; in Codex fixer
  mode, Codex also drives the implementation pass. Confirmed callable
  (`codex exec` + `codex review`).
- **Kimi Code** runs through the official headless CLI path:
  `kimi --skills-dir <dir> -p <prompt> --output-format stream-json`. Configured
  OAuth/model aliases can set `KIMI_MODEL` to add `-m <alias>`; clean API-key
  workers use `KIMI_MODEL_NAME` / `KIMI_MODEL_API_KEY` and intentionally omit
  `-m` so Kimi Code can synthesize the temporary model from env.
- **Honest scope:** this runs on **your host** — the toolchain (`kimi`, `codex`,
  `gh`, `git`) cannot run serverless. Linear observes; it does not execute.

## The review state machine

`computeState(pr)` returns exactly one review-loop state. The **reviewer** CI checks
(`Claude Code Review`, `Codex Code Review`, `Post Review Comment`) are excluded
from the CI gate, so a clean patch is never held `WAITING` by its own reviewers.

| State                | When                                                                                                                                                      | Action (armed)                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **NEEDS_FIX**        | unresolved review threads > 0, Codex review adjudication says reviewer findings are localized and should be fixed, or deterministic non-review CI failure | `--execute` → `run.js <pr> --push`             |
| **REVOKE**           | Codex review adjudication says the PR needs author/operator redesign, re-scoping, or security/architecture rework before a safe fixer cycle               | post GitHub + Linear decision; no fixer        |
| **CI_RED**           | transient reviewer reruns are exhausted/unavailable                                                                                                       | report only                                    |
| **WAITING**          | CI/Claude still running · draft · not mergeable · no trusted Claude review yet · adjudication evidence insufficient · transient check rerun               | report only or rerun transient reviewer checks |
| **WAITING_CONFLICT** | GitHub reports `CONFLICTING` or `DIRTY`, so the PR cannot merge cleanly into its base branch                                                              | post GitHub + Linear decision; no fixer        |
| **GOOD_SHAPE**       | 0 threads · trusted reviewer comments adjudicated clean by Codex · non-review CI green · `MERGEABLE`                                                      | `--approve` → squash-merge + delete            |

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
Codex repeatedly. Every adjudicated finding includes a short `fix_direction`
sentence; blocking directions are passed into `QA_FIX_CONTEXT` so the fixer gets
the adjudicator's preferred implementation route instead of re-deriving it from
scratch. When adjudication returns `REVOKE`, the daemon posts the
structured decision directly to the GitHub PR and to the linked Linear issue, then
stops; it does not enter the fixer loop even when `--execute` is armed.

The adjudicator makes a bounded retry before giving up on malformed or missing
structured output. Each failed attempt writes a JSON artifact under
`.state/review-adjudication/` with the Codex status, stderr/stdout tail, raw
structured-output text when present, and attempt number. If all attempts fail,
`watch.js` exits through the existing transient path, so poll-triggered work
tries again on the next poll and webhook/manual work is requeued by daemon
backoff.

`NEEDS_FIX` PRs are dispatched **concurrently**, capped at `--max` (default **3**) —
each fixer runs in its own `qa-pr-N` worktree behind its own `.locks/pr-N.lock`, so
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
| **2**     | `run.js` — lock → dispatch Kimi/Codex fixer → codex gate → push, fixer bot identity               | ✅ done                  |
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
node scripts/qa-runner/watch.js tick --execute            # NEEDS_FIX  → run upsource cycles (parallel, cap 3)
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
node scripts/qa-runner/run.js 317          # dry-run: configured fixer + codex gate, nothing pushed
node scripts/qa-runner/run.js 317 --push   # live: commit/push as the fixer bot, reply/resolve, Linear status
QA_FIXER_ENGINE=codex node scripts/qa-runner/run.js 317 --push
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

The daemon owns webhooks, queue state, polling, review adjudication, merge
decisions, and Linear observability. By default, `NEEDS_FIX` work runs locally
through `run.js <pr> --push`. For the cloud split-plane rollout, keep the
control host light and delegate only the expensive fixer pass to a burst-worker
dispatcher:

```bash
QA_MAX_PARALLEL=2 \
QA_TICK_RUNNER=local \
QA_FIX_COMMAND="node /opt/vimeflow/repo/scripts/qa-runner/dispatch-worker.js" \
node scripts/qa-runner/daemon.js
```

`QA_FIX_COMMAND` makes `watch.js` keep classification and `GOOD_SHAPE` approval
on the control host, while `NEEDS_FIX` dispatches the fixer-only worker command.
The command receives the fixer contract through environment variables:

| Env                           | Meaning                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `QA_PR`                       | GitHub PR number claimed from the daemon queue                      |
| `QA_REASON`                   | Webhook/poll reason such as `pr:labeled`, `ci:check_run`, or `poll` |
| `QA_LABEL`                    | Opt-in label, normally `auto-review`                                |
| `QA_LINEAR_DECISION_COMMENTS` | `1` when decision comments should be posted                         |
| `QA_LINEAR_CREATE_ISSUES`     | `1` when missing Linear issues may be created                       |
| `QA_LINEAR_TEAM_KEY`          | Linear team key for issue creation                                  |
| `QA_MAX_CI_RERUNS`            | Bounded transient reviewer rerun cap                                |
| `QA_FIXER_ENGINE`             | Optional fixer engine override: `kimi` (default) or `codex`         |
| `QA_CODEX_MODEL`              | Optional Codex model pin for Codex fixer mode                       |
| `QA_CODEX_SANDBOX`            | Optional Codex sandbox mode, default `workspace-write`              |
| `QA_FIXER_TIMEOUT_MS`         | Optional fixer timeout in milliseconds, default 90 minutes          |
| `QA_WORKER_KEEP_ALIVE`        | `1` when the daemon owns burst-worker stop through its idle timer   |
| `QA_WORKER_MIN_FREE_PERCENT`  | Minimum worker filesystem free percentage after cleanup, default 15 |
| `QA_FIX_CONTEXT`              | Structured control-plane reason/findings for the fixer              |
| `QA_LINEAR_PARENT_COMMENT_ID` | Active `NEEDS_FIX` Linear comment id for fixer status replies       |

The dispatcher must block until the burst worker completes that fixer pass and
then exit with `run.js`'s exit code. The control daemon keeps its existing
post-cycle behavior: it re-snapshots the PR, records progress or retry state,
writes `.state/events.jsonl`, and posts Linear milestones. This keeps the
`t2.micro` from doing expensive fixer/test work while preserving one
authoritative queue, one classifier, and one Linear status surface.

### Codex Auth Split

The control daemon uses Codex only for review adjudication. It should use the
service user's browser-based Codex login under `CODEX_HOME`, not usage-based API
keys. `control-env-from-ssm.sh` writes `CODEX_HOME` to `control.env`, verifies
that `auth.json` exists by default, and intentionally does not read
`CODEX_API_KEY` or `OPENAI_API_KEY` from SSM. The adjudicator also removes those
API-key env vars before spawning `codex exec` so accidental ambient worker keys
cannot switch control-plane decisions onto usage-based billing.

Run the interactive login once on the control host:

```bash
sudo -u vimeflow-qa -H env CODEX_HOME=/etc/vimeflow/qa-runner/codex codex login
```

Burst workers can use either a mounted Codex auth volume or worker-only API
keys. The preferred production path is
`QA_WORKER_CODEX_AUTH_MODE=existing` with `QA_WORKER_CODEX_HOME` pointing at the
attached EBS volume that contains `auth.json`; `worker-env-from-ssm.sh` validates
that cache and does not read `CODEX_API_KEY`. For usage-based hot-swap, set
`QA_WORKER_CODEX_AUTH_MODE=api-key`; the same script then consumes the worker
`CODEX_API_KEY` parameter, runs `codex login --with-api-key`, and writes
`/etc/vimeflow/qa-runner/worker.env` for fixer-side `codex exec` and related
provider use.

`dispatch-worker.js` is the built-in dispatcher for the production rollout. It
supports:

- `QA_WORKER_MODE=local` for contract smoke tests.
- `QA_WORKER_MODE=ssh` for an already-running worker reachable by SSH.
- `QA_WORKER_MODE=ssm` for AWS Systems Manager `AWS-RunShellScript` dispatch with
  no inbound SSH.
- `QA_WORKER_INSTANCE_IDS=i-aaa,i-bbb,i-ccc` enables SSM fleet dispatch. The
  dispatcher leases one local slot before sending SSM, so parallel
  `dispatch-worker.js` processes spread over the configured workers instead of
  all targeting the first instance. `QA_WORKER_INSTANCE_ID` remains supported
  for the single-worker path.
- `QA_WORKER_CAPACITY_PER_INSTANCE=2` controls how many concurrent PR fixer
  passes a worker may receive. Fleet mode defaults to `2`; set
  `QA_MAX_PARALLEL` to `instance count * capacity` for the desired burst limit.
- `QA_WORKER_BURST=1` for SSM workers that may be stopped between fix cycles.
  The dispatcher starts the instance when needed, waits for EC2 `running`, then
  retries the actual SSM worker command until the target accepts it.
- `QA_WORKER_STOP_AFTER_RUN=1` enables daemon-owned idle stop for SSM burst
  workers. When the daemon dispatches a fixer, it always sends
  `QA_WORKER_KEEP_ALIVE=1` so the SSM dispatch layer never makes a stale
  per-command stop decision. The daemon performs a best-effort idle stop after
  the queue drains. Standalone `dispatch-worker.js` runs can still stop after
  the command unless they also pass keep-alive. Stop failures are logged as
  warnings and do not replace the fixer exit code.
- `QA_WORKER_IDLE_STOP_SECONDS=2100` controls the daemon's idle-stop grace
  period after a keep-alive run drains the queue. The default keeps the worker
  warm through slow CI/Claude review rounds before stopping it.
- `QA_WORKER_TIMEOUT_SECONDS=7200` is the default SSM command cap. Keep it above
  the 90 minute fixer timeout so checkout, cleanup, local CI, and status posting
  have room to finish.
- `QA_WORKER_LEASE_WAIT_SECONDS=7200` caps how long a dispatch waits for a free
  fleet slot. Stale lease files whose owning dispatch process is gone are
  removed automatically.
- Codex fixer workers that run local CI need `t3.large` or larger. `t3.medium`
  is acceptable only for light smoke work; under Rust/Vitest verification it can
  wedge SSM with `ConnectionLost`, which should be treated as a worker capacity
  or host-health problem rather than solved by increasing timeouts alone.
- `QA_WORKER_MIN_FREE_PERCENT=15` controls the worker disk health gate. The
  worker removes stale `.claude/worktrees/qa-pr-*`, matching git metadata, and
  stale PR locks before and after each fixer pass. If free space is still below
  the threshold, it exits with `QA_WORKER_DISK_LOW`; the daemon records a
  `worker_infra_unhealthy` retry event and posts the details to Linear without
  incrementing the fixer failure streak.

The remote side runs `worker-cycle.js`, which maps the daemon's environment
contract into one `run.js <PR> --push` fixer pass. It never arms approval; the
control host keeps `GOOD_SHAPE` approve/merge under the orchestrator identity. See
[`docs/qa-runner-cloud-infra.md`](../../docs/qa-runner-cloud-infra.md) for the
VIM-70 AWS, Cloudflare, credential, and smoke-test runbook.

By default the daemon also passes `--linear-decisions --reason <event>` into each
tick. The watcher posts one structured, deduped Linear decision comment per PR
head/state/action combination, so operators can see why a signal became
`WAITING`, `NEEDS_FIX`, `CI_RED`, or `GOOD_SHAPE` without reading local logs.
Decision comments can be disabled with `QA_LINEAR_DECISION_COMMENTS=0` or
`linearDecisionComments: false` in `config.json`.

By default, `QA_LINEAR_CREATE_ISSUES=1` / `linearCreateIssues: true` makes an
eligible PR with no owning `VIM-N` in the body or branch name get a new Linear
issue through the orchestrator tool `create_linear_issue_for_pr`. Explicit
`Refs` / `Closes` links and branch-name issue IDs count as owning links;
`## Follow-ups` issue lists do not. The issue description links back to the
GitHub PR, the runner caches the PR→issue mapping for future comments, and the
orchestrator GitHub identity backfills `Refs VIM-N` into the PR body and posts
one deduped PR comment with the created Linear issue link. Set
`QA_LINEAR_CREATE_ISSUES=0` to disable creation and GitHub writes.

When the fixer completes a live `/lifeline:upsource-review` cycle, `run.js` posts
a structured fixer comment with the PR, branch, pushed head, fixer engine, fixer
exit, stop mode, and worktree cleanliness.

## Identity

### GitHub (`lib/bot-identity.js`)

Two optional, gitignored env files — each a **separate GitHub account** so machine
actions are attributable and split by role. Either absent ⇒ that role acts as your
own `gh` (backward-compatible). **Never paste a token into chat** — they're read
from these files.

| File               | Keys        | Role                                      | Used by                  |
| ------------------ | ----------- | ----------------------------------------- | ------------------------ |
| `bot.env`          | `GH_BOT_*`  | inner **fixer**                           | `run.js`                 |
| `orchestrator.env` | `GH_ORCH_*` | outer **orchestrator** (reviews + merges) | `watch.js` (`--approve`) |

Each = a classic PAT (`repo` scope) on a Write-collaborator account; see the
`*.example` files. The identity flows through three points: API actor (`GH_TOKEN`),
commit author (`GIT_AUTHOR_*`), and HTTPS push (the `gh` credential helper).

### Linear (`lib/linear-status.js`)

Two optional, gitignored env files — each a **separate Linear OAuth app** with
Client credentials enabled. `linear-status.js --as fixer|orchestrator` mints an
app-actor token on demand, so issue comments show the bot app identity in Linear.
Cloud/systemd deployments may provide the same keys through the process env
(`EnvironmentFile=/etc/vimeflow/qa-runner/*.env`); those values override the
repo-root files so the daemon and worker do not depend on repo file permissions.

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
- The fixer works **only on the PR branch in an isolated worktree**; never `main`, never `--force`.
- **codex gate + bounded retry** before any commit.
- **author ≠ approver** — the fixer bot never merges its own work; the orchestrator does.
- Branch deletion on merge is a **remote API ref-delete**, not `gh --delete-branch`
  (whose local delete fails when a worktree holds the branch).
- Linear status via role-specific **app credentials**; never echo untrusted review
  text into a shell.
