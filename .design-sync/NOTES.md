# design-sync notes

## Repo shape

- App repo, not a package: no library dist. The bundle entry is the hand-written `.design-sync/entry.ts` (re-exports the 18 shared primitives). Adding a new primitive = add it to `entry.ts` AND pin it in `config.json` `componentSrcMap` (explicit-entry mode takes the component list from the srcMap pins, not from src scanning).
- `package.json` `main` is `dist-electron/main.js` (Electron main process) — NEVER let the converter resolve the entry from package.json; `cfg.entry` must stay set.
- CSS source = the compiled app stylesheet: `buildCmd` runs `npx vite build` then copies `dist/assets/index-*.css` to the stable name `dist/assets/app-styles.css` **inside the same dir** so the hashed relative font urls keep resolving. Re-run buildCmd before any re-sync build when src/ changed (Tailwind v4 utilities are generated on demand from app source).
- Default theme tokens are STATIC in the compiled CSS (`@theme static` from `src/theme/theme.css`, Catppuccin/obsidian-lens defaults) — no provider needed for previews. Other Lens themes are runtime-applied by the theme service and are NOT in the sync.
- Guidelines = `docs/design/UNIFIED.md` + `DESIGN.md` via `guidelinesGlob` (the default glob had picked up `docs/CLAUDE.md`, which is repo navigation, not design guidance).

## Preview authoring recipe (The Lens is dark-first)

- The preview card chrome is white; every authored cell wraps its composition in a dark surface via INLINE STYLES with token vars (`background: 'var(--color-surface)'`, `color: 'var(--color-on-surface)'`, padding 24, radius 12). Do NOT use Tailwind utility classes in wrappers — utilities not used by app source are purged from the compiled CSS. `.material-symbols-outlined` IS safe (in app CSS).
- Previews import from `'vibm'` (externalized to `window.Vimeflow`).
- Realistic content domain: coding-agent control plane — sessions, agents (claude/kimi/codex), branches, diffs, files, terminal panes.

### Component-specific composition traps (from wave B)

- ProgressBar: default track is `bg-surface` — invisible on the surface wrapper. Use the app's TokenCache tint (`color-mix(in srgb, var(--color-outline-variant) 25%, transparent)`) and a fixed-width column (220–280px); the bar is `w-full`.
- SegmentedControl: `toolbar`/`toolbarInline` labels are `text-[0px]` — options MUST carry `icon`; `toolbarInline` track is `display: contents` (needs a flex parent — prefer plain `toolbar` in previews); `framed` cells are fixed 22×26 (pass `renderOption` mini-SVG like DockSwitcher); `sidebar` needs explicit `width: 202` + `fillActiveIcon`.
- Two Toggles exist: settings panes use a LOCAL `<Toggle on={...}>` in features/settings — the DS `Toggle` is the chip toggle (`label`/`value`/`onChange`) from the diff toolbar.
- IconButton wraps itself in Tooltip by default (`showTooltip: true`) — floating-ui, statically safe.
- IconButton/ToolbarButton share BaseButton's variant enum (`ghost|default|toolbar|primary|flat-primary|danger`, sizes `sm|md|lg`); IconButton defaults `ghost`, ToolbarButton `toolbar`; `pressed` → aria-pressed styling.

### Component-specific composition traps (from wave C)

- AgentGlyph: the agent registry (`AGENTS`, brandIcons) is NOT exported by `entry.ts` — previews construct Agent-shaped records inline (glyphs ∴ ◇ ☾ $ ◈; `--color-agent-*-accent(-dim)` vars are in the compiled CSS). Export the registry via entry.ts + componentSrcMap if real brand-mark previews are ever wanted. Also: the glyph-fallback branch ignores `size` (only the Icon branch honors it).
- Sheet groups: components under `src/components/sidebar/` capture as `sidebar__<Name>.png` and upload under `components/sidebar/<Name>/` (SidebarTabs); Sidebar itself grouped `general`. Trust the capture log / emitted dirs.
- ResizeHandle: invisible at rest by design — pair an idle split with an `isDragging` split in previews.
- GlassSurface: no live app usage (kept for future overlays); float it over a gradient + busy content or the blur reads as nothing; border/shadow are caller-owned.
- Sidebar: h-full/w-full — needs an explicit width/height wrapper; slots compose cleanly with sibling bundle exports (SidebarTabs, AgentGlyph).

### Overlay open-state recipes (from wave A)

- Popover: fully controlled (`anchor` + `open`) — capture the trigger via callback ref, `open={anchor !== null}`; surface minHeight ~260–300. `focus='dialog'` (default) focus-traps → first button shows a focus ring in shots (authentic).
- Menu / Dropdown: own their open state, no `defaultOpen` — a `ClickOnMount` helper (`querySelector('button')?.click()` after ~80ms) opens them. `Menu.Context` IS controlled (`open` + `position` inside a `position:relative` card).
- Tooltip: hover/focus only — `OpenOnMount` dispatches `mouseover`/`mouseenter` + `.focus()` with `delayMs={0}`; pass `showTooltip={false}` to IconButton triggers to avoid double tooltips.
- Dialog (reusable for ANY framer-motion entrance): captures photograph at opacity 0 because `networkidle` fires before the WAAPI spring runs. Fix lives in the PREVIEW .tsx (`useCapturePacing` on the always-mounted backdrop): a rAF pump calls `document.getAnimations().forEach(a => a.finish())` each frame, while `setInterval` fetches (`/styles.css?ds-settle=N`, uncacheable) hold networkidle open ~2s. Traps: NEVER gate on `Date.now()` (package-capture freezes it via `page.clock.setFixedTime` — use tick/frame counters); gate pacing to `?story=` pages only or the grid goto stalls. Verified NOT leaked into Dialog.prompt.md.

## Known render warns (triaged legitimate)

- `[TOKENS_MISSING]` 16 vars: `--rv-*` (measure, pad-inline, font-size, line-height) are runtime-set by components; `--outline-variant`, `--surface-container-high/low/lowest` (unprefixed, no `color-`) are referenced by app CSS with these spellings — pre-existing app quirk, previews verified rendering correctly despite it.
- `[RENDER_THIN] Dialog: variants render identically` — benign: dialogs are body-portaled `position:fixed` overlays, so in the full-card grid the last cell paints over the others and all three measure the same. Per-story captures (`?story=`) show each dialog distinctly; confirmed visually.
- Primary Button appears to have an "underline" in small screenshots — it's the variant's light→dark gradient bottom band (verified `text-decoration: none` in computed styles). Product truth, not a bug.

## Re-sync risks (watch-list for the next run)

- `dist/assets/app-styles.css` silently goes stale: it's a snapshot of the vite build. ALWAYS re-run `cfg.buildCmd` before the converter when any `src/` changed (new Tailwind utilities only exist after the app CSS rebuild).
- New shared primitives need BOTH `.design-sync/entry.ts` and `componentSrcMap` extended — explicit-entry mode discovers nothing automatically.
- AgentGlyph previews inline Agent-shaped records mirroring `src/agents/registry.ts` (glyphs ∴ ◇ ☾ $ ◈, accent vars) — they rot silently if the registry's glyphs/accents change.
- Sidebar/StatusBar/SegmentedControl previews recreate WorkspaceView/DockSwitcher compositions by hand — cosmetic drift possible when those features evolve.
- Dialog's preview `useCapturePacing` depends on capture-harness internals (`page.clock.setFixedTime` freezing `Date.now()`, `networkidle` gating) — a design-sync converter update may change these; if Dialog captures go opacity-0 or time out, re-read the pacing block in the preview.
- Verified with system node v22.17.0 (repo `.nvmrc` targets 24 for CI parity — no issues observed, but if esbuild/ts-morph act up, try node 24).
- Playwright + chromium live in `.ds-sync/node_modules` + `~/.cache/ms-playwright` — reinstall both on a fresh machine (`npm i` in `.ds-sync`, `npx playwright install chromium`).

## Environment history

- 2026-07-21 first sync: DesignSync auth needed Claude Code ≥ ~2.1.2xx (2.1.172's token grant lacked design scopes and its scope-exchange 400s; fixed by updating the CLI — no re-login was needed after the update).
- Target project: "Vimeflow Design System" (design-system type). The user's original "Vimeflow" project is a REGULAR claude.ai project (type immutable) — never sync into it.
- Playwright chromium installed to ~/.cache/ms-playwright via `.ds-sync` (playwright also npm-installed there).
