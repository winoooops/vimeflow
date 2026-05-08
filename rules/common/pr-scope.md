# PR Scope Discipline

A PR's diff must answer one question: **"what does the spec / plan / issue
say to do?"** Anything that doesn't answer that question lives in a
separate PR — even a one-line fix, even an "obviously correct" formatter
reflow, even something `cargo fmt` did automatically.

The rule exists because a bloated PR forces every reviewer to mentally
split the diff into "the thing the PR is for" and "everything else", and
the second pile drowns out the signal in the first. Two tight PRs are
strictly cheaper than one large one — even when the two could in theory
be merged together — because the review cost grows faster than linearly
with diff size.

## The trap

When a PR sits open and you notice an unrelated improvement nearby
(formatting that's "wrong", a missing `tokio::spawn_blocking`, a stub
you could fill in, a comment that could be tighter), the cost of _not_
fixing it feels artificial — the file's already open, the test already
runs locally. So the change gets bundled.

The cost is real and someone else pays it. Resist the bundling instinct.
"I'm already here" is a signal to **write down** the second issue (in a
TODO, a `docs/decisions/`-flavored note, a follow-up issue, a comment in
the next planning doc), **not** to fix it in this PR.

## Pre-PR checklist

Run before pushing or before opening the PR:

1. **Re-read the spec / plan's Goal section.** Walk the diff. For each
   file, ask: _which spec line does this file's diff implement?_ If the
   answer is "none", the file should not be in this PR.
2. **`git diff --stat <base>...HEAD`.** Files appearing here that aren't
   in the plan's File-touch list need an explicit answer for _why_.
   Honest answers (KEEP):
   - "I had to update tests because the IPC type changed."
   - "I had to regenerate bindings because the Rust-side type moved."
   - "I had to update a downstream call site because the trait signature changed."

   Dishonest answers (STASH or DROP):
   - "rustfmt reflowed it" — drop or split into a `chore(fmt):` precursor.
   - "I'd been meaning to fix this" — open a follow-up.
   - "the seam felt wrong" — write an ADR or follow-up spec.
   - "I was already in the file" — open a follow-up.

3. **`git diff -w <base>...HEAD --stat`** alongside `git diff --stat`.
   Files where the whitespace-stripped count is much smaller than the
   regular count are nearly always pure-formatting drive-bys. Surface
   them and revert before pushing — or split them into a separate
   `chore(fmt):` commit/PR.
4. **Drive-by formatting is never the current PR's call.** If `cargo fmt`
   / `prettier` / `eslint --fix` produces unrelated reflows, run them in
   a separate `chore(fmt):` commit on `main` (or stash and discard). Do
   not bundle them with feature work.

## In scope vs. out of scope: a worked example

A PR titled "feat(agent): codex adapter stage 2" has spec
`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`. The
spec lists files under "File touch list". For a representative round of
that PR:

| File                                                        | In/Out | Why                                                               |
| ----------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `src-tauri/src/agent/adapter/codex/*.rs`                    | IN     | Net-new, listed in plan.                                          |
| `src-tauri/src/agent/types.rs`                              | IN     | `CostMetrics.total_cost_usd: Option<f64>` is the spec's IPC bump. |
| `src-tauri/src/agent/adapter/claude_code/statusline.rs`     | IN     | Required by the IPC bump (parser must update to wrap in `Some`).  |
| `src/bindings/CostMetrics.ts`                               | IN     | Generated artifact for the IPC bump.                              |
| `src/features/agent-status/components/BudgetMetrics.tsx`    | IN     | Frontend null handling for the IPC bump.                          |
| `src-tauri/src/git/mod.rs`                                  | OUT    | Rustfmt reflows in unrelated git command body.                    |
| `src-tauri/src/agent/detector.rs`                           | OUT    | Rustfmt-only changes; no logic delta.                             |
| `src-tauri/src/agent/adapter/claude_code/test_runners/*.rs` | OUT    | Import-order swap only.                                           |
| `src-tauri/tests/transcript_*.rs`                           | OUT    | Pure formatting reflows.                                          |

The OUT rows belong in a separate `chore(fmt):` commit on `main` or in
no commit at all (let some other PR pick up the formatting drift).

## When two PRs feels like overhead

It usually isn't. A 200-LOC PR that lands in 30 minutes plus a 200-LOC
follow-up that lands in another 30 is strictly better than a 400-LOC PR
where the reviewer takes 90 minutes to triage scope. The fixed cost of
opening a second PR is small (one branch, one description, one push);
the marginal review-cost saving is large.

If the two PRs genuinely depend on each other, stack them: open the
foundation PR first, then base the follow-up on its branch. This still
gives reviewers two focused diffs to read, and only the second one
blocks on the first.

## When a deviation is unavoidable

Sometimes a PR has to expand scope mid-flight — a spec rule turns out to
be wrong (e.g. a locked Non-Goal becomes blocking), or a correctness fix
in adjacent code is required for the planned change to function at all.

Two requirements when this happens:

1. **Document the deviation in the same PR**, in an ADR under
   `docs/decisions/<date>-<slug>-scope-expansion.md`. State the rule
   that was deviated from, the reason, the alternatives rejected, and
   any follow-ups. This converts the deviation from "silent scope creep"
   into "ratified scope expansion" — reviewers can engage with it
   explicitly.
2. **Update the spec or plan in the same PR** so future readers see the
   in-scope contract reflecting what shipped, with a cross-reference to
   the ADR.

A deviation without these two artifacts is scope creep regardless of
how necessary it felt at the time.

## Reviewer's perspective

When reviewing a PR, raise scope concerns first — before line-level
nits. A reviewer comment like "why is this file in this PR?" is more
valuable than a comment polishing one line of code that shouldn't have
been here in the first place.

If the author replies that the file is required (a downstream call site
forced to update because of a trait signature change, a test fixture
broken by an IPC bump), accept the explanation and move on. If the
reply is "rustfmt reformatted it" or "I noticed it was wrong", ask for
the change to be removed and split into a separate PR. The author may
push back; standing the reviewer-side rule helps make the discipline a
shared expectation rather than a per-PR negotiation.

## Why this lives in the rules tree, not in CLAUDE.md

Scope discipline is a development standard like immutability or test
coverage — it shapes every PR, not just the current one. Rules under
`rules/common/` are auto-loaded into every coding session in this repo,
which means agents working on a feature pick this up before they hit
the temptation to bundle. CLAUDE.md is for project-specific context;
this rule is process discipline that travels.

## References

- `rules/common/git-workflow.md` — commit format, squash merge, PR creation operational details.
- `rules/common/code-review.md` — review triggers and severity ordering. Scope discipline pairs with severity; a scope concern is HIGH-equivalent regardless of the line content.
- `docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md` — worked example of a scope deviation handled per the "When a deviation is unavoidable" section above.
