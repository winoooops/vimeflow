# IDEA Framework

A four-field shape for explaining a single judgment — paired with a finding, an option, or a decision. Forces the reasoning into the open without bloating the body.

## Purpose

Most write-ups conflate _what_ with _why_. IDEA splits them:

- The body says **what** — the finding, the option, the decision. Stays short.
- The IDEA block says **why** — intent, risk, rationale, trade-off. Carries the load.

This makes reviews and option-comparisons scannable: a reader can read just the bodies to know what's on the table, then drop into IDEA only for the items they want to push back on.

## The Four Fields

| Field                | Question it answers                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I — Intent**       | What was the author / proposer trying to accomplish here? Does the artifact match that intent?                                                                          |
| **D — Danger**       | What breaks, degrades, or stays unsolved if this ships as-is? Edge cases, security holes, UX traps, scope gaps.                                                         |
| **E — Explain**      | Why was this shape chosen? What trade-off or constraint produced it?                                                                                                    |
| **A — Alternatives** | Is there a meaningfully better shape? When would a senior reviewer push back? Only suggest when the alternative is genuinely superior — not for the sake of having one. |

Keep each line to one or two sentences. If a field has no real content, write "n/a" — don't pad.

## When to Use IDEA

Two contexts, same shape:

### Per-finding (code review)

Pair every code-review finding with its own IDEA block. The body states the issue, file, fix; IDEA carries the reasoning. See `agents/code-reviewer.md` for the review-specific format.

### Per-option (decisions, fix choices, design alternatives)

When presenting 2+ approaches to choose between (architectural choice, fix strategy, refactor path), give each option its own IDEA block. Adapted reading:

- **I — Intent**: what this option is trying to accomplish
- **D — Danger**: failure modes, downsides, scenarios it does NOT cover
- **E — Explain**: rationale / trade-off / why this shape makes sense
- **A — Alternatives**: comparison to the other options on the table — when you'd reach for one of them instead

End with a recommendation. The point of IDEA isn't to defer the call back to the reader — it's to make the call legible.

## Format

```
### [Option / Finding title]
[short body — 1-3 sentences saying what this is]

💡 IDEA
- I — Intent: ...
- D — Danger: ...
- E — Explain: ...
- A — Alternatives: ...
```

The 💡 marker signals "reasoning starts here" and lets readers visually skip past it when scanning.

## Real-world Example

Pulled from a real session (2026-04-25) — three options for fixing **issue #55** (Vite HMR reload destroys terminal sessions):

### Option A — Narrow Vite's watch list

Add `server.watch.ignored` for `.vimeflow/`, `target/`, `.codex*/`, `.git/` so machine-written files don't trigger HMR.

💡 IDEA

- I — Intent: cut the most common spurious-reload trigger (Claude Code writing status files into `.vimeflow/`).
- D — Danger: doesn't cover user-edited source files (`vim :w src/foo.tsx` still reloads); a malformed pattern could silently drop a file you _do_ want watched.
- E — Explain: 5-line config change, zero runtime risk — a patch, not a fix.
- A — Alternatives: weak as a standalone fix; pairs well with C as a noise-reducer.

### Option B — Suppress Vite's full-reload fallback in `tauri:dev`

Keep incremental HMR; when HMR can't apply, log a warning instead of triggering full reload.

💡 IDEA

- I — Intent: sever the "file change → full reload → terminals destroyed" chain at the source.
- D — Danger: developer must learn to manually refresh after non-HMR-able changes (e.g. `vite.config.ts`); any non-HMR-driven remount (error boundary reset, manual refresh, devtools) still wipes terminals — only treats the symptom.
- E — Explain: middle ground between A and C. Implemented as a Vite plugin intercepting `server.ws.send({ type: 'full-reload' })`. ~1-2 hours.
- A — Alternatives: worth it only if you reject C's complexity but want more than A's coverage. The "non-HMR remount" gap will eventually bite.

### Option C — Persist sessions + reattach to live PTYs

Frontend persists session metadata to `localStorage`; Rust adds `list_pty_sessions`; on mount, React asks the backend which PTYs are alive and reattaches to their data streams instead of spawning new ones.

💡 IDEA

- I — Intent: make page reload a harmless action — PTY processes already survive reload (they live in the Rust process), the frontend just lacks the ability to find them again.
- D — Danger: lose scrollback (PTY still running, but xterm is empty until next keystroke triggers redraw); `spawn_pty`'s current "kill-and-replace on session-id reuse" must change to a no-op or rejection; agent watcher and cwd state need restore paths too. ~3-4 hours including tests.
- E — Explain: architecturally correct fix. One investment covers _every_ reload scenario — HMR, manual refresh, error boundaries, future crash recovery. Aligns with the existing `PtyState` design (the `generation` counter and `clone_reader` were built with this in mind).
- A — Alternatives: A for short-term relief; C for closure. B is a half-measure with a known gap.

**Recommendation: A + C together.** A is 5 lines that immediately suppress the common noise; C is the actual fix that closes #55.

## Anti-patterns

- **Padding** — writing IDEA fields just to fill four slots. If "Alternatives" has nothing meaningfully better, write "n/a" and move on.
- **Repetition between body and IDEA** — if the body already says it, don't restate it in Intent. The body is the _what_, IDEA is the _why_.
- **PR-level IDEA blocks** — IDEA is per-thing (per finding, per option). Don't write one giant IDEA at the end of a multi-finding review.
- **IDEA on trivial calls** — if the choice is obvious (rename a variable, fix a typo), skip IDEA. It's a tool for judgments that benefit from being made legible.

## Integration

| Used by                    | Where                                                    |
| -------------------------- | -------------------------------------------------------- |
| `agents/code-reviewer.md`  | Per-finding IDEA in code reviews                         |
| Option-comparison messages | When proposing 2+ approaches before implementation       |
| Decision records           | When recording "we picked X over Y" in `docs/decisions/` |
