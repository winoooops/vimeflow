# Button Primitives Design — `Button` / `IconButton` / `ToolbarButton`

**Status:** Draft (codex-reviewed; revision 2)
**Linear:** [VIM-124](https://linear.app/vimeflow/issue/VIM-124) (child of the VIM-116 unified-component epic; third extraction after VIM-117 Tooltip + VIM-119 floating surfaces)

**Goal:** Replace the hand-rolled icon/toolbar buttons (10 distinct stylings, no shared primitive) with one button family — a package-private `base/button` substrate plus three public primitives — so button chrome, sizing, focus, disabled, and ARIA are defined once and composed everywhere.

**Architecture:** A hidden `src/components/base/button` substrate (`buttonVariants` + `BaseButton`) owns the element contract and the variant × size × shape → className mapping (a `tailwind-variants` `tv()` definition); public `Button` / `IconButton` / `ToolbarButton` compose it. This mirrors how VIM-119's `base/floating` substrate (`useFloatingSurface` + `SurfacePanel`) underlies the public `Dropdown` / `Menu` / `Popover`. The `base/**` package-private boundary (ESLint Ring 2) already fences the substrate; a new custom rule (`vimeflow/no-raw-icon-button`) ratchets out hand-rolled icon-only buttons.

**Tech stack:** React + TypeScript, Tailwind (semantic theme tokens), Material Symbols, Vitest + Testing Library, ESLint flat config (custom rule).

---

## 1. Problem

A survey of `src/` (2026-06-14) found **~40 icon/toolbar buttons across 10 distinct hand-rolled stylings**, with **no `Button` primitive in `src/components/`**. Drift spans every axis:

- **Size** — `h-[22px]`, `h-6` (24), `h-[26px]`, `h-[27px]`, `h-7` (28), `h-8` (32): six ad-hoc dimensions.
- **Radius** — `rounded`, `rounded-md`, `rounded-[5px]`, `rounded-[7px]`, `rounded-lg`, `rounded-full`: six in use.
- **Hover** — `hover:bg-surface-container-high`, `hover:bg-surface-container-highest/80`, `hover:bg-wash-subtle`, `hover:bg-primary/[0.08]`: four+ strategies.
- **Layout** — `grid place-items-center` vs `inline-flex items-center justify-center` vs `flex`.
- **Icon size** — `text-base`, `text-[13px]`, `text-[17px]`, `text-[10px]`, `text-[19px]`.
- **a11y gaps** — disabled-state styling has ≈0% coverage; focus-visible rings are sparse and inconsistent; only `BrowserToolbar` models disabled nav buttons.

The repeated shape underneath the icon-only buttons is identical:

```tsx
<button className="[layout] [size] rounded-[r] [variant-color] hover:[hover] transition-colors [focus]">
  <span className="material-symbols-outlined [icon-size]" aria-hidden="true">
    {icon}
  </span>
</button>
```

Every theme/a11y/motion change today means editing N files. One shared family collapses that to one.

## 2. Goals & non-goals

**Goals**

1. A package-private `base/button` substrate that owns the `<button>` element contract (type, focus-visible, disabled, ref-forward, className merge) and the canonical variant × size × shape → className map (a `tailwind-variants` `tv()` definition).
2. Three public primitives: `Button` (text / primary foundation), `IconButton` (icon-only, required accessible name), `ToolbarButton` (icon + label pill).
3. Migrate every **standalone icon-only** button and **toolbar pill** in scope to the new family.
4. A guardrail — `vimeflow/no-raw-icon-button` — that fails lint on a raw icon-only Material Symbols `<button>` (the glyph class on the button itself or on its single child icon span), outside `src/components/`, ratcheted down per the offender inventory.
5. Converge the drifting sizes (6 → `sm` / `md` / `lg`) and radii (6 → one canonical per shape) — an intentional visual convergence verified in-browser per migration.

**Non-goals — the scope boundary with VIM-125 (read this carefully; codex flagged an overlap)**

- **Grouped selection controls are out of scope.** Segmented controls (`DockSwitcher`, `ViewModeToggle`, `LayoutSwitcher`, `DockTab`, `Segmented`), tab strips (`SidebarTabs`, `EditorTabs`, `FileTabs`, `BrowserTabBar`, sessions `Tabs`, `ContextSwitcher`), and the boolean `Toggle` belong to **VIM-125 (TabStrip / SegmentedControl / Toggle)**. Those primitives will be _built from_ `IconButton` (hence VIM-125 depends on VIM-124). VIM-124 must **not** restructure those groups.
- **Consequence for the ratchet (the overlap fix):** grouped controls contain raw icon buttons too, so VIM-124 does **not** drive the offender count to 0. The authoritative audit is the **PR1 offender inventory** (§7) — a grep-based classification of _every_ raw icon button, **including shapes the lint rule cannot see** (§5) — not the set of lint disables. VIM-124 migrates its in-scope standalone offenders; the inventory's `deferred-grouped` entries are the **frozen floor** handed to VIM-125. Rule-detected grouped offenders additionally carry `// eslint-disable-next-line vimeflow/no-raw-icon-button -- VIM-125: grouped control`, but the inventory (not the disable count) is what "audited floor" means.
- **`SidebarToggle` is NOT migrated here.** It renders a custom SVG glyph (not a Material Symbol), a non-token rail size (~34px), `ghost`/`inset` variants, and a Tooltip shortcut chip — it does not fit `IconButton`'s Material-Symbol-string contract, and the rule does not flag it (no `material-symbols-outlined`). It stays bespoke; revisited only if a second SVG-glyph button appears.
- No new color tokens — buttons use existing semantic theme tokens.
- No `Button` adoption sweep across _every_ text button; text-button migration is opportunistic (clean call sites only). The surveyed sprawl is the icon/toolbar buttons, and that is the migration contract.

## 3. Architecture

### 3.1 The floating parallel

VIM-119 established the shape: a hidden substrate wrapping the hard part, with thin public primitives composing it.

| Layer                                 | Floating (VIM-119)                                   | Buttons (VIM-124)                                               |
| ------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Substrate (package-private, `base/`)  | `useFloatingSurface`, `SurfacePanel`, `glassSurface` | `buttonVariants`, `BaseButton`                                  |
| Public primitives (`src/components/`) | `Dropdown`, `Menu`, `Popover`                        | `Button`, `IconButton`, `ToolbarButton`                         |
| Boundary                              | Ring 2 — `base/**` not importable from features      | Ring 2 (same rule — already covers `base/button`)               |
| Drift guard                           | Ring 1 — `@floating-ui/react` confined               | `vimeflow/no-raw-icon-button` — raw icon-only `<button>` banned |

Unlike `@floating-ui` (a third-party engine that _must_ stay hidden), a plain `Button` is legitimately public — text/primary buttons need it. So the substrate is hidden **and** `Button` is public; both are true, exactly as `glassSurface` is hidden while `Dropdown` is public.

### 3.2 File structure

```
src/components/base/button/         ← package-private (Ring 2 already fences base/**)
  buttonVariants.ts                 ← tv() · variant × size × shape → className; the single styling source
  buttonVariants.test.ts
  BaseButton.tsx                    ← headless <button>: type, focus-visible, disabled, ref-forward, variants, className merge
  BaseButton.test.tsx
src/components/                      ← public
  Button.tsx        Button.test.tsx         ← text / primary foundation; re-exports ButtonVariantProps
  IconButton.tsx    IconButton.test.tsx     ← icon-only; required label → aria-label + Tooltip
  ToolbarButton.tsx ToolbarButton.test.tsx  ← icon + label pill
eslint-rules/
  no-raw-icon-button.js             ← custom rule (mirrors no-hardcoded-colors.js; registered on the existing vimeflow plugin)
```

### 3.3 Why `BaseButton` is a real module, not a wrapper

`BaseButton` owns behavior that all three public components would otherwise re-implement:

- `type="button"` by default (prevents accidental form submit — a real footgun).
- `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary` (one focus contract).
- `disabled` semantics + the disabled visual (`disabled:opacity-40 disabled:pointer-events-none`).
- Calling `buttonVariants({ …, class: className })` — `tv()` merges the consumer `className` last via tailwind-merge (layout/positioning only).
- Forwarding `ref` and `...rest` to the underlying `<button>` so the primitives can serve as `Menu` / `Popover` / `Tooltip` triggers.

That is the same justification as `SurfacePanel`: one place owns the element contract so the public components only configure intent.

## 4. Component contracts

### 4.1 `buttonVariants` (substrate)

A [`tailwind-variants`](https://www.tailwind-variants.org) `tv()` definition — the single declarative styling source, reused by all three primitives. `tailwind-variants` (peer `tailwind-merge >= 3`, the Tailwind-v4 line) gives the `variant` / `size` / `shape` axes, `compoundVariants` for shape×size geometry, conflict-free `class` passthrough, and — via `VariantProps` — the prop types for free. Verified against the repo's custom tokens on TW v4 (see §4.1 note + §11).

```ts
import { tv, type VariantProps } from 'tailwind-variants'

export const buttonVariants = tv({
  base: 'inline-flex shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-40 disabled:pointer-events-none',
  variants: {
    variant: { ghost, default, toolbar, primary, danger }, // token strings in the table below
    size: { sm: '', md: '', lg: '' }, // geometry comes from compoundVariants (shape × size)
    shape: { icon: '', pill: '' },
  },
  compoundVariants: [
    /* shape × size → h / w / px / text / radius / gap — table below */
  ],
  defaultVariants: { variant: 'default', size: 'md', shape: 'pill' },
})

export type ButtonVariantProps = VariantProps<typeof buttonVariants>
// → { variant?: 'ghost'|'default'|'toolbar'|'primary'|'danger'; size?: 'sm'|'md'|'lg'; shape?: 'icon'|'pill' }
```

`ButtonVariantProps` is re-exported from `@/components/Button` (consumers never import from `base/`, mirroring how `DropdownOption` is re-exported from `@/components/Dropdown`).

**Variant → token map** (each grounded in a surveyed call site; exact px verified in-browser during migration):

| Variant   | Base                                                                                                                                                                                                                                                                   | Hover                                                         | Active (`aria-pressed` / `aria-expanded`)                                                                                  | Canonical source                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ghost`   | `bg-transparent text-on-surface-muted`                                                                                                                                                                                                                                 | `hover:bg-surface-container-high hover:text-on-surface`       | `aria-pressed:bg-primary/10 aria-pressed:text-primary aria-expanded:bg-primary/10 aria-expanded:text-primary`              | `HeaderActions`, `AgentStatusRail`, browser nav, copy/kebab |
| `default` | `bg-surface-container-high text-on-surface`                                                                                                                                                                                                                            | `hover:bg-surface-container-highest`                          | `aria-pressed:bg-primary/12 aria-expanded:bg-primary/12`                                                                   | neutral text buttons                                        |
| `toolbar` | `bg-surface-container-high/60 text-on-surface-variant`                                                                                                                                                                                                                 | `hover:bg-surface-container-highest/80 hover:text-on-surface` | `aria-pressed:bg-surface-container-highest/80 aria-expanded:bg-surface-container-highest/80 aria-expanded:text-on-surface` | diff toolbar triggers                                       |
| `primary` | `border border-primary/25 bg-[linear-gradient(180deg,var(--color-primary-dim)_0%,var(--color-primary-deep)_100%)] text-surface-container-lowest shadow-[0_8px_18px_color-mix(in_srgb,var(--color-primary-deep)_20%,transparent),inset_0_1px_0_var(--color-wash-soft)]` | `hover:brightness-110 active:translate-y-px`                  | n/a                                                                                                                        | `NewSessionButton`                                          |
| `danger`  | `bg-transparent text-error`                                                                                                                                                                                                                                            | `hover:bg-error/10 hover:text-error`                          | `aria-pressed:bg-error/15 aria-expanded:bg-error/15`                                                                       | `ReviewCommentRow` delete                                   |

`danger` is a full **variant** (not a tone) — a self-contained destructive skin. `tailwind-merge` (bundled with `tailwind-variants`) makes the old class-order hazard moot: it resolves conflicting utilities deterministically rather than by string order, so a consumer `className` merges cleanly and variants never bleed (smoke-verified on TW v4: `text-[13px]` font-size and `text-on-surface-muted` color both survive). Feature-specific accents (the burner's `agent-shell-accent`, browser nav's `agent-browser-accent`) are **not** variants — they are semantic tokens passed through `className` (allowed by `vimeflow/no-hardcoded-colors`), documented as accent exceptions.

**The active state is attribute-driven, not a separate render path.** A toggle sets `pressed` → `aria-pressed`. A floating-surface trigger gets `aria-expanded` injected by floating-ui's interaction props (`getReferenceProps`). `buttonVariants` styles **both** with the same active tint, so `pressed={open}` is unnecessary for `Menu` triggers (where `Menu` owns `open`) — the injected `aria-expanded` drives the tint. `Popover` anchors, where the consumer owns `open`, may also pass `pressed={open}` directly.

**Shape × size → geometry:**

|      | `icon` (square)                              | `pill` (label)                                   |
| ---- | -------------------------------------------- | ------------------------------------------------ |
| `sm` | `h-[22px] w-[22px] text-[13px] rounded-chip` | `h-[26px] px-2 text-xs rounded-md gap-1.5`       |
| `md` | `h-7 w-7 text-[17px] rounded-chip`           | `h-[30px] px-2.5 text-[13px] rounded-md gap-1.5` |
| `lg` | `h-8 w-8 text-[19px] rounded-chip`           | `h-9 px-3 text-[15px] rounded-lg gap-2`          |

These rows are the `compoundVariants` (geometry depends on shape **and** size; `size`/`shape` alone contribute nothing). Icon buttons use `rounded-chip` (6px) — the center of the existing utility-button cluster (HeaderActions 4px, DockSwitcher 5px, SidebarToggle 7px), so most buttons barely move (radius confirmed visually). Pills use `rounded-md` (`rounded-lg` at `lg`). **Two call sites keep a distinctive radius via `className` as intentional exceptions, not drift:** `BrowserToolbar` nav (`rounded-lg`) and `PriorityPlus` overflow (`rounded-full`, a circular affordance). The shared `base` (focus ring, disabled, flex centering) lives in the `tv()` `base` slot.

### 4.2 `BaseButton` (substrate)

```ts
export interface BaseButtonProps
  extends
    ButtonVariantProps,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  pressed?: boolean // sets aria-pressed; the active tint is keyed off the attribute
  className?: string // layout/positioning only — passed to tv() as `class`, merged last by tailwind-merge
  ref?: React.Ref<HTMLButtonElement>
}
```

Renders `<button type="button" {...rest} ref={ref} aria-pressed={pressed} className={buttonVariants({ variant, size, shape, class: className })} />`. `tv()` accepts the consumer `className` via its `class` arg and merges it last. `type` and any injected attribute (e.g. `aria-expanded` from a floating trigger) flow through `...rest`. Ref forwarding uses React 19 ref-as-prop.

### 4.3 `Button` (public)

The text/primary foundation. Lives at `src/components/Button.tsx`; import via `@/components/Button`. Re-exports `ButtonVariantProps`.

```ts
interface ButtonProps
  extends
    Pick<ButtonVariantProps, 'variant' | 'size'>,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  // variant default 'default', size default 'md'; danger via variant="danger"
  leadingIcon?: string // optional Material Symbol ligature
  className?: string // layout/positioning only
  children: ReactNode // the label
  ref?: React.Ref<HTMLButtonElement> // ref-capable like IconButton/ToolbarButton
}
```

Renders `BaseButton` with `shape="pill"`, an optional leading icon span (`material-symbols-outlined`, `aria-hidden`), and `children` as the label. The public primitives expose only `variant`/`size` (via `Pick`) — `shape` is fixed per primitive, never a consumer prop.

### 4.4 `IconButton` (public)

Icon-only. Required `label` is both the accessible name and the Tooltip text. Lives at `src/components/IconButton.tsx`.

```ts
interface IconButtonProps
  extends
    Pick<ButtonVariantProps, 'variant' | 'size'>,
    Omit<
      React.ButtonHTMLAttributes<HTMLButtonElement>,
      'className' | 'aria-label'
    > {
  icon: string // Material Symbol ligature
  label: string // REQUIRED — sets aria-label AND the Tooltip content
  // variant default 'ghost'; danger via variant="danger"
  pressed?: boolean // aria-pressed toggle state (standalone toggles / Popover anchors)
  shortcut?: ShortcutInput // optional Zed-style key chip in the Tooltip
  tooltipPlacement?: Placement // default 'bottom'
  showTooltip?: boolean // default true; off when the trigger already has a disclosure affordance
  className?: string // layout/positioning only
  ref?: React.Ref<HTMLButtonElement>
}
```

Renders `<Tooltip content={label} shortcut={shortcut} placement={tooltipPlacement}><BaseButton aria-label={label} shape="icon" {...rest} ref={ref}><span className="material-symbols-outlined" aria-hidden="true">{icon}</span></BaseButton></Tooltip>`. `label` is never optional (icon-only buttons must have an accessible name — coding-style a11y rule). `ref` and `...rest` forward to the `<button>`; codex confirmed the trigger flow works because `Tooltip` already merges its child's `ref` with its own reference ref (`useMergeRefs`) and merges handlers via `cloneElement`, so an injected `Menu`/`Popover` ref + `onClick` + `aria-expanded` coexist with the Tooltip. `Placement` and `ShortcutInput` are imported from the existing re-export points (`@/components/base/floating/glassSurface` / `../lib/formatShortcut`), keeping `@floating-ui` confined.

### 4.5 `ToolbarButton` (public)

Icon + visible label pill — the diff-toolbar trigger shape. Lives at `src/components/ToolbarButton.tsx`.

```ts
interface ToolbarButtonProps
  extends
    Pick<ButtonVariantProps, 'variant' | 'size'>,
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  label: string // visible text
  icon?: string // optional leading Material Symbol
  trailingIcon?: string // optional trailing symbol (e.g. 'expand_more' caret)
  // variant default 'toolbar'
  pressed?: boolean // aria-pressed; for Menu triggers the open tint comes from injected aria-expanded instead
  className?: string // layout/positioning only
  ref?: React.Ref<HTMLButtonElement>
}
```

Renders `BaseButton` with `shape="pill"`, a leading icon (if any), the label, and an optional trailing caret. Forwards `ref` + `...rest` so it can be a `Menu` `trigger` (open tint via injected `aria-expanded`) or a `Popover` anchor (`pressed={open}`, consumer owns `open`).

## 5. Guardrail — `vimeflow/no-raw-icon-button`

A custom ESLint rule (same module shape as `eslint-rules/no-hardcoded-colors.js`), **added to the existing `vimeflow` plugin object** in `eslint.config.js` (a second `plugins: { vimeflow: … }` block fails flat-config redefinition — codex caught this).

**Detection — icon-only, two shapes (the precision fix for codex's false-positive finding, broadened to close its under-detection finding):** report an icon-only `<button>` carrying `material-symbols-outlined` in a literal/template `className`, in either placement:

- **Shape A — glyph button:** the class is on the `<button>` itself; its only child is the icon ligature `JSXText` (e.g. `FileExplorer.tsx:283`).
- **Shape B — icon span:** the class is on the button's single child element, and the button has no non-whitespace `JSXText` of its own — so file rows / menu items / the address bar (icon **plus** text) are excluded.

Implementation: visit `JSXElement` named `button`; if its own `className` literal contains `material-symbols-outlined`, report (Shape A); otherwise filter `children` dropping whitespace-only `JSXText`, and if the survivors are a single `JSXElement` whose `className` literal contains `material-symbols-outlined`, report (Shape B). Message:

> Raw icon-only `<button>` — use `IconButton` from `@/components` (or `ToolbarButton` for icon + label).

Because it requires _icon-only_ content, Shape B does **not** fire on file rows (`ChangedFilesList`), the address bar (`BrowserAddressBar`), or menu-item buttons (`ContextMenu`) — those carry text/inputs alongside the icon. It also will not flag the primitives' own files (`ignores: ['src/components/**']`).

**Known limitation (covered by the inventory, not ignored):** icon buttons whose class comes from a helper (e.g. `DockTab`'s `tabIconClass()`) are not detected, because no `material-symbols-outlined` literal sits in the JSX. The rule is a **forward guardrail** for the two common syntactic shapes, not an exhaustive migrator. Completeness is the **inventory's** job (§7): the grep audit finds helper-class and dynamically-classed icons the AST rule cannot, and classifies them. "Audited floor" therefore means the inventory, not the disable count — closing the gap codex flagged where a rule-only audit would silently miss existing offenders.

**Scope:** `files: ['src/**/*.tsx'], ignores: ['src/components/**']` — mirrors the Ring 1/Ring 2 `ignores`.

**Ratchet:** every **rule-detected** offender gets `// eslint-disable-next-line vimeflow/no-raw-icon-button` when the rule lands (PR1); the **inventory** (§7) records the complete audit — rule-detected _and_ helper-class — split into **VIM-124 in-scope** (migrated away across PR1–PR3) and **VIM-125-deferred** (grouped controls, tagged `-- VIM-125` where a disable exists, else listed in the inventory). Same mechanism as VIM-119's `@floating-ui` ratchet (6 → 0), but it lands at the inventory-defined VIM-124 floor, not 0.

**Feasibility:** the visitor + child filtering is a direct adaptation of `no-hardcoded-colors.js`'s per-node className inspection (codex confirmed the ESLint-9 `JSXElement`/`sourceCode` APIs support it).

## 6. Import rings (delta from main)

- **Ring 2 (unchanged) already covers `base/button`.** `@/components/base/**` is banned outside `src/components/**`. `base/button` inherits this — no new ring needed.
- **New:** the `vimeflow/no-raw-icon-button` rule (§5), registered on the existing `vimeflow` plugin object.
- **Alias regex (extend):** the existing `regex/invalid` "shared primitives via `@/components/*` alias" pattern (`Tooltip|StatusBar|GlassSurface|ResizeHandle|sidebar/`) gains `Button|IconButton|ToolbarButton`.

## 7. Migration plan (in-scope targets)

Standalone icon-only buttons and toolbar pills. Grouped controls and `SidebarToggle` are out (§2). **PR1's first task is a full offender inventory** (`grep` every `<button>`-with-`material-symbols`, both shapes from §5 **and** helper-class icons the lint rule cannot see), classifying each as: migrate-now (standalone icon-only), toolbar-pill, deferred-grouped (`-- VIM-125`), or row/menu exception (text alongside the icon — not flagged, not migrated). The inventory is the **authoritative audit and the source of the VIM-125 floor** (the lint-disable set is a subset of it). The table below is the expected migrate-now set; the inventory is the contract.

| Call site                                                | Target            | Variant   | Notes                                                                                                        |
| -------------------------------------------------------- | ----------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `terminal/.../HeaderActions` (burner / collapse / close) | `IconButton` `sm` | `ghost`   | burner active tint → `className` (`agent-shell-accent`) + `pressed`                                          |
| `agent-status/.../AgentStatusRail` glyphs                | `IconButton`      | `ghost`   |                                                                                                              |
| `agent-status/.../AgentStatusPanel/Header` glyph         | `IconButton`      | `ghost`   |                                                                                                              |
| `agent-status/.../ActivityEvent` copy                    | `IconButton` `sm` | `ghost`   |                                                                                                              |
| `sessions/.../Card` kebab                                | `IconButton` `sm` | `ghost`   | trigger for the card `Menu`; open tint via `aria-expanded`                                                   |
| `browser/.../BrowserToolbar` back/forward/reload         | `IconButton`      | `ghost`   | exercises `disabled`; accent hover/focus + `rounded-lg` kept → `className` (intentional)                     |
| `diff/.../ReviewCommentRow` delete                       | `IconButton` `sm` | `danger`  | destructive                                                                                                  |
| `workspace/.../NewSessionButton`                         | `Button`          | `primary` | reveal-animation layout via `className`; chrome via variant                                                  |
| diff toolbar `ViewSettingsDropdown` trigger              | `ToolbarButton`   | `toolbar` | passed as `Menu` `trigger`; open tint via injected `aria-expanded`                                           |
| diff toolbar `PriorityPlus` trigger                      | `IconButton`      | `ghost`   | icon-only overflow button; `Popover` anchor → `pressed={open}`; keep `rounded-full` (circle) via `className` |
| diff toolbar `Dropdown` built-in trigger                 | `ToolbarButton`   | `toolbar` | inside `src/components/Dropdown.tsx` — already a primitive; adopt internally                                 |

Size convergence: `h-6`/`h-[26px]`/`h-[27px]` round to `md` (28); `h-[22px]` → `sm`; `h-8` → `lg`. The 1–2px shifts are the intended unification, verified in-browser per migration.

## 8. Testing

- **`buttonVariants`** — unit: every variant/size/shape combination yields the expected canonical classes; defaults applied; the `danger` variant is a self-contained skin (assert `text-error` present, no base-text bleed); the active classes include both `aria-pressed:` and `aria-expanded:`. **tailwind-merge keeps custom tokens** — assert `text-[13px]` (font-size) and `text-on-surface-muted` (color) both survive, and a `class` passthrough merges.
- **`BaseButton`** — `type="button"` default; ref reaches the `<button>`; `disabled` sets the attribute + disabled classes; `className` merges after variants; `pressed` sets `aria-pressed`; an injected `aria-expanded` flows through `...rest`.
- **`Button` / `IconButton` / `ToolbarButton`** — render the icon/label; `IconButton` sets `aria-label` from `label`, renders a Tooltip, forwards a shortcut chip; icon spans carry `aria-hidden="true"`; keyboard (Enter/Space) fires `onClick`; **`IconButton`/`ToolbarButton` as a `Menu` trigger** — the ref reaches the button, the consumer `onClick` fires, and the open state reflects on `aria-expanded` (the live kebab/ViewSettings cases). Every a11y attribute asserted by a Testing-Library query.
- **`no-raw-icon-button`** — RuleTester: a glyph `<button className="material-symbols-outlined">` (Shape A) and an icon-span-only `<button>` (Shape B) both report; a `<button>` with icon **plus** text does **not** (the row/menu exclusion); a helper-classed icon button is an acknowledged rule miss (a comment in the test marks it as inventory-covered, not rule-covered); a bare `material-symbols` span (no button ancestor) does not; `src/components/**` is exempt. **Plus an ESLint flat-config integration test** that lints a fixture through the real `eslint.config.js` to confirm the rule is wired on the `vimeflow` plugin and scoped correctly.
- **Migrations** — existing component tests stay green; updated where they asserted old class strings.
- Coverage ≥ 80% (repo standard); new test files import `{ test, expect }` explicitly (globals are runtime-only).

## 9. Documentation

- **UNIFIED.md** — add §5.10 `Button`, §5.11 `IconButton`, §5.12 `ToolbarButton` (one section per primitive, matching §5.7–5.9), each with the interface block + rules (import via alias; `base/button` package-private; `IconButton` requires `label`; active state is attribute-driven; grouped controls + `SidebarToggle` are out of scope).
- **rules/typescript/coding-style/CLAUDE.md** — extend "Shared UI Primitives" with a Buttons bullet (always `Button`/`IconButton`/`ToolbarButton` from `@/components`; raw icon-only `<button>` banned by `vimeflow/no-raw-icon-button`; contract UNIFIED §5.10–5.12).
- **AGENTS.md** — record the ratchet: VIM-124 floor (grouped-control offenders tagged `-- VIM-125`), → 0 at VIM-125, like the `@floating-ui` statement.

## 10. PR breakdown (3 stacked, integration branch `feat/button-primitives` → `main`)

- **PR1 — substrate + icon-only.** The offender inventory (§7, the audit of record); `base/button` (`buttonVariants` + `BaseButton`); `Button`; `IconButton`; the `no-raw-icon-button` rule (disable every **rule-detected** offender, tag grouped ones `-- VIM-125`; the inventory records the complete audit including helper-class icons); migrate the standalone icon-only buttons (HeaderActions, AgentStatusRail, panel header, ActivityEvent copy, Card kebab, BrowserToolbar nav, ReviewCommentRow, PriorityPlus). Each migration deletes a VIM-124 disable.
- **PR2 — toolbar pills.** `ToolbarButton` + migrate the diff-toolbar triggers (ViewSettings, the `Dropdown` built-in trigger) and `NewSessionButton` (primary).
- **PR3 — close-out.** Remaining in-scope stragglers, ratchet to the **VIM-124 floor** (grouped disables remain for VIM-125), the alias-regex addition, and docs (UNIFIED §5.10–5.12, coding-style, AGENTS).
- **Final → main** PR `Closes VIM-124`. Child PRs carry **no** `VIM-124` magic word (a linked child merge would auto-Done the issue); only the final `→ main` PR closes it.

## 11. Risks & open questions

- **`primary` has one bespoke consumer.** `NewSessionButton` is currently the only primary button, and it carries a reveal animation (`flex-1`, `min/max-w`, `group` label reveal). The variant captures its full chrome (gradient + border + shadow + focus + `active:translate-y-px`); its _layout/animation_ stays call-site via `className`. Kept per the design review (it's the canonical primary action) even at one consumer today.
- **`className` passthrough.** Documented as layout/positioning only; color literals are caught by `vimeflow/no-hardcoded-colors`; the variant owns all tonal classes; feature accents use semantic tokens. `tailwind-merge` (via `tv()`) resolves any conflict deterministically rather than by string order, so the old "which utility wins" hazard is gone. The floating substrate forbids `className` because its surface is fixed; buttons legitimately need layout control.
- **New dependency: `tailwind-variants` + `tailwind-merge`.** Two small runtime deps (peer `tailwind-merge >= 3`, the TW-v4 line). The one real risk — `tailwind-merge` misgrouping the repo's _custom_ semantic tokens — was smoke-tested before adoption (font-size vs color survive; custom `bg-`/`text-` tokens merge correctly). Fallback if a future token misbehaves: `tv({...}, { twMerge: false })` (the variants are conflict-free by construction, so merge only matters for the layout `className`) or a `twMergeConfig`. Decision record: `docs/decisions/2026-06-14-tailwind-variants.md`.
- **Size convergence is visible churn.** Converging six sizes to three shifts some buttons 1–2px. Intentional, but each migration must be eyeballed in-browser (jsdom can't catch it) per the tailwind-rem lesson.
- **Ratchet floor, not 0; the inventory is the audit.** Because grouped controls hold icon buttons (VIM-125's territory) and some icons are helper-classed (invisible to the AST rule), the lint-disable set alone cannot prove completeness. The **inventory** is the audit of record; the lint rule is a forward guardrail for the two common shapes (§5). "Done" for VIM-124 = every inventory `migrate-now` entry migrated, with the `deferred-grouped` entries handed to VIM-125 as a precise list.
