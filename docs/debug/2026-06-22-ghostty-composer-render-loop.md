# Ghostty composer-render debug loop (VIM-208/214/216 family)

**Status:** in progress · **Started:** 2026-06-22 · **Branch:** `verify/ghostty-m5`

A suspect → observation → cause-analysis → verdict loop for the "gray area incorrect"
rendering bug in the Ghostty native terminal render path. Each hypothesis is tracked
with its observation and verdict so the deduction is auditable; this doc feeds a final
HTML report once the fix lands.

## The bug (light mode makes it visible)

A coding-agent TUI (OpenAI Codex CLI) runs in a PTY rendered by a custom "Ghostty
native" path: `@coder/libghostty-vt-node` parses PTY bytes → `snapshot()` +
`formatHtml()` → a custom DOM surface (`terminalTextSurface.ts`). Codex draws its
input composer as a full-width background bar tinted from the terminal's reported
`OSC 11` background. **Symptom:** the bar's gray area is wrong — it appears to extend
onto the status/model line (`gpt-5.5 xhigh · …`) and/or is mis-colored. It looks
right for a split second on startup, then breaks once Codex's "Starting MCP servers…"
redraw settles. Only clearly visible in **light mode** (dark-on-dark hid it).

Key wrinkle: a headless harness replaying a captured Codex session shows the status
row CLEAN with the current fixes, yet the LIVE app still shows the bleed → the live
state differs from the captured one (Codex actively responding, long status line).

## Success criteria (proof = light-mode screenshots)

1. Codex renders the input area correctly (bar exactly wraps the composer; status line not shaded wrongly).
2. `/resume` of a previous session does not break the input area.
3. On exiting Codex, the shell starship/powerline color blocks render correctly.

## Fixes already landed on `verify/ghostty-m5`

| Commit     | Fix                                                                   |
| ---------- | --------------------------------------------------------------------- |
| `c4b04f9e` | Answer Codex `OSC 10/11` color queries → composer bar renders         |
| `6b3f76e9` | Honor synchronized output (DEC 2026) → no torn mid-frame              |
| `837afbc6` | rAF render coalescing → drop transient redraw frames                  |
| `ec9b951f` | Fixed-cell geometry (`width` not `min-width`) + 1-cell cursor overlay |
| `f906f334` | Align bg-synthesis rows with formatHtml wrapper + leading-blank trim  |

Despite these, the gray area is STILL wrong in the live app (light mode) → more causes remain.

## Observation tooling

- **Headless render harness** (jsdom): replay captured PTY chunks through the real
  bridge + model + surface, dump per-row text / bg-run widths. Cols MUST match
  (capture == bridge == surface) or full-width bg soft-wraps into artifacts.
- **Ground-truth dump**: feed chunks to a standalone libghostty terminal; dump
  `formatHtml()` bg lines + `snapshot().cells` bg-by-row to localize bridge vs render.
- **Captures**: `/tmp/codex-chunks.json` (codex), `/tmp/shell-chunks.json` (shell).

## Suspect list

A research workflow (ghostty/libghostty, codex CLI, general TUI, our codebase) runs in
parallel; its ranked suspects get appended here. The codebase + live-capture observations below
already resolved the headline question, so research now mainly serves to find any _additional_
causes for `/resume` and shell-exit.

## Hypothesis loop

Observation tooling: a node harness drives the **real** bridge (`GhosttyRenderStateMainBridge` +
real libghostty + real `formatHtml`/`normalizeSnapshot`) over a captured codex PTY session and
dumps the normalized snapshot's bg cells per row. Captures made with a Python `pty.fork` that
answers OSC 10/11 with the chosen theme's fg/bg.

| #   | Hypothesis                                                                                                                                         | Observation                                                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                             | Verdict                  | Deduction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | After fixes 1–6 + the F3/F4 reconcile, a **fresh** codex composer renders correctly                                                                | Drive real bridge over fresh light + fresh dark captures; dump bg-by-row                                                                          | Light: bar rows 11–13 `#f4f1e6`, composer row 12, status (`gpt-5.5`) **no bg**. Dark: bar rows 11–13 `#393947`, status no bg                                                                                                                                                                                                                                                       | ✅ **CONFIRMED CORRECT** | The render path is NOT the bug for fresh sessions. Composer bar is exactly 3 rows; status line is never shaded. Criterion 1 holds.                                                                                                                                                                                                                                                                                                                                                                                                            |
| H2  | The light-mode "gray area incorrect" (Image #32) = **theme-switch staleness** (codex cached the dark OSC 11 bg, never re-queried after dark→light) | Capture codex started DARK; at t=10s answer LIGHT + send SIGWINCH; count codex's OSC re-queries; harness the bar bg                               | Codex emits OSC 10/11 **only at startup** (8 queries in first 0.24s); **0** re-queries after the switch/SIGWINCH. Bar stays `#393947` (dark) on the now-light bg                                                                                                                                                                                                                   | ✅ **CONFIRMED**         | Codex caches the bg→bar tint at startup and never re-queries. After a theme switch its bar is stale. This is a **codex limitation**, not an app render bug — our surface faithfully renders codex's (stale) explicit cell bg.                                                                                                                                                                                                                                                                                                                 |
| H3  | A resize-nudge on theme change would make codex re-query OSC 11 → re-tint                                                                          | SIGWINCH (shrink 1 col + restore) sent post-switch in H2                                                                                          | 0 re-queries followed the SIGWINCH                                                                                                                                                                                                                                                                                                                                                 | ❌ **REJECTED**          | Codex does not re-query colors on resize. Resize-nudge cannot fix theme-switch staleness.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| H4  | The real live bleed (codex **with history** / `/resume`) = **formatHtml↔snapshot row mismatch from scrollback**                                    | `gt-align`/`gt-anchor`: dump formatHtml content-row count vs snapshot bg rows for fresh vs resume captures; replay resume through the real bridge | Ground truth: snapshot bg only on visible composer rows (24,25,26), but `formatHtml` emits **146** content rows (full scrollback incl. old dimmed `›` prompts at `opacity:0.5`) vs snapshot's **30** visible. The old fixed wrapper/leading offset mapped scrollback bg rows (11, 22) onto visible history rows → bleed. Fresh-idle captures (no scrollback) were clean, hiding it | ✅ **CONFIRMED + FIXED** | `formatHtml` carries scrollback+viewport (blank leading/trailing trimmed); the snapshot is viewport-only. No fixed offset can align them (offset = scrollback height: 0 fresh, −1 shell, **118** on /resume). **Fix:** anchor formatHtml's last content row to the snapshot's last non-blank row, shift all ranges by that delta, drop rows outside the viewport. Verified across all 5 captures + a mutation-checked regression test. This is the root cause of the live Image #32 "status bleed" (codex was mid-response → had scrollback). |

### Fix landed (this loop)

`fix(terminal): anchor Ghostty bg synthesis to the visible viewport (drop scrollback)` — replaces
the wrapper+leading-empty offset in `normalizeSnapshot` with a last-non-blank-row anchor +
viewport clamp. Verified on fresh light/dark, `/resume` (scrollback), shell powerline, and the
theme-switch capture; new mutation-checked regression test
`anchors the bar to the visible viewport and drops scrollback bg rows`.

### Verification status vs the 3 success criteria

1. **Codex input area correct** — ✅ confirmed through the real bridge for fresh sessions (light `#f4f1e6` / dark `#393947`, status clean) AND for codex-with-history after the H4 fix (resume: bar on 24,25,26, scrollback + status clean). Live light-mode screenshot pending.
2. **`/resume` does not break the input** — ✅ confirmed via the resume capture through the real bridge (composer row 25, status row 27 clean, scrollback history rows clean). Live screenshot pending.
3. **Shell starship blocks on codex exit** — ✅ confirmed: all 6 powerline segment colors render on the prompt row, no bleed. Live screenshot pending.

**Separate finding (codex limitation, not an app render bug):** switching theme mid-codex-session
leaves a stale bar color (codex caches OSC 11 at startup, never re-queries — H2/H3). Recommend
documenting "restart codex after a theme switch"; a fresh session in either theme is correct.

### Implications for the fix

- **Criterion 1 (codex input correct):** already met for fresh sessions in both themes — proven
  through the real bridge. Remaining work is to capture a live light-mode screenshot as proof.
- **Theme-switch staleness:** not cleanly fixable from the terminal side (codex never re-queries).
  Options: (a) accept + document ("restart codex after switching theme to refresh its bar color");
  (b) on theme change, kill+`/resume` codex automatically (heavy, loses TUI scroll state);
  (c) app-side remap of the stale bar bg (fragile — we can't reliably identify it). Recommend (a).

## Open questions (remaining)

- `/resume` (criterion 2): does the composer render correctly after codex replays a long history? (capture + harness pending)
- shell-exit starship/powerline blocks (criterion 3): correct after codex exits? (capture + harness pending)
