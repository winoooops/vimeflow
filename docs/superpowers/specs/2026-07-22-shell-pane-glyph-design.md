# Shell Pane Glyph — Design

**Status:** Approved by the user on 2026-07-22 (visual direction "C — solid tile" selected
from rendered mockups in the brainstorming visual companion).

## 1. Purpose

The shell pane is the only agent entry without a brand SVG: `AGENTS.shell` has
`Icon: undefined`, so `AgentGlyph` falls back to rendering the raw text character `$`.
That fallback is font-dependent and sits on a different baseline than the four SVG brand
marks (Claude Code, Codex, Kimi, OpenCode) inside the same tinted glyph chips.

Replace it with a universally recognized terminal mark — a filled rounded-square tile with
the `>_` prompt knocked out — drawn in the same flat, `currentColor` style as the other
brand icons.

## 2. The mark

A new `Shell` export in `src/agents/brandIcons.tsx`, built on the file's existing
`BrandSvg` wrapper: 24×24 viewBox, `fill="currentColor"`, `size` prop, spreads remaining
SVG props. `Shell` is square (1:1), unlike the non-uniformly scaled `ClaudeCode`.

The artwork is a single compound `<path>`; the wrapper's existing `fillRule="evenodd"`
knocks the prompt shapes out of the tile:

- Outer sub-path: rounded-square tile (3.4px corner radius on the 24px grid).
- Inner sub-paths: a chevron (`>`) and an underscore (`_`), the prompt from the approved
  mockup.

Pure fill, no strokes, no hardcoded colors. The tile inherits the shell accent
(`--color-agent-shell-accent`) from the chip's `color`, and the chip's `accentDim` tint
shows through the knocked-out prompt. The path data is copied from the approved mockup
(`.superpowers/brainstorm/96809-1784733564/content/shell-glyph.html`, `#sh-c`) and may be
fine-tuned during implementation; visual proportions are a dial, not a contract.

## 3. Registry wiring

In `src/agents/registry.ts`, set `Icon: Shell` on the shell entry.

`glyph: '$'` stays unchanged:

- It remains the text fallback inside `AgentGlyph` for any agent without an `Icon`.
- It is what the New Session dialog's CommandBoard renders — that dialog shows raw unicode
  glyphs for every agent (`∴ ◇ ☾ ◈ $`), an established separate style.
- `src/agents/registry.test.ts` pins `AGENTS.shell.glyph === '$'` and a length of 1.

## 4. Consumers

No changes. `AgentGlyph` renders `agent.Icon` when defined, so all three chip surfaces pick
up the mark automatically:

- Session tab chip (`src/features/sessions/components/Tab.tsx`)
- Terminal pane header chip (`src/features/terminal/components/TerminalPane/Header.tsx`)
- Agent status panel header chip (`src/features/agent-status/components/AgentStatusPanel/Header.tsx`)

No accent token, chip layout, or backend changes.

## 5. Tests

Written first (TDD):

- `src/agents/brandIcons.test.tsx`: add `Shell` to `BRAND_ICONS` and
  `SQUARE_BRAND_ICONS`, inheriting the existing `currentColor` and square-height
  assertions.
- `src/components/AgentGlyph.test.tsx`: the "falls back to the unicode glyph" test
  currently uses `AGENTS.shell`; re-point it to a synthetic agent object without an `Icon`
  (the fallback contract stays supported), and add an assertion that `AGENTS.shell` now
  renders an SVG.

## 6. Docs

Add one line to `src/agents/icons-NOTICE.md` noting the Shell mark is drawn in-house, not
vendored from Lobe Icons, so the attribution file stays accurate.

## 7. Non-goals

- No changes to the other four brand marks or their accent tokens.
- No changes to the New Session dialog's unicode-glyph style.
- No new glyph consumers; no chip layout changes.
