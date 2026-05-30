# Terminal Rendering Investigation Retrospective

> **Date:** 2026-05-27
> **Scope:** Three macOS terminal symptoms (prompt font misalignment, autocomplete cursor desync, "ghosting") traced to four independent root causes across three layers. Spans `fix/terminal-nerd-font-symbol-source` (1 commit) and `fix/terminal-pty-utf8-locale` (3 commits).
> **Outcome:** Font, locale, GPU-occlusion, and stale-row causes fixed and committed; backend UTF-8 chunk-split identified and deferred. The technical choices are recorded in [`docs/decisions/2026-05-27-terminal-rendering-fixes.md`](../../decisions/2026-05-27-terminal-rendering-fixes.md).

## TL;DR

Three terminal symptoms that _looked_ like one bug ("the terminal renders wrong") were four independent root causes:

| Symptom                                    | Root cause                                                                                      | Layer                  | Fix                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Prompt glyphs misaligned / pushed right    | Nerd Font glyph source varied by machine; installed face was non-Mono (wide advance)            | renderer font stack    | bundled `Vimeflow Nerd Symbols` + `unicode-range` (`76d1524`)                                            |
| Cursor flung right during line editing     | GUI-launched PTY inherits no `LANG`/`LC_*` → shell byte-counts multibyte glyphs in the C locale | Rust PTY spawn         | inject `LC_CTYPE` when no UTF-8 locale inherited (`717cc9a`)                                             |
| Garbled "alien" glyphs after window switch | Chromium reclaims occluded window's GPU resources → xterm glyph-texture cache corrupts          | Chromium GPU process   | `disable-backgrounding-occluded-windows` + `disable-renderer-backgrounding`, WebGL preserved (`f99742c`) |
| Duplicate / overlapping rows + stray `?`   | xterm's rAF render loop throttled while occluded; no repaint on focus/visibility return         | xterm render scheduler | force `refresh(0, rows-1)` on focus + visibilitychange (`f8a8577`)                                       |

The investigation's value was less in any single fix than in the **discipline that kept them separate** — and in recovering from the early days when that discipline was absent and wrong fixes shipped.

## What worked

### The `/goal` hard gate stopped the guess-and-ship spiral

The turning point was reframing the work as a `/goal` with one non-negotiable: **write no fix until Claude and an independent Codex analysis agree on the root cause.** Before the gate, fixes were shipped on hunches (texture-atlas clear, a Canvas2D swap, `backgroundThrottling`, a focus-repaint added _before_ the cause was understood) and each failed because it addressed a symptom, not a confirmed mechanism. After the gate, every fix was preceded by a confirmed-or-refuted hypothesis with evidence. The four-commit shape is a direct product of that gate: one commit per isolated, evidence-backed cause.

### Independent Codex RCA produced genuine consensus, not an echo

Running `codex exec -s read-only` on the symptom corpus _independently_ (no priming with Claude's hypotheses) converged on the same GPU-reclaim + rAF-throttle split and additionally surfaced the backend `from_utf8_lossy` chunk-split as a third contributor to the stray `?`. Two analyses reaching the same mechanism from different starting points is much stronger evidence than one analysis stated twice — and Codex caught a cause Claude had under-weighted.

### A diagnostic that is deliberately not the fix

`app.disableHardwareAcceleration()` made the alien-glyph corruption vanish, cleanly proving the GPU process was the cause. The discipline was recognizing this as a _diagnostic_, not a _fix_ — shipping it would have reversed the documented WebGL decision and regressed throughput app-wide. The real fix (two targeted occlusion switches) keeps WebGL and removes only the reclaim. Separating "what proves the cause" from "what we ship" was the cleanest move of the investigation.

### Reading the renderer's source beat guessing at its behavior

Cause 4 was confirmed by reading `@xterm/xterm@6.0.0`: the render path is `RenderDebouncer → requestAnimationFrame → refreshRows`, and xterm listens only for `pagehide`, never `visibilitychange`. That single source read explained every observation (renderer-agnostic, survives software rendering, "selection fixes it") and pointed straight at the fix surface (force a repaint on the events xterm ignores).

### Symptom triage by trigger, not by appearance

The breakthrough in untangling "ghosting" was noticing two artifacts with one trigger but different survival characteristics: the alien glyphs vanished under software rendering (GPU cause) while the duplicate rows survived it (rAF cause). Bucketing by "what makes it disappear" rather than "what it looks like" split one apparent bug into two causes.

## Friction points

### Shipping fixes before the root cause was understood

The first several days were a guess-and-ship loop — atlas clear, Canvas2D swap, `backgroundThrottling`, premature focus-repaint. The user's blunt feedback ("this is not a fix, I still see double line and duplicate rows everywhere") was the correct signal that the loop was producing motion, not progress. The lesson is the one `systematic-debugging` already encodes: a fix written before the mechanism is confirmed is a guess wearing a fix's clothes.

### Reversing a documented decision without checking the docs

The Canvas2D swap was made unilaterally. The user pushed back: _"I think WebGL will have better performance and is decided as the primary rendering engine in the previous decision @docs."_ They were right — `tauri-migration-roadmap.md:125` documents WebGL. The miss: not searching the docs for a prior decision before reversing the renderer. **Before changing an architectural default, grep the decisions/roadmap for whether it was already chosen on purpose.** This is the single most important takeaway for future contributors.

### CDP could not reproduce real OS window-occlusion

The GPU and rAF causes are triggered by the _OS_ occluding/backgrounding the window. CDP's `Emulation.setVisibilityState` self-recovers and dispatches a clean repaint; `disable-renderer-backgrounding` (already shipped for Cause 3) prevents the minimize-throttle; and OS-level occlusion isn't CDP-settable. So while the render loop and the fix's listeners were verified programmatically (synthetic `focus`/`visibilitychange` → `refresh` fires; renderer confirmed WebGL live), the final before/after under the _real_ window-switch needed a human at the machine. Some verification edges genuinely can't be automated, and pretending otherwise wastes cycles.

### Three branches for one investigation

The font fix landed on its own branch (`fix/terminal-nerd-font-symbol-source`) before the ghosting investigation began on `fix/terminal-pty-utf8-locale`. Correct in isolation (different layers, different review surfaces), but it means the shared docs (this retro + the decision) live with only one of the two PRs. Future multi-cause investigations should decide the branch/PR topology up front so the cross-cutting docs have an obvious home.

## What we'd do differently

1. **Gate fixes on confirmed mechanism from the start.** The `/goal` discipline should have been the _opening_ move, not the recovery move. `systematic-debugging` exists for exactly this; invoke it on the first "the terminal renders wrong," not after the third failed guess.
2. **Grep `docs/decisions/` + roadmap before reversing any default.** A 10-second search would have prevented the Canvas2D detour entirely.
3. **Triage by trigger and survival characteristics, not appearance.** "What makes it disappear?" split one bug into two causes faster than any amount of staring at screenshots.
4. **Decide branch/PR topology before splitting work across branches**, so cross-cutting docs (retro, decision record) have a single, obvious home.
5. **Name the un-automatable verification edge early.** Once it was clear CDP couldn't reproduce OS occlusion, the right move was to say so and hand that one check to the user — not to keep building CDP harnesses against a wall.

## Deferrals tracked

- **Backend UTF-8 chunk-boundary decode** (`crates/backend/src/terminal/commands.rs:772`). `String::from_utf8_lossy(&buf[..n])` can split a multibyte glyph across PTY reads and emit `U+FFFD` (`?`). Codex flagged it as a third contributor to the stray-`?` artifact. Fix is a carry-over decoder that holds the trailing incomplete bytes for the next read — unit-testable, no renderer interaction. Logged in the decision record's open-follow-up section.

## Pointers

- Decision record: [`docs/decisions/2026-05-27-terminal-rendering-fixes.md`](../../decisions/2026-05-27-terminal-rendering-fixes.md)
- Fix commits: `76d1524` (font), `717cc9a` (locale), `f99742c` (GPU occlusion), `f8a8577` (focus repaint)
- WebGL decision: `docs/roadmap/tauri-migration-roadmap.md:125`
- Upstream context: Claude Code issue [#20627](https://github.com/anthropics/claude-code/issues/20627)
- Skill that should have opened the work: `superpowers:systematic-debugging`
