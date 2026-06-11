# Theme System — Design Spec

- **Date:** 2026-06-11
- **Status:** Draft for review
- **Scope:** Runtime color-scheme switching for the whole workspace (UI chrome, terminal, editor, agent accents, diff, scrollbars), with Obsidian Lens organized as the default theme and Flexoki as the hot-swap proof.

## 1. Context & Problem

Vimeflow's colors live in two diverged sources of truth plus roughly three
hundred hardcoded leaks:

- `tailwind.config.js` (legacy v3-style config, loaded through Tailwind v4's
  `@config` compatibility directive) defines semantic color tokens as hex.
- `docs/design/tokens.css` (imported globally by `src/index.css`) defines
  overlapping CSS custom properties — with **different values** for several
  tokens (Appendix A). Components using `bg-secondary-container` and
  `var(--secondary-container)` render different colors today.
- An initial audit plus a codex recount during spec review found ~290
  color-literal hits across ~58 source files (pre-filter) that bypass both
  sources. The table below is the categorized floor estimate; the
  authoritative Phase B checklist is regenerated mechanically (§6, step 0):

| Category                                     | Where                                                               | ~Count |
| -------------------------------------------- | ------------------------------------------------------------------- | ------ |
| xterm terminal theme                         | `src/features/terminal/theme/catppuccin-mocha.ts`                   | 21     |
| CodeMirror editor theme                      | `src/features/editor/theme/catppuccin.ts`                           | 15     |
| Agent accent identity                        | `src/agents/registry.ts`, `src/features/browser/browserIdentity.ts` | 20     |
| Arbitrary Tailwind values (`text-[#e2c7ff]`) | DockTab, DockPanel, DockSwitcher, ViewModeToggle, BrowserTabBar, … (26 files) | ~102   |
| Inline `style={{}}` rgba/hex                 | BurnerTerminalPopup, TokenCache, ActivityEvent, TerminalPane, …     | ~50    |
| Scrollbar + diff colors                      | `src/index.css`                                                     | 13     |
| Raw palette classes (`text-amber-400`)       | FileTreeNode, FileExplorer                                          | 6      |
| `white/[0.05]`-style glass washes            | 7 features                                                          | 27     |

The project runs **Tailwind v4.2.2**, whose native theming model (tokens
declared in `@theme` compile utilities to `var(--color-*)`) is exactly the
runtime-switching mechanism we need — and is currently bypassed by the legacy
config.

A theme switcher UI already exists as a non-functional mock:
`src/features/settings/components/panes/AppearancePane.tsx` renders
`BUILTIN_SCHEMES` (3 preview colors each) with local `useState`.

**Goal:** collect the current Obsidian Lens values into one organized,
complete theme definition; prove runtime hot-swap by switching to Flexoki
(light) with the exact same config shape; make it impossible to write new
hardcoded colors without a lint error.

## 2. Goals & Non-Goals

### Goals

1. One typed source of truth per theme; a theme missing any token fails
   `tsc`.
2. Runtime hot-switch with no app reload: terminals keep scrollback and
   sessions, the React tree does not remount.
3. Everything first-layer re-themes: UI surfaces/text/accents, terminal
   background/foreground/ANSI-16, CodeMirror chrome + syntax palette, agent
   accent identities, diff backgrounds, scrollbars.
4. Obsidian Lens (current rendered appearance) becomes the default theme,
   value-identical to what users see today.
5. Flexoki ships as the second theme — a light theme, so dark-only
   assumptions (white glass washes, dark-tuned shadows) must become tokens.
6. Lint guard: any new hardcoded color outside theme definition files is an
   ESLint/CI error.
7. Selected theme persists across restarts (`localStorage` for v1).

### Non-Goals (explicitly out of scope for v1)

- Accent-hue slider, density, and font switching (the AppearancePane mock
  controls stay inert).
- Community theme import/export UI (the serializable data model enables it
  later; the buttons stay inert).
- Editorial / Dense / W.W. Navigator mock schemes — the picker lists only
  real, complete themes (Obsidian Lens, Flexoki) until someone authors the
  others.
- Auto-following OS `prefers-color-scheme`.
- Migrating non-color tokens (fonts, radii, keyframes, fontSize) off the
  legacy `@config` — follow-up chore, not theme-blocking.

## 3. Architecture Decision

**TypeScript-first theme definitions + runtime CSS-variable application.**

Every theme is one typed TS object. A small `ThemeService` applies the
UI/effects/syntax/agent token groups as CSS custom properties on
`document.documentElement` and pushes the terminal group to xterm
subscribers. Tailwind declares the same token names once in `@theme` (with
Obsidian defaults) so utilities compile to `var(--color-*)`.

Rationale — xterm renders to `<canvas>` and cannot read CSS variables, so a
TS theme object must exist regardless; making it the single source avoids
institutionalizing a second (CSS) copy of every theme. `Record<Token,
string>` types make incomplete themes a compile error — the exact failure
mode (silent drift) that produced today's divergence. Serializable theme
objects also line up with the settings mock's "Import scheme…" affordance.

### Alternatives considered

- **CSS-first themes** (`@theme` + handwritten `[data-theme='x']` override
  blocks; TS holds only the terminal subset). Most idiomatic v4 and
  devtools-inspectable, but every theme splits across a CSS block and a TS
  palette with nothing checking the CSS side's completeness — the dual-source
  pattern that already bit this codebase. Rejected.
- **Minimal-diff compat** (keep `tailwind.config.js`, point its values at
  `var(--…)`, grow `[data-theme]` blocks in tokens.css). Smallest immediate
  diff, but perpetuates the legacy `@config` layer, non-v4 token naming, and
  the docs-vs-config duplication. Rejected.

## 4. Token Taxonomy & Data Model

```ts
// src/theme/types.ts
export interface ThemeDefinition {
  id: 'obsidian-lens' | 'flexoki' // widens as themes are added
  label: string
  kind: 'dark' | 'light' // drives color-scheme + native control styling
  ui: Record<UiToken, string> // ~45 after the token diet, + 5 vcs tokens
  effects: Record<EffectToken, string> // ~15 (see below)
  syntax: Record<SynToken, string> // 7: keyword/string/fn/variable/comment/type/tag
  terminal: TerminalTheme // existing shape from src/features/terminal
  agents: Record<AgentId, AgentAccent> // claude/codex/gemini/shell/browser
}
// AgentAccent = { accent, accentDim, accentSoft, onAccent }
```

Files: `src/theme/{types,service,useTheme,index}.ts`,
`src/theme/themes/{obsidian-lens,flexoki}.ts`, `src/theme/theme.css`
(`@theme` declarations, Obsidian defaults), `src/theme/base.css` (static
non-theme vars + global scrollbar/selection rules). `src/theme/` is a
cross-feature registry, sibling pattern to `src/agents/`.

### Token groups

| Group      | Contents                                                                                                                                                                                                       | Notes                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ui`       | surface ramp, primary/secondary/tertiary (+ `on-*`, `container`, `dim`), error/success/warning, outline ×2, browser chrome ×2, **new:** `vcs-modified/added/deleted/renamed/untracked`                         | replaces raw `text-amber-400` git-status classes                                          |
| `effects`  | glass fill, shadow colors (`pane-focus`, `modal`, ambient, glow), focus ring, selection, `scrollbar-thumb`/`-hover`, `diff-added/removed/highlight-added/highlight-removed`, **new:** `wash-faint/subtle/soft` | washes replace the 27 `white/[0.03–0.08]` overlays — white in dark themes, black in light |
| `syntax`   | 7 `syn-*` tokens                                                                                                                                                                                               | consumed by CodeMirror + MarkdownReadingView                                              |
| `terminal` | bg/fg/cursor/cursorAccent/selection + ANSI 16                                                                                                                                                                  | reuses the existing `TerminalTheme` type and `toXtermTheme()` helper                      |
| `agents`   | 5 identities × 4 fields                                                                                                                                                                                        | Claude mauve / Codex green / Gemini blue / Shell gold / Browser cyan become per-theme     |

### Naming convention

- Every **color** token emits as `--color-<name>` (one namespace; Tailwind
  v4 generates `bg-/text-/border-<name>` utilities from it). Agent and
  syntax colors follow the same rule: `--color-agent-claude-accent`,
  `--color-syn-keyword`.
- **Composite** (non-color) values emit under their own namespaces:
  `--shadow-pane-focus`, `--shadow-modal` (Tailwind `shadow-*` utilities).
- Refinement made while writing this spec: the previously discussed
  `--syn-*` / `--agent-*` namespaces are unified under `--color-*` to avoid
  dual namespaces. `MarkdownReadingView.css` (the only `--syn-*` consumer)
  migrates in the same change.

### Rules

1. **Token diet:** only tokens with ≥1 real consumer migrate. The Material 3
   leftovers in `tailwind.config.js` (`primary-fixed-dim`,
   `on-tertiary-fixed-variant`, `inverse-*`, …) are checked for usage and
   dropped when unused (the config's own comments already flag them for
   "step 10 cleanup"). Expected: ~60 UI tokens shrink to ~45.
2. **Conflict resolution — rendered truth wins:** where
   `tailwind.config.js` and `tokens.css` disagree (Appendix A), the Tailwind
   value is taken, because utilities dominate the visible UI. Exceptions
   require a UNIFIED.md citation.
3. **`docs/design/tokens.css` leaves the runtime.** `src/index.css` stops
   importing it; non-theme vars it carried (`--radius-*`, `--font-*`,
   layout, motion) move to `src/theme/base.css`. `docs/design/tokens.css` /
   `tokens.ts` get a "superseded — see src/theme/" banner and remain as
   design reference only.

## 5. ThemeService & Runtime Switching

```ts
// src/theme/service.ts — deep module, narrow interface
themeService.apply(id: ThemeId): void   // switch + persist
themeService.current(): ThemeDefinition
themeService.subscribe(fn): () => void  // for JS color consumers (xterm)
themeService.list(): ThemeDefinition[]  // for the settings picker
```

`apply()` does three synchronous things:

1. **Write CSS variables:** iterate `ui`/`effects`/`syntax`/`agents` →
   `documentElement.style.setProperty(...)`; set `data-theme="<id>"` and
   `color-scheme: dark|light` (native controls and default scrollbar
   corners follow). Inline element styles override the `@theme` defaults by
   specificity. The React tree does not re-render; every Tailwind utility
   and `var()` consumer repaints via the CSS engine.
2. **Notify subscribers:** the terminal feature registers one subscriber
   that assigns `toXtermTheme(theme.terminal)` to every live xterm
   instance's `options.theme` (a colors-only repaint: no reflow, scrollback
   preserved and recolored, PTY untouched). The exact hook point (terminal
   service vs. pane hook) is an implementation-plan decision.
3. **Persist:** `localStorage.setItem('vimeflow:theme', id)`. Unknown or
   missing stored ids fall back to `obsidian-lens`.

### Consumer integration matrix

| Consumer                                                       | Mechanism                                                                                                                                                                              | Switch-time work                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Tailwind utilities (99% of UI)                                 | compile to `var(--color-*)`                                                                                                                                                            | none — CSS engine repaints             |
| CodeMirror theme (`catppuccin.ts` → `src/theme`-aware rewrite) | DOM-rendered; theme extension references `var(--color-*)`; alpha composites use `color-mix(in srgb, var(--color-syn-keyword) 30%, transparent)`                                        | `Compartment` reconfigure flips the `{ dark }` base-theme facet when `kind` changes — `EditorView.darkTheme` selects light/dark base styles and CSS variables alone cannot flip it |
| xterm terminals                                                | canvas; holds concrete values                                                                                                                                                          | `subscribe` → reassign `options.theme` |
| Diff viewer (`<MultiFileDiff>` from `@pierre/diffs`)           | owns an independent Pierre theme state (`'pierre-dark'` in `DiffPanelContent.tsx`) synced through the diff worker pool — the `.diff-*` CSS classes alone do not re-theme it            | bridge maps `kind` → `pierre-dark` / `pierre-light` through the existing render-options pool sync; the toolbar theme dropdown becomes a session override that resets on workspace switch |
| Agent registry (`registry.ts`, `browserIdentity.ts`)           | color fields become `'var(--color-agent-…)'` strings; same object shape, consumers (inline styles, SVG) unchanged                                                                      | none                                   |
| React components needing theme data (settings picker)          | `useTheme()` via `useSyncExternalStore(service.subscribe, …)`                                                                                                                          | re-render on switch                    |
| Settings `AppearancePane`                                      | `useState` → `useTheme()`; card click → `themeService.apply(id)`; picker lists `themeService.list()`; preview swatches derive from each `ThemeDefinition` (accent/surface/text tokens) | —                                      |

**First paint:** `main.tsx` reads `localStorage` and calls `apply()` before
`createRoot().render()` — synchronous, pre-paint, so a Flexoki user never
flashes Obsidian. The `@theme` defaults cover only the interval before
module execution.

**Dev hot-tuning:** `src/theme/themes/*` accept Vite HMR; edits re-apply the
active theme live — serving the "tune Flexoki on screen" acceptance flow.

### Terminal boundary (what a theme can and cannot recolor)

Programs in the PTY emit color _indices_ (SGR sequences); the emulator owns
the index→RGB table. The theme therefore controls: default
background/foreground, ANSI 0–15, cursor, selection — identical semantics to
an iTerm2/Alacritty scheme switch. It does **not** control truecolor
(24-bit SGR) output — those exact RGB values are the program's own choice.
Indices 16–255 default to the standard xterm cube but _are_ themable via
`ITheme.extendedAnsi`; the current `TerminalTheme` type models ANSI 0–15
only, so `extendedAnsi` and `selectionInactiveBackground` are explicit v1
non-goals. Fonts, cell geometry, cursor shape are not theme members. Modern
CLIs that probe the terminal background (OSC 11) will see the new color on
their next probe and may adapt their own light/dark rendering.

## 6. Migration Strategy

Three phases, each independently verifiable and PR-sized
(`rules/common/pr-scope.md`).

### Phase A — Foundation (zero visual change)

1. Create `src/theme/` (types, service, hook, `obsidian-lens.ts` populated
   per the conflict rule, `theme.css`, `base.css`).
2. Tailwind cutover: `@theme` block declares all color/shadow tokens with
   Obsidian values; delete `colors` (and color-bearing `boxShadow`) from
   `tailwind.config.js`; `index.css` drops the `docs/design/tokens.css`
   import — preceded by a repo-wide `var(--` inventory so no consumer is
   orphaned. Known today: `StatusBar.tsx` (`--outline-variant`, `--success`,
   plus non-color `--status-bar-h`, `--radius-sm`, `--ring-primary`) and
   `MarkdownReadingView.css` (`--syn-*`). Color vars migrate to `--color-*`
   names; required non-color vars move into `base.css`.
3. Wire `main.tsx` pre-render apply, the terminal subscription, the diff
   Pierre-theme bridge, and the AppearancePane switch (kept to a minimal
   diff — the settings dialog evolves on its own branch).

Exit criterion: switching works end-to-end with one theme; the app renders
pixel-identical to today.

### Phase B — Leak migration (mechanical inventory is the work list)

Step 0 regenerates the leak inventory with a script (grep for hex / color
functions / raw palette classes / washes over `src/`); that output — not the
estimate table in §1 — is the batch checklist.

| Batch | Content                               | Replacement rule                                                                                                                                                       |
| ----- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `index.css` scrollbars + diff classes | `#333344` → `var(--color-scrollbar-thumb)` etc.; **scrollbar styling globalized — see below**                                                                          |
| 2     | xterm theme file                      | `catppuccin-mocha.ts` content becomes `obsidian-lens.terminal`; file deleted                                                                                           |
| 3     | CodeMirror theme                      | hex → `var(--color-*)`; alpha-suffix hex (`${mauve}4d`) → `color-mix()`                                                                                                |
| 4     | agent registries ×2                   | hex → `'var(--color-agent-*)'` strings                                                                                                                                 |
| 5     | ~102 arbitrary Tailwind values        | mapping table (Appendix B): `text-[#e2c7ff]` → `text-primary`; `bg-[rgba(203,166,247,0.15)]` → `bg-primary-container/15` (v4 resolves var-based alpha via `color-mix`) |
| 6     | ~50 inline styles                     | same mapping → `var()` or semantic classes                                                                                                                             |
| 7     | git-status palette classes            | → `text-vcs-modified` etc.                                                                                                                                             |
| 8     | 27 `white/[0.0x]` washes              | → `bg-wash-faint/subtle/soft`                                                                                                                                          |
| 9     | tests asserting old sources           | `registry.test.ts`, `browserIdentity.test.ts`, `WorkspaceView.visual.test.tsx`, `sections.test.ts` re-assert against theme definitions / `themeService.list()`        |

Batch acceptance: `npm run type-check && npm run lint && npm run test`, plus
on-screen smoke in both themes once Flexoki exists.

#### Scrollbar globalization (batch 1, design change)

Today `@utility thin-scrollbar` must be manually applied per scroll
container, and the same rules are hand-copied for `.xterm-viewport` and
`.cm-scroller` (the `::-webkit-scrollbar` pseudo only targets the element
carrying the class, not descendants). This is an opt-in convention that
agents keep forgetting. Inversion — style scrollbars globally in
`base.css`:

```css
@layer base {
  /* Firefox-only standard properties; keep the existing WebKitGTK
     double-track gate (see current index.css comment) */
  @supports (-moz-appearance: none) {
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--color-scrollbar-thumb) transparent;
    }
  }
  *::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  *::-webkit-scrollbar-track {
    background: transparent;
  }
  *::-webkit-scrollbar-thumb {
    background: var(--color-scrollbar-thumb);
    border-radius: 10px;
  }
  *::-webkit-scrollbar-thumb:hover {
    background: var(--color-scrollbar-thumb-hover);
  }
}
```

Every current and future scroll container — including xterm's viewport and
CodeMirror's scroller — is styled and theme-aware by default. The
`thin-scrollbar` utility and both hand-copied blocks are deleted;
`no-scrollbar` remains the only opt-out. Rationale:
`rules/common/design-philosophy.md` — error prevention over per-call-site
convention.

### Phase C — Flexoki + enforcement

1. Author `flexoki.ts` from the official palette (Appendix C), `kind:
'light'`.
2. On-screen contrast pass across terminal, editor, diff, dock, settings.
3. Turn on the hardcoded-color guards (below) at `error` severity — last,
   so CI stays green throughout the migration.
4. Docs: superseded banners on `docs/design/tokens.{css,ts}`; pointer
   updates in `CLAUDE.md` design read-order and `docs/design/CLAUDE.md`;
   `CHANGELOG.md` / `CHANGELOG.zh-CN.md` entries.

## 7. Hardcoded-Color Guards

1. **ESLint custom rule** (`vimeflow/no-hardcoded-colors`, inline local
   plugin in the flat config — no new dependency). Scans string literals and
   template literals in `.ts`/`.tsx` for `#hex` (3/4/6/8), `rgb(`/`rgba(`,
   `hsl(`/`hsla(`, `oklch(`, **and** for class strings using raw Tailwind
   palette colors (`text-amber-400`, `bg-zinc-800`, …) or `white`/`black`
   utilities incl. alpha forms (`white/[0.05]`, `border-white/10`) — the
   exact categories the migration removes. Semantic-token classes
   (`text-on-surface`, `bg-primary`) don't match the banned patterns.
   Exemption: `src/theme/themes/**` (the one legitimate home). Rare legitimate literals elsewhere (e.g. a test
   asserting a concrete hex) use `eslint-disable-next-line` with a reason —
   visible in review. Severity `error`, matching the `no-console: error`
   posture.
2. **CSS guard test** (vitest). ESLint doesn't parse CSS and adding
   stylelint for three CSS files is overweight; a co-located test globs
   `src/**/*.css`, excludes `src/theme/`, and asserts no color-literal
   patterns. Runs in the existing vitest pipeline (pre-push + CI).

Both guards land in Phase C after the migration zeroes existing violations.

## 8. Testing Strategy

TDD per `rules/typescript/testing/` (vitest, `test()`, co-located files).

1. **Types as tests:** `Record<Token, string>` makes incomplete themes a
   compile error — no runtime assertion needed.
2. **`@theme` sync test:** parse `theme.css`'s `@theme` block; assert the
   variable-name set and default values match `obsidian-lens.ts` exactly —
   kills the one double-write point in this design.
3. **Service unit tests:** after `apply()`, `documentElement` carries the
   expected custom properties, `data-theme`, `color-scheme`; subscribers are
   notified; `localStorage` written; unknown stored id falls back to
   default. All jsdom-supported.
4. **Consumer wiring tests:** xterm — mock instances, switching reassigns
   `options.theme` to `toXtermTheme(next.terminal)`; CodeMirror — a `kind`
   change reconfigures the `dark` facet through the `Compartment`; diff —
   the bridge maps `kind` to `pierre-dark`/`pierre-light` and routes it
   through the worker-pool render-options sync.
5. **Guard tests:** the ESLint rule gets RuleTester coverage (flags hex /
   rgba / template literals / raw palette classes / `white`-alpha washes;
   passes `var()`, `color-mix()`, and semantic-token classes; respects the
   themes-dir exemption); the CSS guard test is itself the assertion.
6. **Acceptance (manual, end of Phase C):** run the app; hot-swap Obsidian
   ⇄ Flexoki; verify terminal (scrollback recolors, session uninterrupted),
   editor + syntax, agent accents, diff, scrollbars, settings preview — the
   original "test hot reload on Flexoki" criterion.

## 9. Risks & Mitigations

| Risk                                                                         | Mitigation                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Light-theme contrast surprises (glass, shadows, washes tuned for dark)       | washes/shadows/glass are per-theme tokens; dedicated contrast pass in Phase C                                      |
| Settings-dialog branch collision (`AppearancePane` is WIP on another branch) | theme work exposes `useTheme`/`themeService` API; AppearancePane diff kept minimal (state-hook swap + list source) |
| `@theme` defaults vs. `obsidian-lens.ts` drift                               | sync test (§8.2)                                                                                                   |
| Missed leak keeps a surface dark on Flexoki                                  | guards catch new code; the Phase C visual pass catches stragglers; the audit table is the checklist                |
| Truecolor TUI output ignores the theme                                       | documented boundary (§5); identical to every terminal emulator                                                     |
| Diff content colors come from Pierre's built-in themes, not our tokens      | bridge picks the nearest Pierre theme per `kind`; Phase C visual pass validates; custom Pierre theme is a follow-up |
| Legacy `@config` still carries non-color tokens                              | explicit non-goal; follow-up chore ticket                                                                          |

## Appendix A — Known source-of-truth divergences

Resolution rule: Tailwind value wins (rendered truth); token dropped instead
if it has zero consumers.

| Token                 | `tailwind.config.js` | `docs/design/tokens.css` |
| --------------------- | -------------------- | ------------------------ |
| `secondary-container` | `#124988`            | `#57377f`                |
| `on-primary`          | `#3f1e66`            | `#2a1646`                |
| `surface-tint`        | `#d9b9ff`            | `#e2c7ff`                |

Additionally, each file carries tokens the other lacks (tokens.css omits
most `fixed`/`inverse` variants; the config gained `on-surface-muted` and
`warning` only via the handoff additive block) — the typed token set ends
this class of drift.

## Appendix B — Hex → token mapping (representative; full table derived mechanically during Phase B)

| Hardcoded value                          | Token                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `#e2c7ff`                                | `primary`                                                              |
| `#cba6f7`                                | `primary-container`                                                    |
| `#8a8299`                                | `on-surface-muted`                                                     |
| `#6c7086`                                | `syn-comment`                                                          |
| `#0d0d1c`                                | `surface-container-lowest`                                             |
| `#121221`                                | `surface`                                                              |
| `#333344`                                | `scrollbar-thumb` (in scrollbar context) / `surface-container-highest` |
| `#4a444f`                                | `outline-variant`                                                      |
| `rgba(203,166,247,α)`                    | `primary-container/α`                                                  |
| `rgba(74,68,79,α)`                       | `outline-variant/α`                                                    |
| `rgba(13,13,28,α)`                       | `surface-container-lowest/α`                                           |
| `rgba(166,227,161,0.15/0.35)`            | `diff-added` / `diff-highlight-added`                                  |
| `rgba(243,139,168,0.15/0.35)`            | `diff-removed` / `diff-highlight-removed`                              |
| `#4fc8d6` (+ dims)                       | `agent-browser-accent` family                                          |
| `#f0c674` (+ dims)                       | `agent-shell-accent` family                                            |
| `text-amber/emerald/red/cyan/purple-400` | `vcs-modified/added/deleted/renamed/untracked`                         |
| `white/[0.03–0.08]`                      | `wash-faint` / `wash-subtle` / `wash-soft`                             |
| `rgba(0,0,0,α)` shadows                  | `--shadow-*` composites                                                |

Values with no semantic match get a real token rather than a lookalike.

## Appendix C — Flexoki sourcing

Official Flexoki palette (Steph Ango). Mapping rules — exact per-token
values are authored in `flexoki.ts` during Phase C with an on-screen
contrast pass:

- **Surfaces:** paper `#FFFCF0` (base), `base-50 #F2F0E5` / `base-100
#E6E4D9` / `base-150 #DAD8CE` for the container ramp (light themes invert
  the "higher container = lighter" rule to "higher = darker").
- **Text:** `base-850 #343331` (matches the existing mock's text value) /
  `base-800` / `base-600` for the on-surface ramp.
- **Accent:** purple family — `purple-600 #5E409D` primary range, per the
  mock's `#6e4caa` intent.
- **Terminal ANSI:** normal 0–7 from the 600-intensity hues (red `#AF3029`,
  orange `#BC5215`, yellow `#AD8301`, green `#66800B`, cyan `#24837B`, blue
  `#205EA6`, purple `#5E409D`, magenta `#A02F6F`); bright 8–15 from the
  400 intensities (`#D14D41`, `#DA702C`, `#D0A215`, `#879A39`, `#3AA99F`,
  `#4385BE`, `#8B7EC8`, `#CE5D97`).
- **Syntax / agents:** drawn from the same hue table at the intensity that
  passes contrast on paper.
- `kind: 'light'` → `color-scheme: light`, black-based washes, light-tuned
  shadows.
