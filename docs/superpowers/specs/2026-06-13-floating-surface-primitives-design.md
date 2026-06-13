# Floating Surface Primitives — Design Spec

**Status:** Draft (codex review round 1 applied; pending user approval)
**Epic:** VIM-116 — Unified UI component library. Follows the VIM-117 Tooltip pilot ([#440](https://github.com/winoooops/vimeflow/pull/440)).
**Date:** 2026-06-13

## 1. Context & problem

VIM-117 converged every tooltip on the shared `Tooltip` and, crucially, **pre-staged this extraction**: it fenced `@floating-ui/react` to `src/components/` and grandfathered the six existing hand-rolled floating surfaces with file-level lint disables — a ratchet frozen at six, where a seventh is a lint error.

Those six each hand-roll a similar substrate: `useFloating` with `offset/flip/shift`, a dismiss policy, `useRole`, `FloatingPortal`, and a glassmorphic panel className. The className is **already drifting** — `Dropdown`/`ViewSettingsDropdown` use `bg-surface-container-high/95 … rounded-lg border`; `TerminalContextMenu` uses `/90 … rounded-md` with no border. `ViewSettingsDropdown` even imports `DropdownOption` from `Dropdown` and then re-implements the option list by hand. This is the duplication the epic exists to erase.

The six (the ratchet set):

- `src/features/diff/components/toolbar/Dropdown.tsx` — a select
- `src/features/diff/components/toolbar/ViewSettingsDropdown.tsx` — a composite settings menu (3 floating instances)
- `src/features/diff/components/toolbar/PriorityPlus.tsx` — an overflow menu
- `src/features/terminal/components/TerminalContextMenu.tsx` — a context menu (cursor-anchored, externally controlled)
- `src/features/diff/components/FinishFeedbackPopover.tsx` — a dialog card
- `src/features/diff/components/toolbar/DiffChipToolbar.tsx` — a confirm dialog

## 2. Goals / non-goals

**Goals**

1. One shared floating substrate; no feature component touches `@floating-ui/react` directly.
2. Three canonical public primitives — `Dropdown` (select), `Menu` (generic menu, incl. context-menu mode), `Popover` (arbitrary card).
3. Migrate all six consumers; delete all six file-level lint disables (ratchet 6 → 0).
4. Encode the boundary as lint so it cannot regress, and document the contracts (the VIM-117 three-place playbook).

**Non-goals / explicit deltas**

- **Behaviour is preserved.** Each surface behaves as it does today (see the §7 behaviour matrix — defaults exist, consumers opt out where their current behaviour differs).
- **One intended visual delta:** the drifted `TerminalContextMenu` chrome (`/90 rounded-md`, no border) converges onto the canonical glass surface (`/95 rounded-lg border`). Converging drift is the point of the epic; this is the single deliberate pixel change and should be surfaced to the user.
- **Deferred a11y change:** the current diff `Dropdown` uses `role="menu"`. The migration **preserves `role="menu"`**; switching a single-select to `role="listbox"` is a correct but separate a11y improvement (its own PR + tests), not part of this refactor.
- `Tooltip` is **not** re-homed or rebuilt. It stays flat at `@/components/Tooltip` (#440) and keeps its direct `@floating-ui` import (grandfathered in ring 1, §6) until it optionally adopts the substrate later.
- The other epic candidates (tabs/switchers, chips/badges, icon buttons) are out of scope.

## 3. Architecture — three layers

```
src/components/   ── base UI lib
│
│   ┌ base/   (package-private — must not be imported from src/features/**)
│   │   floating/
│   │     useFloatingSurface()  ── positioning + dismiss + role + list-nav   (imports @floating-ui)
│   │     SurfacePanel          ── portal + glass chrome + optional focus mgr (imports FloatingPortal)
│   │     GLASS_SURFACE         ── the one canonical glass-panel className
│   │   OptionList              ── shared option-row renderer (used by Dropdown + Menu.Submenu)
│   │
│   ├ Dropdown.tsx   ── select: value + options → onChange   (role=menu, preserved)   PUBLIC, flat
│   ├ Menu.tsx       ── generic compound menu + context mode                           PUBLIC, flat
│   └ Popover.tsx    ── arbitrary-content dialog card        (role=dialog)             PUBLIC, flat
│
└ features/   ── consumers · compose Dropdown/Menu/Popover, never import @floating-ui or base/*
```

**Why this split** (flat public primitives + hidden substrate):

- **Repo consistency** — `Tooltip` is itself a floating-ui primitive and already sits flat at `@/components/Tooltip`. Grouping `Popover`/`Menu`/`Dropdown` under a folder while `Tooltip` stays flat would be inconsistent, and moving `Tooltip` would re-churn every import #440 just rewrote. `src/components/` is flat by default; `sidebar/` is one tightly-coupled unit, not a "related concepts" bucket.
- **Industry pattern** — Radix ships each overlay primitive as a separate package over a shared internal positioning engine (`@radix-ui/react-popper`) plus `react-dismissable-layer` / `react-portal`. shadcn keeps them flat in `components/ui/*.tsx`. Our `base/floating` is those internal packages collapsed; we do not need Radix's split at six consumers (YAGNI).
- **Deep modules / information hiding** (`rules/common/design-philosophy.md`) — the substrate is a deep module: a small surface hiding floating-ui sequencing, the dismiss policy, portal escaping, focus management, and the glass chrome.

## 4. Module layout & the `base/` convention

```
src/components/
├── Tooltip.tsx · Dropdown.tsx · Menu.tsx · Popover.tsx   ← flat PUBLIC primitives (peers)
├── GlassSurface.tsx · ResizeHandle.tsx · StatusBar.tsx · sidebar/
└── base/                          ← package-private substrate
    ├── OptionList.tsx               ← shared option-row renderer (Dropdown + Menu.Submenu)
    └── floating/
        ├── useFloatingSurface.ts
        ├── SurfacePanel.tsx
        └── glassSurface.ts          ← GLASS_SURFACE className constant
```

**`base/` convention** (to be documented in `rules/typescript/coding-style`):

> `src/components/base/**` is internal substrate that wraps a third-party engine (or owns low-level behaviour) and **must not be imported from `src/features/**`**. Everything under `base/` is package-private to `src/components/`. Features compose the public primitives instead.

Naming the tier `base/` (not `floating/`) keeps the lint glob a durable `@/components/base/**`, auto-fences any future substrate, and avoids the "why isn't `Popover` in `floating/`?" confusion. No barrel: public primitives are imported directly via `@/components/*` (consistent with #440).

## 5. Public contracts (APIs)

### 5.1 `base/` substrate (package-private)

```ts
// floating/useFloatingSurface.ts — the behaviour. Imports @floating-ui.
function useFloatingSurface(opts: {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor?: HTMLElement | { x: number; y: number } | null // element OR virtual point (context menus)
  placement?: Placement // default 'bottom-start'
  role?: 'menu' | 'listbox' | 'dialog' // default 'menu'
  middleware?: { autoUpdate?: boolean; ancestorScroll?: boolean } // defaults true/true; opt out per consumer
  dismissWhen?: (event: MouseEvent) => boolean // outsidePress predicate; default = always dismiss
  list?: {
    ref: MutableRefObject<(HTMLElement | null)[]>
    activeIndex: number | null
    onNavigate: (index: number | null) => void
    loop?: boolean
    disabledIndices?: number[]
  }
}): {
  refs; floatingStyles; context // context is exposed so SurfacePanel can drive FloatingFocusManager
  getReferenceProps; getFloatingProps; getItemProps
}

// floating/SurfacePanel.tsx — the chrome. Renders FloatingPortal + glass div, optionally focus-managed.
interface SurfacePanelProps {
  setFloating: (node: HTMLElement | null) => void
  style: CSSProperties
  context: FloatingContext
  width?: number
  focus?: false | { initialFocus?: number; modal?: boolean } // FloatingFocusManager; default false
  children: ReactNode
  // ...getFloatingProps() spread through. NO arbitrary className — GLASS_SURFACE is the single chrome.
}
```

`SurfacePanel` always renders the canonical `GLASS_SURFACE` (no `className` escape hatch — that would reopen drift). The substrate is a hook + panel pair, not one component: `Dropdown`/`Menu` must wire both the trigger (`getReferenceProps`) and each item (`getItemProps`), which a single `anchor`-prop component cannot expose without becoming a shallow pass-through.

`base/floating` also re-exports the single floating-ui type the public primitives need (`export type { Placement } from '@floating-ui/react'`), so `Dropdown`/`Menu`/`Popover` type their `placement` prop via `@/components/base/floating` and never import `@floating-ui/react` themselves — making the §6 ring-1 invariant literally true.

### 5.2 `Dropdown<T>`

```ts
interface DropdownProps<T extends string | number> {
  value: T
  options: readonly DropdownOption<T>[] // { value, label, description? } — shared type
  onChange: (next: T) => void
  placement?: Placement
  width?: number
  label?: string // built-in select trigger
  leadingIcon?: string
  renderTrigger?: (a: { ref; props; open: boolean; current: DropdownOption<T> | undefined }) => ReactElement
}
```

Renders its option list via `base/OptionList`. Keeps `role="menu"`/`menuitem` (the current behaviour) — see §2 deferred a11y.

### 5.3 `Menu` (compound + context mode)

A generic menu on the substrate, exposed as compound subcomponents so consumers extend it by composition (no widening prop union):

```ts
// Anchored (click trigger) OR controlled context-menu mode:
<Menu trigger={ReactElement} placement?={Placement} width?={number} aria-label?={string}>…</Menu>
<Menu.Context position={{ x: number; y: number }} open={boolean} onOpenChange={(open) => void} aria-label={string}>…</Menu.Context>

// Rows:
<Menu.Section label?={string}>…</Menu.Section>
<Menu.Item icon?={string} shortcut?={ShortcutInput} disabled?={boolean} onSelect={() => void}>…</Menu.Item>
<Menu.Checkbox icon?={string} checked={boolean} onChange={(next: boolean) => void}>…</Menu.Checkbox>
<Menu.Submenu label icon?={string} value options onChange />   // shares base/OptionList with Dropdown
```

- **Context mode** (`Menu.Context`) covers `TerminalContextMenu`: a virtual cursor anchor (`position`), external open control, non-modal focus management, and disabled-item navigation — all forwarded to `useFloatingSurface`/`SurfacePanel`, so the feature never imports `base/*`.
- **Submenu coordination** (covers `ViewSettingsDropdown`): `Menu` owns submenu open-state — **only one submenu open at a time**. Each submenu's portal root registers with the parent `Menu`'s `dismissWhen` predicate so an outside-press inside a submenu does **not** close the parent; selecting a submenu option closes **only** the submenu; opening one submenu closes the other. `Menu.Submenu` does **not** embed a public `Dropdown` — both render through the shared `base/OptionList`, while `Menu` owns the submenu lifecycle and dismissal.

### 5.4 `Popover`

```ts
interface PopoverProps {
  anchor: HTMLElement | null
  open: boolean
  onOpenChange: (open: boolean) => void
  placement?: Placement
  width?: number
  'aria-label': string // role=dialog → accessible name required
  children: ReactNode // consumer owns the body; rendered on GLASS_SURFACE, focus-managed (modal)
}
```

## 6. Governance — the three import rings

Each ring is a `no-restricted-imports` block extending #440's existing rules (flat config, `files`-scoped).

**Ring 1 — `@floating-ui/react` only under `base/floating` (+ grandfathered `Tooltip`).** Widen #440's features-only ban to all of `src/`, with explicit exceptions via `ignores` (a severity-only later override would *not* clear the banned `paths` — verified against ESLint 9.39.x flat-config merge semantics). Type imports are **not** exempt (no `allowTypeImports`) — `base/floating` re-exports the one type public primitives need (see §5.1), so `@floating-ui/react` stays fully confined:

```js
{
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/components/base/floating/**', 'src/components/Tooltip.tsx'], // Tooltip grandfathered until it adopts the substrate
  rules: {
    '@typescript-eslint/no-restricted-imports': ['error', {
      paths: [{ name: '@floating-ui/react', message: 'Use a primitive from @/components, or extend base/floating — do not hand-roll a floating surface.' }],
    }],
  },
}
```

**Ring 2 — `@/components/base/**` only within `src/components/`.** Ban its import from every module outside `src/components/` — not just features (so `App.tsx`, `hooks/`, `lib/`, `theme/` are covered too) — alias + relative spellings, mirroring #440's `regex` rule for the canonical spelling:

```js
{
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/components/**'], // base/ is package-private to ALL of src/components, not only fenced from features
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{ group: ['@/components/base', '@/components/base/**', '**/components/base', '**/components/base/**'],
        message: 'src/components/base is package-private — compose Dropdown/Menu/Popover instead.' }],
    }],
  },
}
```

**Ring 3 — features use the public primitives.** This is a **governance consequence**, not lint-enforced: rings 1–2 stop features from importing floating-ui or `base/*`, but they cannot positively force "only public primitives" (a feature could still hand-roll a non-floating-ui portal). The existing `react/forbid-dom-props` `title=` ban stays. (A future hardening could restrict `react-dom`'s `createPortal` in `src/features/**`; out of scope here.)

As each consumer migrates, its file-level `@floating-ui` disable is deleted in the same PR. When all six are gone, ring 1 stands with `Tooltip` as the only grandfathered exception.

## 7. Migration map & behaviour matrix (ratchet 6 → 0)

| #   | File                                   | Today              | Target                                   | Ratchet |
| --- | -------------------------------------- | ------------------ | ---------------------------------------- | ------- |
| 1   | `diff/toolbar/Dropdown.tsx`            | hand-rolled select | promote → `@/components/Dropdown`        | 6 → 5   |
| 2   | `diff/toolbar/ViewSettingsDropdown.tsx`| composite menu     | `Menu` + `Menu.Submenu`                  | 5 → 4   |
| 3   | `diff/toolbar/PriorityPlus.tsx`        | overflow menu      | `Menu`                                   | 4 → 3   |
| 4   | `terminal/TerminalContextMenu.tsx`     | context menu       | `Menu.Context`                           | 3 → 2   |
| 5   | `diff/FinishFeedbackPopover.tsx`       | dialog card        | `Popover`                                | 2 → 1   |
| 6   | `diff/toolbar/DiffChipToolbar.tsx` (confirm) | confirm dialog | `Popover`                              | 1 → 0   |

**Behaviour matrix** — the substrate defaults to `placement: bottom-start`, `autoUpdate: true`, `ancestorScroll: true`, `role: menu`, no focus manager. Consumers **opt out** where their current behaviour differs; exact values are ported verbatim from each file in its migration PR. Known non-defaults to preserve:

| Consumer            | placement     | autoUpdate | scroll-dismiss        | focus manager        | role   |
| ------------------- | ------------- | ---------- | --------------------- | -------------------- | ------ |
| Dropdown (diff)     | bottom-start  | yes        | ancestorScroll        | none (list-nav)      | menu   |
| ViewSettings        | bottom-end    | yes        | ancestorScroll        | none                 | menu   |
| PriorityPlus        | (port verbatim) | (port)   | **manual window scroll listener** | (port)   | menu   |
| TerminalContextMenu | bottom-start (+flip fallbacks) | **no** | **none** | **FloatingFocusManager, non-modal** | menu |
| FinishFeedbackPopover | bottom-start | yes       | ancestorScroll        | FloatingFocusManager (initialFocus −1) | dialog |
| DiffChipToolbar confirm | (port verbatim) | (port) | **plain dismiss (no ancestorScroll)** | (port) | dialog |

**Mechanics carried from VIM-117:** preserve each trigger's `aria-label`; keep the disabled-trigger wrapper where it applies; no visual change except the §2 terminal-chrome convergence.

## 8. Documentation deliverables (the three-place playbook)

1. `docs/design/UNIFIED.md` — new contract sections (mirroring §5.6 Tooltip): `Dropdown`, `Menu` (incl. `Menu.Context`), `Popover`, plus a note that `base/` is internal.
2. `rules/typescript/coding-style/CLAUDE.md` "Shared UI Primitives" — add the three primitives and the `base/` convention definition.
3. `AGENTS.md` — extend the unified-primitives line: floating surfaces have public primitives; `@floating-ui/react` belongs only in `src/components/base/floating` (+ grandfathered `Tooltip`).

## 9. Sequencing (stacked PRs on `feat/floating-surface-primitives`)

- **PR1** — `base/floating` (`useFloatingSurface` + `SurfacePanel` + `GLASS_SURFACE`) + `base/OptionList` + `Dropdown` + migrate `diff/toolbar/Dropdown` (consumer #1) + ring-1 (with Tooltip grandfather) + ring-2 + doc stubs. Ratchet 6 → 5.
- **PR2** — `Menu` (compound + `Menu.Context`) + migrate `ViewSettingsDropdown`, `PriorityPlus`, `TerminalContextMenu`. Ratchet 5 → 2.
- **PR3** — `Popover` + migrate `FinishFeedbackPopover` + `DiffChipToolbar` confirm; finalize the three docs. Ratchet 2 → 0.
- **Final** — `feat/floating-surface-primitives` → `main` (part of VIM-116).

## 10. Out of scope

- `Tooltip` re-homing/rebuild; the `Dropdown` `role=listbox` a11y change; the other epic candidates (tabs, chips, buttons).

## 11. Done when

- `base/floating` + `base/OptionList` and the three public primitives exist under `src/components/`.
- All six consumers render through `Dropdown` / `Menu` / `Popover`; all six file-level `@floating-ui` disables deleted.
- `@floating-ui/react` appears only under `src/components/base/floating/**` and the grandfathered `src/components/Tooltip.tsx`; rings 1–2 green.
- The §7 behaviour matrix is honoured (no behaviour change beyond the §2 terminal-chrome convergence).
- `UNIFIED.md`, coding-style, and `AGENTS.md` updated.
- `npm run lint`, `type-check`, `test`, `build` green; `codex review --base main` clean.

## Appendix — the key fork (IDEA)

### Where to draw the abstraction

Recommended: a hidden substrate (`base/floating` + `base/OptionList`) under flat public `Dropdown` / `Menu` / `Popover`; `ViewSettingsDropdown` extends `Menu` by composition; `Menu` owns submenu lifecycle.

💡 IDEA

- **I — Intent:** erase the duplicated floating mechanics and the drifting glass className behind one deep substrate, and give features intention-revealing primitives so no one hand-rolls a popover again.
- **D — Danger:** if `Menu` absorbs sections + checkboxes + submenus + cross-popover dismiss as a fat prop union, the god-component relocates from `ViewSettingsDropdown` into `Menu`. Mitigation: compound subcomponents keep `Menu`'s interface narrow; `Menu` owns submenu lifecycle; `Dropdown` and `Menu.Submenu` share `base/OptionList` rather than one embedding the other.
- **E — Explain:** the six share a _surface_, not a _shape_ — positioning/dismiss/portal/chrome is the common layer; content semantics differ. The cut belongs at the surface (the `@floating-ui` ratchet fences exactly that), with separate public primitives above it, matching Radix/shadcn and the flat `Tooltip`.
- **A — Alternatives:** a single configurable `Dropdown` with a `mode` prop reaches the same dedup via conditionals + props explosion — rejected (shallow module, wide interface). Grouping all four under `floating/` — rejected for inconsistency with the flat `Tooltip`.

**Sources:** [Radix overlay components (DeepWiki)](https://deepwiki.com/radix-ui/primitives/3.1-overlay-components) · [Radix `packages/react` (GitHub)](https://github.com/radix-ui/primitives/tree/main/packages/react) · [shadcn/ui components](https://ui.shadcn.com/docs/components) · `rules/common/design-philosophy.md`.
