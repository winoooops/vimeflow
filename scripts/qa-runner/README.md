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
       WAITING / CI_RED → report only
                 │
                 ▼  per NEEDS_FIX PR, concurrently, each in its own worktree:
 ② run.js → kimi --afk (as the FIXER bot) · upsource-review skill  — poll → fix →
    CODEX GATE → commit → push → reply/resolve threads → repeat until clean.
                 │
                 ▼
 ③ Linear  — control plane / observability. Each state transition mirrors to the
    linked issue (a `VIM-N` in the PR body). The native GitHub↔Linear sync moves
    the issue → Done on merge; the watcher's own posts use the `linear.env` API key
    (headless ⇒ scoped API key, not interactive MCP — see
    rules/common/linear-workflow.md) and no-op gracefully when no key is set.
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

| State          | When                                                                    | Action (armed)                      |
| -------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| **NEEDS_FIX**  | unresolved review threads > 0, **or** Claude verdict "patch has issues" | `--execute` → `run.js <pr> --push`  |
| **CI_RED**     | a non-review CI check is failing                                        | report only (humans fix the build)  |
| **WAITING**    | CI/Claude still running · draft · not mergeable · no Claude review yet  | report only (poll again)            |
| **GOOD_SHAPE** | 0 threads · Claude ✅ · non-review CI green · `MERGEABLE`               | `--approve` → squash-merge + delete |

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

## Identity (`lib/bot-identity.js`)

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

## Guardrails

- **Opt-in only** (`auto-review` label) — narrow blast radius for the pilot.
- **Report-only by default** — `--execute` / `--approve` must be passed explicitly.
- **One run per PR** — lock files under `.locks/` (gitignored); concurrency capped at `--max` (2).
- kimi works **only on the PR branch in an isolated worktree**; never `main`, never `--force`.
- **codex gate + bounded retry** before any commit.
- **author ≠ approver** — the fixer bot never merges its own work; the orchestrator does.
- Branch deletion on merge is a **remote API ref-delete**, not `gh --delete-branch`
  (whose local delete fails when a worktree holds the branch).
- Linear status via the **scoped API key**; never echo untrusted review text into a shell.
