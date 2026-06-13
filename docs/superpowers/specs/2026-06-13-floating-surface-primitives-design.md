# Floating Surface Primitives — Design Spec

**Status:** Draft (pending codex review + user approval)
**Epic:** VIM-116 — Unified UI component library. Follows the VIM-117 Tooltip pilot ([#440](https://github.com/winoooops/vimeflow/pull/440)).
**Date:** 2026-06-13

## 1. Context & problem

VIM-117 converged every tooltip on the shared `Tooltip` and, crucially, **pre-staged this extraction**: it fenced `@floating-ui/react` to `src/components/` and grandfathered the six existing hand-rolled floating surfaces with file-level lint disables — a ratchet frozen at six, where a seventh is a lint error.

Those six each hand-roll the same substrate: `useFloating([offset(4), flip(), shift({ padding: 8 })])` + `autoUpdate`, `useDismiss({ ancestorScroll: true })`, `useRole`, `FloatingPortal`, and a glassmorphic panel className. The className is **already drifting** — `Dropdown`/`ViewSettingsDropdown` use `bg-surface-container-high/95 … rounded-lg`; `TerminalContextMenu` uses `/90 … rounded-md`. `ViewSettingsDropdown` even imports `DropdownOption` from `Dropdown` and then re-implements the option list by hand. This is exactly the duplication the epic exists to erase.

The six (the ratchet set):

- `src/features/diff/components/toolbar/Dropdown.tsx` — a select
- `src/features/diff/components/toolbar/ViewSettingsDropdown.tsx` — a composite settings menu
- `src/features/diff/components/toolbar/PriorityPlus.tsx` — an overflow menu
- `src/features/terminal/components/TerminalContextMenu.tsx` — a context menu
- `src/features/diff/components/FinishFeedbackPopover.tsx` — a dialog card
- `src/features/diff/components/toolbar/DiffChipToolbar.tsx` — a confirm dialog

## 2. Goals / non-goals

**Goals**

1. One shared floating substrate; no feature component touches `@floating-ui/react` directly.
2. Three canonical public primitives — `Dropdown` (select), `Menu` (generic menu), `Popover` (arbitrary card).
3. Migrate all six consumers; delete all six file-level lint disables (ratchet 6 → 0).
4. Encode the boundary as lint so it cannot regress, and document the contracts (the VIM-117 three-place playbook).

**Non-goals**

- No behaviour/UX change. This is a pure refactor — each surface looks and behaves as it does today.
- `Tooltip` is **not** re-homed or rebuilt. It already lives flat at `@/components/Tooltip` (#440) and may optionally adopt the substrate later; out of scope here.
- The other epic candidates (tabs/segmented switchers, chips/badges, icon buttons) are out of scope.

## 3. Architecture — three layers

```
src/components/   ── base UI lib · the ONLY place @floating-ui/react is imported
│
│   ┌ base/floating/  (package-private substrate)
│   │   useFloatingSurface()  ── positioning + dismiss + role + list-nav  (imports @floating-ui)
│   │   SurfacePanel          ── portal + glass chrome                    (imports FloatingPortal)
│   │   GLASS_SURFACE         ── the one glass-panel className constant
│   │
│   ├ Dropdown.tsx   ── select: value + options → onChange         (role=listbox)   PUBLIC, flat
│   ├ Menu.tsx       ── generic compound menu (Section/Item/Checkbox/Submenu)        PUBLIC, flat
│   └ Popover.tsx    ── arbitrary-content dialog card             (role=dialog)      PUBLIC, flat
│
└ features/   ── consumers · compose Dropdown/Menu/Popover, never import floating-ui or base/*
```

**Why this split** (flat public primitives + hidden substrate):

- **Repo consistency** — `Tooltip` is itself a floating-ui primitive and already sits flat at `@/components/Tooltip`. Grouping `Popover`/`Menu`/`Dropdown` under a folder while `Tooltip` stays flat would be inconsistent, and moving `Tooltip` would re-churn every import #440 just rewrote. `src/components/` is flat by default; `sidebar/` is the lone subfolder and it is one tightly-coupled unit, not a "related concepts" bucket.
- **Industry pattern** — Radix ships each overlay primitive as a separate package (`dropdown-menu`, `popover`, `tooltip`) over a shared internal positioning engine (`@radix-ui/react-popper`) plus `react-dismissable-layer` / `react-portal`. shadcn keeps them flat in `components/ui/*.tsx` with compound subcomponents. Our `useFloatingSurface` + `SurfacePanel` is those internal packages collapsed into two files — we do not need Radix's split at six consumers (YAGNI).
- **Deep modules / information hiding** (`rules/common/design-philosophy.md`) — the substrate is a deep module: a small surface (`useFloatingSurface`, `SurfacePanel`) hiding the floating-ui sequencing, the `ancestorScroll` dismiss fix, portal escaping, and the glass chrome. Features stop sequencing low-level steps; they consume an intention-revealing primitive.

## 4. Module layout & the `base/` convention

```
src/components/
├── Tooltip.tsx · Dropdown.tsx · Menu.tsx · Popover.tsx   ← flat PUBLIC primitives (peers)
├── GlassSurface.tsx · ResizeHandle.tsx · StatusBar.tsx · sidebar/
└── base/
    └── floating/                ← package-private substrate
        ├── useFloatingSurface.ts
        ├── SurfacePanel.tsx
        └── glassSurface.ts        ← GLASS_SURFACE className constant
```

**`base/` convention** (to be documented in `rules/typescript/coding-style`):

> `src/components/base/**` is internal substrate that wraps a third-party engine (or owns low-level behaviour) and **must not be imported from `src/features/**`**. Everything under `base/` is package-private to `src/components/`. Features compose the public primitives instead.

Naming the tier `base/` (not `floating/`) keeps the lint glob a durable `@/components/base/**`, which auto-fences any future substrate, and avoids the "why isn't `Popover` in `floating/`?" confusion — `base/` is unambiguously "foundation layer, not for feature use."

No barrel: consistent with #440, public primitives are imported directly via the `@/components/*` alias (`@/components/Dropdown`), not through an `index.ts`.

## 5. Public contracts (APIs)

### 5.1 `base/floating` (package-private)

```ts
// useFloatingSurface.ts — the behaviour. One of the two @floating-ui importers.
function useFloatingSurface(opts: {
  open: boolean
  onOpenChange: (open: boolean) => void
  placement?: Placement // default 'bottom-start'
  role?: 'menu' | 'listbox' | 'dialog' // default 'menu'
  ancestorScroll?: boolean // default true — the diff-pane scroll fix, centralized
  dismissWhen?: (event: MouseEvent) => boolean // outsidePress predicate; default = always dismiss
  list?: {
    ref: MutableRefObject<(HTMLElement | null)[]>
    activeIndex: number | null
    onNavigate: (index: number | null) => void
    loop?: boolean
  }
}): {
  refs: { setReference; setFloating }
  floatingStyles: CSSProperties
  context: FloatingContext
  getReferenceProps: (user?: Record<string, unknown>) => Record<string, unknown>
  getFloatingProps: (user?: Record<string, unknown>) => Record<string, unknown>
  getItemProps: (user?: Record<string, unknown>) => Record<string, unknown>
}

// SurfacePanel.tsx — the chrome. Renders FloatingPortal + the glass div.
interface SurfacePanelProps {
  setFloating: (node: HTMLElement | null) => void
  style: CSSProperties
  width?: number
  bare?: boolean // skip GLASS_SURFACE; consumer owns the surface (rare)
  children: ReactNode
  // ...getFloatingProps() spread through
}
```

The substrate is a hook + panel pair, not a single all-in-one component: `Dropdown`/`Menu` need to wire both the trigger (`getReferenceProps`) and each item (`getItemProps`), which a single `anchor`-prop component cannot expose without becoming a shallow pass-through. This is a deliberate refinement of the earlier "one `FloatingSurface` component" sketch.

### 5.2 `Dropdown<T>`

```ts
interface DropdownProps<T extends string | number> {
  value: T
  options: readonly DropdownOption<T>[] // { value, label, description? } — the shared type
  onChange: (next: T) => void
  placement?: Placement
  width?: number
  label?: string // built-in select trigger
  leadingIcon?: string
  renderTrigger?: (a: {
    // OR a custom trigger, so a Dropdown can be embedded as a Menu row
    ref: (node: HTMLElement | null) => void
    props: Record<string, unknown>
    open: boolean
    current: DropdownOption<T> | undefined
  }) => ReactElement
}
```

### 5.3 `Menu` (compound)

A generic menu built on the substrate, exposed as compound subcomponents so consumers extend it by composition (no widening prop union):

```ts
<Menu trigger={ReactElement} placement?={Placement} width?={number} aria-label?={string}>
  <Menu.Section label?={string}> … </Menu.Section>
  <Menu.Item icon?={string} shortcut?={ShortcutInput} disabled?={boolean} onSelect={() => void}>…</Menu.Item>
  <Menu.Checkbox icon?={string} checked={boolean} onChange={(next: boolean) => void}>…</Menu.Checkbox>
  <Menu.Submenu label icon?={string} value options onChange />   // embeds a Dropdown as a row
</Menu>
```

`Menu.Submenu` is where `Dropdown` is reused inside `Menu` — the two interlock instead of duplicating. Cross-popover dismiss (the current `[data-view-sub-menu]` predicate) is handled inside `Menu` via the substrate's `dismissWhen`, not re-derived per consumer.

### 5.4 `Popover`

```ts
interface PopoverProps {
  anchor: HTMLElement | null
  open: boolean
  onOpenChange: (open: boolean) => void
  placement?: Placement
  width?: number
  'aria-label': string // role=dialog → an accessible name is required
  children: ReactNode // consumer owns the body
}
```

## 6. Governance — the three import rings

Each ring is a `no-restricted-imports` block extending #440's existing rules (same flat-config, `files`-scoped mechanism).

1. **`@floating-ui/react` → only `src/components/base/floating/**`.** Today #440 bans it in `src/features/**` only. Tighten: ban across `src/**`, then re-allow in a `files: ['src/components/base/floating/**']` override. Type-imports stay allowed everywhere.
2. **`@/components/base/**` → only within `src/components/**`.** Ban its import (alias and relative spellings) from `src/features/**`. Mirror #440's `regex` rule so the alias spelling is the only one that passes.
3. **Features → only the public primitives.** Enforced transitively by rings 1–2 (a feature cannot build a floating surface except through `Dropdown`/`Menu`/`Popover`). The existing `react/forbid-dom-props` `title=` ban stays.

As each consumer migrates, its file-level `@floating-ui` disable is deleted in the same PR. When all six are gone, ring 1 stands with zero feature exceptions.

## 7. Migration map (ratchet 6 → 0)

| #   | File                              | Today              | Target                         | Ratchet |
| --- | --------------------------------- | ------------------ | ------------------------------ | ------- |
| 1   | `diff/toolbar/Dropdown.tsx`       | hand-rolled select | promote → `@/components/Dropdown` | 6 → 5   |
| 2   | `diff/toolbar/ViewSettingsDropdown.tsx` | composite menu | `Menu` (compound)              | 5 → 4   |
| 3   | `diff/toolbar/PriorityPlus.tsx`   | overflow menu      | `Menu`                         | 4 → 3   |
| 4   | `terminal/TerminalContextMenu.tsx` | context menu      | `Menu` (virtual anchor via `useFloatingSurface`) | 3 → 2 |
| 5   | `diff/FinishFeedbackPopover.tsx`  | dialog card        | `Popover`                      | 2 → 1   |
| 6   | `diff/toolbar/DiffChipToolbar.tsx` (confirm) | confirm dialog | `Popover`                | 1 → 0   |

**Migration mechanics carried from the VIM-117 playbook:** preserve each trigger's `aria-label` (a primitive is not an accessible-name substitute); keep the disabled-trigger wrapper rule where it applies; preserve `ancestorScroll` behaviour (now a substrate default); no visual change (port the exact placement/width per call site).

## 8. Documentation deliverables (the three-place playbook)

1. `docs/design/UNIFIED.md` — new contract sections (mirroring §5.6 Tooltip): `Dropdown`, `Menu`, `Popover`, plus a note that `base/floating` is internal.
2. `rules/typescript/coding-style/CLAUDE.md` "Shared UI Primitives" — add the three primitives and the `base/` convention definition.
3. `AGENTS.md` — extend the unified-primitives line: floating surfaces now have public primitives; `@floating-ui/react` belongs only in `src/components/base/floating`.

## 9. Sequencing (stacked PRs on `feat/floating-surface-primitives`)

- **PR1** — `base/floating` (`useFloatingSurface` + `SurfacePanel` + `GLASS_SURFACE`) + `Dropdown` + migrate `diff/toolbar/Dropdown` (consumer #1) + ring-1 tighten + ring-2 + doc stubs. Ratchet 6 → 5.
- **PR2** — `Menu` (compound) + migrate `ViewSettingsDropdown`, `PriorityPlus`, `TerminalContextMenu`. Ratchet 5 → 2.
- **PR3** — `Popover` + migrate `FinishFeedbackPopover` + `DiffChipToolbar` confirm; finalize the three docs. Ratchet 2 → 0.
- **Final** — `feat/floating-surface-primitives` → `main` (Closes the sub-issue once it exists; part of VIM-116).

## 10. Out of scope

- `Tooltip` re-homing or rebuild (stays flat; optional substrate adoption later).
- Any behaviour/UX change.
- The other epic candidates (tabs, chips/badges, icon buttons).

## 11. Done when

- `base/floating` (hook + panel + constant) and the three public primitives exist under `src/components/`.
- All six consumers render through `Dropdown` / `Menu` / `Popover`; all six file-level `@floating-ui` disables deleted.
- The three import rings are green; `@floating-ui/react` appears only under `src/components/base/floating/**`.
- `UNIFIED.md`, coding-style, and `AGENTS.md` updated.
- `npm run lint`, `type-check`, `test`, `build` green; `codex review --base main` clean.

## Appendix — the key fork (IDEA)

### Where to draw the abstraction

Recommended: a hidden substrate (`base/floating`) under flat public `Dropdown` / `Menu` / `Popover`; `ViewSettingsDropdown` extends `Menu` by composition.

💡 IDEA

- **I — Intent:** erase the duplicated floating mechanics and the drifting glass className behind one deep substrate, and give features three intention-revealing primitives so no one hand-rolls a popover again.
- **D — Danger:** if `Menu` must absorb sections + checkbox rows + nested sub-dropdowns + cross-popover dismiss as a fat prop union, the god-component just relocates from `ViewSettingsDropdown` into `Menu`. Mitigation: compound subcomponents keep `Menu`'s interface narrow; each part is small and independently testable.
- **E — Explain:** the six share a _surface_, not a _shape_ — positioning/dismiss/portal/chrome is identical; content semantics differ. So the cut belongs at the surface (the `@floating-ui` ratchet already fences exactly that layer), with separate public primitives above it, matching Radix/shadcn and the existing flat `Tooltip`.
- **A — Alternatives:** a single configurable `Dropdown` with a `mode` prop reaches the same dedup via conditionals and a props explosion — rejected (shallow module, wide interface). Grouping all four under `floating/` was rejected for inconsistency with the flat `Tooltip` and unnecessary path depth.

**Sources:** [Radix overlay components (DeepWiki)](https://deepwiki.com/radix-ui/primitives/3.1-overlay-components) · [Radix `packages/react` (GitHub)](https://github.com/radix-ui/primitives/tree/main/packages/react) · [shadcn/ui components](https://ui.shadcn.com/docs/components) · `rules/common/design-philosophy.md` (deep modules, interface discipline).
