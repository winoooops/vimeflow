# Button Primitives Design — `Button` / `IconButton` / `ToolbarButton`

**Status:** Draft (codex review pending)
**Linear:** [VIM-124](https://linear.app/vimeflow/issue/VIM-124) (child of the VIM-116 unified-component epic; third extraction after VIM-117 Tooltip + VIM-119 floating surfaces)

**Goal:** Replace ~40 hand-rolled icon/toolbar buttons (10 distinct stylings, no shared primitive) with one button family — a package-private `base/button` substrate plus three public primitives — so button chrome, sizing, focus, disabled, and ARIA are defined once and composed everywhere.

**Architecture:** A hidden `src/components/base/button` substrate (`buttonVariants` + `BaseButton`) owns the element contract and the size × variant → className mapping; public `Button` / `IconButton` / `ToolbarButton` compose it. This mirrors how VIM-119's `base/floating` substrate (`useFloatingSurface` + `SurfacePanel`) underlies the public `Dropdown` / `Menu` / `Popover`. The `base/**` package-private boundary (ESLint Ring 2) already fences the substrate; a new custom rule (`vimeflow/no-raw-icon-button`) ratchets out hand-rolled icon buttons.

**Tech stack:** React + TypeScript, Tailwind (semantic theme tokens), Material Symbols, Vitest + Testing Library, ESLint flat config (custom rule).

---

## 1. Problem

A survey of `src/` (2026-06-14) found **~40 icon/toolbar buttons across 10 distinct hand-rolled stylings**, with **no `Button` primitive in `src/components/`**. Drift spans every axis:

- **Size** — `h-[22px]`, `h-6` (24), `h-[26px]`, `h-[27px]`, `h-7` (28), `h-8` (32), each hard-coded per call site.
- **Radius** — `rounded`, `rounded-md`, `rounded-[5px]`, `rounded-[7px]`, `rounded-lg`, `rounded-full` all in use.
- **Hover** — `hover:bg-surface-container-high`, `hover:bg-surface-container-highest/80`, `hover:bg-wash-subtle`, `hover:bg-primary/[0.08]` — four+ strategies.
- **Layout** — `grid place-items-center` vs `inline-flex items-center justify-center` vs `flex`.
- **Icon size** — `text-base`, `text-[13px]`, `text-[17px]`, `text-[10px]`, `text-[19px]`.
- **a11y gaps** — disabled-state styling has ≈0% coverage; focus-visible rings are sparse and inconsistent; only `BrowserToolbar` models disabled nav buttons.

The repeated shape underneath all of them is identical:

```tsx
<button className="[layout] [size] rounded-[r] [variant-color] hover:[hover] transition-colors [focus]">
  <span className="material-symbols-outlined [icon-size]" aria-hidden="true">{icon}</span>
</button>
```

Every theme/a11y/motion change today means editing N files. One shared family collapses that to one.

## 2. Goals & non-goals

**Goals**

1. A package-private `base/button` substrate that owns the `<button>` element contract (type, focus-visible, disabled, ref-forward, className merge) and the canonical size × variant → className map.
2. Three public primitives: `Button` (text / primary foundation), `IconButton` (icon-only, required accessible name), `ToolbarButton` (icon + label pill).
3. Migrate every **standalone** icon button, toolbar pill, and single toggle button to the new family.
4. A guardrail — `vimeflow/no-raw-icon-button` — that fails lint on a raw `<button>` wrapping a `material-symbols-outlined` span outside `src/components/`, ratcheted from a frozen grandfather count down to 0.
5. Converge the drifting sizes (5 → `sm` / `md` / `lg`) and radii (5 → one canonical per shape) — an intentional visual convergence verified in-browser per migration.

**Non-goals (explicit scope boundary with VIM-125)**

- **Grouped selection controls are out of scope.** Segmented controls (`DockSwitcher`, `ViewModeToggle`, `LayoutSwitcher`, `DockTab`, `Segmented`), tab strips (`*Tabs`, `ContextSwitcher`), and the boolean `Toggle` belong to **VIM-125 (TabStrip / SegmentedControl / Toggle)**. Those primitives will be *built from* `IconButton` (hence VIM-125 depends on VIM-124). VIM-124 must **not** restructure those multi-item groups, to avoid double-touching their files. The single exception is `SidebarToggle`, a standalone single toggle button (not a group), which migrates here.
- No new color tokens — buttons use existing semantic theme tokens.
- No `Button` adoption sweep across *every* text button; text-button migration is opportunistic (clean call sites only). The surveyed sprawl is the icon/toolbar buttons, and that is the migration contract.

## 3. Architecture

### 3.1 The floating parallel

VIM-119 established the shape: a hidden substrate wrapping the hard part, with thin public primitives composing it.

| Layer | Floating (VIM-119) | Buttons (VIM-124) |
| --- | --- | --- |
| Substrate (package-private, `base/`) | `useFloatingSurface`, `SurfacePanel`, `glassSurface` | `buttonVariants`, `BaseButton` |
| Public primitives (`src/components/`) | `Dropdown`, `Menu`, `Popover` | `Button`, `IconButton`, `ToolbarButton` |
| Boundary | Ring 2 — `base/**` not importable from features | Ring 2 (same rule — already covers `base/button`) |
| Drift guard | Ring 1 — `@floating-ui/react` confined | `vimeflow/no-raw-icon-button` — raw icon `<button>` banned |

Unlike `@floating-ui` (a third-party engine that *must* stay hidden), a plain `Button` is legitimately public — text/primary buttons need it. So the substrate is hidden **and** `Button` is public; both are true, exactly as `glassSurface` is hidden while `Dropdown` is public.

### 3.2 File structure

```
src/components/base/button/         ← package-private (Ring 2 already fences base/**)
  buttonVariants.ts                 ← size × variant × shape × pressed → className; the single styling source
  buttonVariants.test.ts
  BaseButton.tsx                    ← headless <button>: type, focus-visible, disabled, ref-forward, variants, className merge
  BaseButton.test.tsx
src/components/                      ← public
  Button.tsx        Button.test.tsx         ← text / primary foundation
  IconButton.tsx    IconButton.test.tsx     ← icon-only; required label → aria-label + Tooltip
  ToolbarButton.tsx ToolbarButton.test.tsx  ← icon + label pill
eslint-rules/
  no-raw-icon-button.js             ← custom rule (mirrors no-hardcoded-colors.js)
```

### 3.3 Why `BaseButton` is a real module, not a wrapper

`BaseButton` owns behavior that all three public components would otherwise re-implement:

- `type="button"` by default (prevents accidental form submit — a real footgun).
- `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary` (one focus contract).
- `disabled` semantics + the disabled visual (`disabled:opacity-40 disabled:pointer-events-none`).
- Applying `buttonVariants(...)` and merging a consumer `className` **after** it (layout/positioning only).
- Forwarding `ref` to the underlying `<button>` so the primitives can serve as `Menu` / `Tooltip` triggers.
- Spreading `...rest` (`onClick`, `aria-*`, `data-*`).

That is the same justification as `SurfacePanel`: one place owns the element contract so the public components only configure intent.

## 4. Component contracts

### 4.1 `buttonVariants` (substrate)

The single source for button className. A pure function — no React — so it is trivially testable and reused by all three primitives.

```ts
export type ButtonVariant = 'default' | 'ghost' | 'toolbar' | 'primary'
export type ButtonSize = 'sm' | 'md' | 'lg'
export type ButtonShape = 'icon' | 'pill' // square icon-only vs horizontally-padded label

export interface ButtonVariantOptions {
  variant?: ButtonVariant // default 'default'
  size?: ButtonSize // default 'md'
  shape?: ButtonShape // default 'pill'
  pressed?: boolean // aria-pressed visual (toggle active state)
}

export const buttonVariants = (options?: ButtonVariantOptions): string
```

**Variant → token map** (each grounded in a surveyed call site; exact px verified in-browser during migration):

| Variant | Base | Hover | Pressed (`pressed`) | Canonical source |
| --- | --- | --- | --- | --- |
| `ghost` | `bg-transparent text-on-surface-muted` | `hover:bg-surface-container-high hover:text-on-surface` | `bg-primary/10 text-primary` | `HeaderActions`, `AgentStatusRail`, browser nav, copy/kebab |
| `default` | `bg-surface-container-high text-on-surface` | `hover:bg-surface-container-highest` | `bg-primary/12 text-primary` | neutral text buttons |
| `toolbar` | `bg-surface-container-high/60 text-on-surface-variant` | `hover:bg-surface-container-highest/80 hover:text-on-surface` | `bg-primary/12 text-primary` | diff toolbar triggers |
| `primary` | `border border-primary/25 bg-[linear-gradient(180deg,var(--color-primary-dim)_0%,var(--color-primary-deep)_100%)] text-surface-container-lowest` | `hover:brightness-110` | n/a | `NewSessionButton` |

`ghost` is the `IconButton` default; `toolbar` the `ToolbarButton` default; `default`/`primary` for `Button`. The agent-accent active tint (the burner button's `agent-shell-accent`) is **not** a variant — it is a call-site accent passed through `className`.

**Shape × size → geometry:**

| | `icon` (square) | `pill` (label) |
| --- | --- | --- |
| `sm` | `h-[22px] w-[22px] text-[13px] rounded-md` | `h-[26px] px-2 text-xs rounded-md gap-1.5` |
| `md` | `h-7 w-7 text-[17px] rounded-md` | `h-[30px] px-2.5 text-[13px] rounded-md gap-1.5` |
| `lg` | `h-8 w-8 text-[19px] rounded-md` | `h-9 px-3 text-[15px] rounded-lg gap-2` |

All shapes carry the shared base: `inline-flex shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-40 disabled:pointer-events-none`. `rounded-md` is the canonical icon/pill radius (replacing the 5 drifting radii); `lg` pills use `rounded-lg`.

### 4.2 `BaseButton` (substrate)

```ts
export interface BaseButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant
  size?: ButtonSize
  shape?: ButtonShape
  pressed?: boolean
  className?: string // layout/positioning only — merged AFTER buttonVariants
  ref?: React.Ref<HTMLButtonElement>
}
```

Renders `<button type="button" {...rest} ref={ref} aria-pressed={pressed} className={`${buttonVariants({variant,size,shape,pressed})} ${className ?? ''}`} />`. `type` is overridable via `rest`. Ref forwarding follows the repo's React version convention (ref-as-prop on React 19, else `forwardRef` — confirmed in the plan).

### 4.3 `Button` (public)

The text/primary foundation. Lives at `src/components/Button.tsx`; import via `@/components/Button`.

```ts
interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant // default 'default'
  size?: ButtonSize // default 'md'
  leadingIcon?: string // optional Material Symbol ligature
  className?: string // layout/positioning only
  children: ReactNode // the label
}
```

Renders `BaseButton` with `shape="pill"`, an optional leading icon span (`material-symbols-outlined`, `aria-hidden`), and `children` as the label.

### 4.4 `IconButton` (public)

Icon-only. Required `label` is both the accessible name and the Tooltip text. Lives at `src/components/IconButton.tsx`.

```ts
interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label'> {
  icon: string // Material Symbol ligature
  label: string // REQUIRED — sets aria-label AND the Tooltip content
  variant?: ButtonVariant // default 'ghost'
  size?: ButtonSize // default 'md'
  pressed?: boolean // aria-pressed toggle state
  tooltipPlacement?: Placement // default 'bottom'
  showTooltip?: boolean // default true; off when the trigger already has a disclosure affordance
  className?: string // layout/positioning only
  ref?: React.Ref<HTMLButtonElement>
}
```

Renders `<Tooltip content={label} placement={tooltipPlacement}><BaseButton aria-label={label} shape="icon" …><span className="material-symbols-outlined" aria-hidden="true">{icon}</span></BaseButton></Tooltip>`. `label` is never optional (icon-only buttons must have an accessible name — coding-style a11y rule). The `ref` and interaction props forward to the `<button>` (merged with Tooltip's ref via `useMergeRefs`) so an `IconButton` can be a `Menu` trigger (e.g. the kebab menu). `Placement` is imported from `@/components/base/floating/glassSurface` (the re-export), keeping `@floating-ui` confined.

### 4.5 `ToolbarButton` (public)

Icon + visible label pill — the diff-toolbar trigger shape. Lives at `src/components/ToolbarButton.tsx`.

```ts
interface ToolbarButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  label: string // visible text
  icon?: string // optional leading Material Symbol
  trailingIcon?: string // optional trailing symbol (e.g. 'expand_more' caret)
  variant?: ButtonVariant // default 'toolbar'
  size?: ButtonSize // default 'md'
  pressed?: boolean // aria-pressed (open/active trigger)
  className?: string // layout/positioning only
  ref?: React.Ref<HTMLButtonElement>
}
```

Renders `BaseButton` with `shape="pill"`, a leading icon (if any), the label, and an optional trailing caret. Forwards `ref` + interaction props so it can be the `trigger` of a `Menu` or the anchor for a `Popover`/`Dropdown`.

## 5. Guardrail — `vimeflow/no-raw-icon-button`

A custom ESLint rule (same module shape as `eslint-rules/no-hardcoded-colors.js`, registered under the existing `vimeflow` plugin namespace).

**Detection:** visit `className` `Literal` / `TemplateLiteral` nodes whose text contains `material-symbols-outlined`; walk ancestors; if an enclosing JSX element is a `<button>`, report:

> Raw icon `<button>` — use `IconButton` (icon-only) or `ToolbarButton` (icon + label) from `@/components`.

This catches both icon-only and icon+label hand-rolled buttons. Plain text `<button>`s are **not** flagged (forcing every text button to `Button` is out of scope; `Button` adoption is opportunistic).

**Scope:** `files: ['src/**/*.tsx'], ignores: ['src/components/**']` — the primitives themselves render the raw pattern legitimately, and features are where drift must be stopped. Mirrors the Ring 1/Ring 2 `ignores`.

**Ratchet:** when the rule lands (PR1) every existing offender gets `// eslint-disable-next-line vimeflow/no-raw-icon-button` with the count frozen and recorded in `AGENTS.md`. Each migration deletes one disable; the count reaches **0** in PR3. Identical mechanism to VIM-119's `@floating-ui` ratchet (6 → 0), just a custom selector instead of a banned import.

**Feasibility:** the AST walk (find the `material-symbols-outlined` className node, check for a `button` ancestor via `context.sourceCode.getAncestors`) is a direct adaptation of `no-hardcoded-colors.js`, which already does per-node className inspection. A `buttonVariants` unit test and a rule fixture test lock the behavior.

## 6. Import rings (delta from main)

- **Ring 2 (unchanged) already covers `base/button`.** `@/components/base/**` is banned outside `src/components/**` (eslint.config.js). `base/button` inherits this — no new ring needed.
- **New:** the `vimeflow/no-raw-icon-button` rule (§5).
- **Alias regex (extend):** the existing `regex/invalid` "shared primitives via `@/components/*` alias" pattern (`Tooltip|StatusBar|GlassSurface|ResizeHandle|sidebar/`) gains `Button|IconButton|ToolbarButton`, so deep relative imports of the new primitives are rejected.

## 7. Migration plan (in-scope targets)

Standalone icon buttons, toolbar pills, and the single `SidebarToggle`. Grouped selection controls are VIM-125 (§2).

| Call site | Target | Variant | Notes |
| --- | --- | --- | --- |
| `terminal/.../HeaderActions` (burner / collapse / close) | `IconButton` `sm` | `ghost` | burner active tint → `className` (agent-accent) + `pressed` |
| `agent-status/.../AgentStatusRail` glyphs | `IconButton` | `ghost` | |
| `agent-status/.../AgentStatusPanel/Header` glyph | `IconButton` | `ghost` | |
| `agent-status/.../ActivityEvent` copy | `IconButton` `sm` | `ghost` | |
| `sessions/.../Card` kebab | `IconButton` `sm` | `ghost` | trigger for the card `Menu`; `showTooltip` per affordance |
| `browser/.../BrowserToolbar` back/forward/reload | `IconButton` | `ghost` | exercises `disabled` |
| `workspace/.../SidebarToggle` | `IconButton` | `ghost` | `pressed`/`aria-expanded`; ghost/inset → `pressed` |
| `workspace/.../NewSessionButton` | `Button` | `primary` | reveal-animation layout via `className`; chrome via variant |
| diff toolbar `ViewSettingsDropdown` trigger | `ToolbarButton` | `toolbar` | passed as `Menu` `trigger`; `pressed` when open |
| diff toolbar `PriorityPlus` trigger | `ToolbarButton` | `toolbar` | `Popover` anchor |
| diff toolbar `Dropdown` built-in trigger | `ToolbarButton` | `toolbar` | inside `src/components/Dropdown.tsx` — already a primitive; adopt internally |

Size convergence: `h-6`/`h-[26px]`/`h-[27px]` round to `md` (28); `h-[22px]` → `sm`; `h-8` → `lg`. The 1–2px shifts are the intended unification, verified in-browser per migration.

## 8. Testing

- **`buttonVariants`** — unit: every variant/size/shape/pressed combination yields the expected canonical classes; defaults applied.
- **`BaseButton`** — `type="button"` default; ref reaches the `<button>`; `disabled` sets the attribute + disabled classes; `className` merges after variants; `pressed` sets `aria-pressed`.
- **`Button` / `IconButton` / `ToolbarButton`** — render the icon/label; `IconButton` sets `aria-label` from `label` and renders a Tooltip; icon spans carry `aria-hidden="true"`; keyboard (Enter/Space) fires `onClick`; `IconButton`/`ToolbarButton` work as a `Menu` trigger (ref + props forward). Every a11y attribute asserted by a Testing-Library query (coding-style rule).
- **`no-raw-icon-button`** — RuleTester: a `<button>` wrapping a `material-symbols-outlined` span reports; a text `<button>` and a bare `material-symbols` span (no button ancestor) do not; `src/components/**` is exempt.
- **Migrations** — existing component tests stay green; updated where they asserted old class strings.
- Coverage ≥ 80% (repo standard); new test files import `{ test, expect }` explicitly (globals are runtime-only).

## 9. Documentation

- **UNIFIED.md** — add §5.10 `Button`, §5.11 `IconButton`, §5.12 `ToolbarButton` (one section per primitive, matching §5.7–5.9), each with the interface block + rules (import via alias; `base/button` package-private; `IconButton` requires `label`; grouped controls are VIM-125).
- **rules/typescript/coding-style/CLAUDE.md** — extend "Shared UI Primitives" with a Buttons bullet (always `Button`/`IconButton`/`ToolbarButton` from `@/components`; raw icon `<button>` banned by `vimeflow/no-raw-icon-button`; contract UNIFIED §5.10–5.12).
- **AGENTS.md** — record the ratchet (frozen count → 0) like the `@floating-ui` statement.

## 10. PR breakdown (3 stacked, integration branch `feat/button-primitives` → `main`)

- **PR1 — substrate + icon-only.** `base/button` (`buttonVariants` + `BaseButton`), `Button`, `IconButton`, the `no-raw-icon-button` rule (grandfather all offenders, freeze count), and migrate the standalone icon-only buttons (HeaderActions, AgentStatusRail, panel header, ActivityEvent copy, Card kebab, BrowserToolbar nav, SidebarToggle). Each migration deletes a disable.
- **PR2 — toolbar pills.** `ToolbarButton` + migrate the diff-toolbar triggers (ViewSettings, PriorityPlus, the `Dropdown` built-in trigger) and `NewSessionButton` (primary).
- **PR3 — close-out.** Remaining stragglers, ratchet → 0, the alias-regex addition, and docs (UNIFIED §5.10–5.12, coding-style, AGENTS).
- **Final → main** PR `Closes VIM-124`. Child PRs carry **no** `VIM-124` magic word (a linked child merge would auto-Done the issue); only the final `→ main` PR closes it.

## 11. Risks & open questions

- **`primary` has one bespoke consumer.** `NewSessionButton` is currently the only primary button, and it carries a reveal animation (`flex-1`, `min/max-w`, `group` label reveal). The variant captures its *chrome* (gradient/border/shadow/focus); its *layout/animation* stays call-site via `className`. If no second primary consumer emerges, the plan may defer the `primary` variant and leave `NewSessionButton` as a documented exception — decided in the plan, not here.
- **`className` passthrough re-opens a drift door.** Mitigated: it is documented as layout/positioning only, color literals are already caught by `vimeflow/no-hardcoded-colors`, and the variant owns all tonal classes. The floating substrate forbids `className` because its surface is fixed; buttons legitimately need layout control, so the trade-off differs.
- **Size convergence is visible churn.** Converging 5 sizes to 3 shifts some buttons 1–2px. Intentional, but each migration must be eyeballed in-browser (jsdom can't catch it) per the tailwind-rem lesson.
- **Ref-merge in `IconButton`-as-trigger.** `IconButton` already wraps a Tooltip; serving as a `Menu` trigger means merging the external ref/props with the Tooltip ref. `useMergeRefs` handles it, but it needs an explicit test (the survey's kebab menu is the live case).
