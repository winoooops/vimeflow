# Terminal rendering: keep WebGL, fix the four real causes around it

**Date:** 2026-05-27
**Status:** Accepted (font + locale + GPU-occlusion + focus-repaint shipped; backend UTF-8 chunk-split deferred)
**Scope:** the xterm.js terminal pane (`src/features/terminal/components/TerminalPane/`), the Electron main process GPU flags (`electron/main.ts`), the renderer font stack (`src/index.css`, `terminalFont.ts`), and the Rust PTY spawn path (`crates/backend/src/terminal/commands.rs`). Lands across two branches: `fix/terminal-nerd-font-symbol-source` and `fix/terminal-pty-utf8-locale`.

## Context

Three user-visible symptoms surfaced over a week of macOS dogfooding, all in the xterm.js pane:

1. **Prompt font misalignment** — typed text in the Powerline (p10k) prompt rendered with "unseeable white spaces" and was pushed far to the right on the next line.
2. **Autocomplete cursor desync** — during line editing (zsh-autosuggestions / syntax highlight / completion redisplay), typed text was flung to the far right of the row.
3. **"Ghosting"** — duplicate/overlapping rows, garbled "alien" glyphs, and stray `?` characters in the Claude Code TUI running inside Vimeflow, triggered by switching to another window while an agent streamed output.

They looked like one bug ("the terminal renders wrong"). They were **four independent root causes** in three different layers — font sourcing, the PTY's locale, Chromium's GPU process, and xterm's render loop. The investigation's central risk was treating them as one and shipping a fix that masked one cause while leaving the others. A `/goal` hard gate (no fix until Claude **and** an independent Codex analysis agree on the root cause) was used to force per-cause isolation; the [retrospective](../superpowers/retros/2026-05-27-terminal-rendering-investigation.md) covers that process.

The one decision that needed protecting throughout: **the WebGL renderer is a documented choice** (`docs/roadmap/tauri-migration-roadmap.md:125` — "xterm.js performance with large agent output — use WebGL renderer"). Several tempting fixes would have quietly reversed it.

## Options considered (per cause)

### Cause 1 — prompt font misalignment

The installed `Hack Nerd Font` is a **non-Mono** variant (wider ink/advance than a single cell); the renderer's font stack also leaned on whatever Nerd Font happened to be installed on the machine, so glyph advances differed across machines.

1. **Require users to install a specific "Mono" Nerd Font** and document it.
2. **Switch the whole terminal to a single `... Mono` Nerd family** globally.
3. **Bundle a dedicated symbol face and scope it with CSS `unicode-range`** — the web equivalent of kitty's `symbol_map` / Ghostty's font-fallback ranges. Powerline + Nerd Font codepoints render from the bundled `Vimeflow Nerd Symbols` face; everything else renders from the text font.

### Cause 2 — autocomplete cursor desync

GUI launches (dock/Finder, `electron:dev`) inherit **no `LANG`/`LC_*`** — unlike Terminal.app / iTerm2, which set them — so the spawned shell runs in the **C locale** and byte-counts multibyte glyphs. zsh then measures each Powerline/Nerd glyph as ~3 cells, miscomputes line width, and desyncs the cursor.

1. **Set `LANG`** in the spawn environment.
2. **Set `LC_ALL`** (overrides everything).
3. **Set `LC_CTYPE` only**, and only when the inherited environment selects no UTF-8 locale.

### Cause 3 — ghosting, "alien" glyph corruption (severe)

Both the WebGL and Canvas renderers paint through Chromium's GPU process. When the window is occluded, Chromium backgrounds it and **reclaims its GPU resources**, scrambling xterm's cached glyph textures → garbage glyphs that persist until a repaint. Confirmed by `app.disableHardwareAcceleration()` making the corruption vanish (software rendering, no GPU process to reclaim).

1. **Swap WebGL → Canvas2D** as the primary renderer.
2. **Disable hardware acceleration globally** (`app.disableHardwareAcceleration()`).
3. **Clear the texture atlas** (`clearTextureAtlas()`) on occlusion.
4. **Keep hardware acceleration + WebGL, but stop the occlusion-driven reclaim** with `disable-backgrounding-occluded-windows` + `disable-renderer-backgrounding`.

### Cause 4 — ghosting, duplicate/overlapping rows (milder residual)

xterm renders on a debounced `requestAnimationFrame` loop (`RenderDebouncer` → `rAF` → `refreshRows`, verified in `@xterm/xterm@6.0.0` source) and listens only for `pagehide`, **not** `visibilitychange`. Chromium throttles rAF for occluded/backgrounded windows, so rows that streamed in while the user was away never flush — they stay stale until something forces a repaint (a text selection clears it, proving the buffer is correct and only the paint is stale). Renderer-agnostic: reproduces on WebGL, Canvas2D, and software rendering.

1. **Set `webPreferences.backgroundThrottling: false`** on the BrowserWindow.
2. **Disable Chromium's background timer throttling** globally.
3. **Force a full `refresh(0, rows-1)`** on `window` `focus` and on `document` `visibilitychange → visible`.

## Decision

| Cause                                | Chosen fix                                                                                                        | Commit / branch                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1 — font misalignment                | Bundle `Vimeflow Nerd Symbols`, scope it with `unicode-range` (Option 3); reorder the font stack to put it first  | `76d1524` on `fix/terminal-nerd-font-symbol-source` |
| 2 — cursor desync                    | Inject `LC_CTYPE` only when no UTF-8 locale is inherited — `en_US.UTF-8` on macOS, `C.UTF-8` elsewhere (Option 3) | `717cc9a` on `fix/terminal-pty-utf8-locale`         |
| 3 — GPU corruption                   | Keep WebGL + the two occlusion switches (Option 4)                                                                | `f99742c`                                           |
| 4 — stale rows                       | Force `refresh(0, rows-1)` on focus + visibilitychange (Option 3)                                                 | `f8a8577`                                           |
| (deferred) backend UTF-8 chunk-split | — not yet fixed —                                                                                                 | see Known risks                                     |

## Justification

1. **`unicode-range` is the same mechanism real terminals use.** kitty's `symbol_map`, Ghostty's font-fallback ranges, and Windows Terminal's font-fallback all map a codepoint range to a dedicated face. Bundling the face removes the cross-machine variance entirely — the glyph source no longer depends on what the user happened to `brew install`.
2. **`LC_CTYPE` is the minimal correct knob.** It governs character classification / width (the thing zsh gets wrong), while leaving the user's message and collation language (`LC_MESSAGES`, `LC_COLLATE`) untouched — which `LANG` or `LC_ALL` would clobber. Injecting only when nothing UTF-8 is inherited means a user with an explicit locale is never second-guessed. This mirrors what Terminal.app / iTerm2 do.
3. **The occlusion switches preserve the documented WebGL decision.** They keep hardware acceleration and the WebGL renderer (the choice made for large-agent-output throughput) while removing only the occlusion-driven GPU reclaim that corrupts the texture cache. The diagnostic that proved the cause — disabling hardware acceleration — is explicitly _not_ the fix, because it would reverse a documented decision and regress throughput.
4. **The focus-repaint is complementary, not redundant.** Cause 3's switches keep the window painting while it is _covered_; Cause 4's repaint flushes rows that went stale during the window-switch and only re-render on _return_. Because Cause 4 is renderer-agnostic and survives software rendering, it is not subsumed by the GPU fix — both are needed.
5. **Each cause was isolated before its fix was written.** The `/goal` gate (Claude + independent Codex consensus) refused any fix until the mechanism was confirmed with evidence. This is why the fixes are four atomic commits across two branches rather than one "terminal rendering" mega-commit — each is independently testable and revertable.

## Alternatives rejected

### Swap WebGL → Canvas2D (Cause 3, rejected)

Reverses a documented decision (`tauri-migration-roadmap.md:125`) and regresses large-output throughput. It also **does not fix the bug**: Canvas2D paints through the same GPU process, so it corrupts on occlusion exactly like WebGL. It was tried unilaterally during the investigation and reverted after the user flagged the documented decision — the single biggest process miss of the week (see retro).

### Disable hardware acceleration globally (Cause 3, rejected)

Makes the corruption vanish, which is why it's the perfect _diagnostic_. As a _fix_ it throws out GPU rendering for the entire app to solve a bug scoped to occluded-window glyph caches — a sledgehammer that regresses every GPU-accelerated surface, not just the terminal.

### `clearTextureAtlas()` on occlusion (Cause 3, rejected)

Refuted by evidence: the residual artifact is renderer-agnostic and survives software rendering, where there is no texture atlas to clear. Clearing the atlas treats a symptom of one cause and does nothing for the other.

### `webPreferences.backgroundThrottling: false` / global timer-throttle disable (Cause 4, rejected)

Broader blast radius than needed — disables throttling for _all_ timers/rAF on the window or app, including idle background work we _want_ throttled for battery. A targeted repaint on the two recovery events (focus, visibility) flushes the stale rows without keeping the whole rAF loop hot while the window is hidden. The occlusion switches from Cause 3 already keep the loop alive while _covered_; the repaint handles the _return_ edge specifically.

### Set `LANG` or `LC_ALL` (Cause 2, rejected)

`LANG` is the lowest-precedence locale var and would be overridden by any inherited `LC_*`; `LC_ALL` is the highest and would clobber a user's deliberate message/collation language. `LC_CTYPE` is the precise variable for character width and the right precedence tier.

## Known risks & mitigations

| Risk                                                                                                                                                                                                                  | Likelihood | Mitigation                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend `String::from_utf8_lossy(&buf[..n])` splits a multibyte glyph across PTY read boundaries → `U+FFFD` (`?`) injected into the stream (`commands.rs:772`)                                                        | Medium     | **Deferred, not fixed.** Identified during the investigation and corroborated by Codex as a third contributor to the stray-`?` artifact. Fix is a carry-over decoder that holds the trailing incomplete byte sequence until the next read. Tracked as the open follow-up below. |
| The two occlusion switches keep an occluded window's GPU resources resident — small VRAM cost while backgrounded                                                                                                      | Low        | Scoped to this app's single main window; the throughput/correctness win outweighs the idle VRAM. Revisit only if multi-window lands.                                                                                                                                            |
| `unicode-range` face must be bundled and loaded before first paint, or the first prompt flashes fallback glyphs                                                                                                       | Low        | Face is bundled with the app and declared in `src/index.css`; FOUT is cosmetic and one-frame.                                                                                                                                                                                   |
| CDP could not reproduce real OS window-occlusion (`setVisibilityState` self-recovers; `disable-renderer-backgrounding` prevents the minimize-throttle), so Cause 3/4 before-after was verified by hand, not automated | Low        | xterm render loop confirmed by source reading + synthetic `focus`/`visibilitychange` dispatch (`refresh` fires); the OS-occlusion edge is the one path that needs a human in the loop.                                                                                          |

## Open follow-up

- **Backend UTF-8 chunk-boundary decode** (`crates/backend/src/terminal/commands.rs:772`). Replace the per-read `from_utf8_lossy` with a decoder that carries the trailing incomplete byte sequence into the next read, so a glyph split across two PTY reads is decoded whole instead of emitting `U+FFFD`. Unit-testable in isolation; no renderer interaction.

## References

- WebGL renderer decision: `docs/roadmap/tauri-migration-roadmap.md:125`
- Investigation retrospective: [2026-05-27-terminal-rendering-investigation.md](../superpowers/retros/2026-05-27-terminal-rendering-investigation.md)
- xterm render loop: `@xterm/xterm@6.0.0` `RenderDebouncer` / `refreshRows`
- kitty `symbol_map`: <https://sw.kovidgoyal.net/kitty/conf/#opt-kitty.symbol_map>
- CSS `unicode-range`: <https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/unicode-range>
- Chromium occlusion switches: `disable-backgrounding-occluded-windows`, `disable-renderer-backgrounding`
- Related upstream report context: Claude Code issue [#20627](https://github.com/anthropics/claude-code/issues/20627)
