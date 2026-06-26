# Variant styling: `tailwind-variants` (`tv()`)

**Status:** Accepted (VIM-124 button primitives; spec `docs/superpowers/specs/2026-06-14-button-primitives-design.md`)

## Context

VIM-124 introduces the first shared component family with a real variant matrix — `Button` / `IconButton` / `ToolbarButton` over a `base/button` substrate, with a `variant` × `size` × `shape` axis plus an attribute-driven active state (`aria-pressed` / `aria-expanded`). The substrate needs one declarative source that maps those axes to Tailwind classes, derives the prop types, and merges a layout `className` from call sites without conflicts. This is the pattern future primitives (VIM-125 tabs/segmented, VIM-126 chips) will reuse, so the choice is infra-level, not one-off.

## Options considered

1. **Hand-rolled function** — `Record<Variant, string>` maps + string concatenation (the spec's first draft).
2. **`tailwind-variants` (`tv()`)** — declarative `variants` / `compoundVariants` / `defaultVariants`, `VariantProps` for types, bundled `tailwind-merge`.
3. **`class-variance-authority` (`cva`)** — the earlier, lighter variant library.

## Decision

Adopt **`tailwind-variants@^3` + `tailwind-merge@^3`** (the latter is a peer dep) as runtime dependencies. `buttonVariants` is a `tv()` definition; the public components type their props from `VariantProps<typeof buttonVariants>` (`Pick`ed down to `variant`/`size`; `shape` stays internal).

## Justification

1. **Declarative + less code.** `compoundVariants` expresses the shape×size geometry directly; no nested `Record` maps or manual default handling.
2. **Types for free.** `VariantProps` keeps the prop union in lockstep with the `tv()` config — no second hand-maintained `ButtonVariant`/`ButtonSize` union that can drift.
3. **`tailwind-merge` removes a real hazard.** The hand-rolled draft's `danger` case had a class-order bug (Tailwind utility order in the generated CSS, not the class string, decides the winner). `tailwind-merge` resolves conflicts deterministically, so `danger` is a clean variant and the layout `className` merges safely.
4. **Tailwind v4 supported.** Peer `tailwind-merge >= 3` is the v4 line; the repo is on `@tailwindcss/postcss ^4`.
5. **Verified against our custom tokens.** A pre-adoption smoke test confirmed `tailwind-merge` keeps both `text-[13px]` (font-size) and `text-on-surface-muted` (color) — the one realistic mis-group risk — and merges a `class` passthrough.

## Alternatives rejected

- **Hand-rolled function.** Verbose (Record maps + concat), re-introduces the class-order hazard, and forces a separately-maintained type union. The declarative library is strictly less code for the same output.
- **`cva`.** No slots/compound-slots, requires wiring `tailwind-merge` separately, and `tailwind-variants` is the more featureful, actively-maintained successor that the team explicitly asked for. No reason to pick the lighter lib when the heavier one's features (compound variants, slots for future primitives) are exactly what the epic needs.

## Known risks & mitigations

- **`tailwind-merge` mis-grouping a future custom token.** Smoke-tested safe today; if a new semantic token misbehaves, fall back to `tv({...}, { twMerge: false })` (the variants are conflict-free by construction, so merge only matters for the layout `className`) or extend `twMergeConfig`.
- **Two new runtime deps.** Both small, widely used, and tree-shakeable; `tailwind-merge` would likely be pulled in anyway by any variant solution.
- **`tv()` drift into features.** Not lint-fenced (unlike `@floating-ui`); the convention is that `tv()` lives with the primitives in `src/components/**`. Revisit a ring only if features start hand-rolling variant sets.

## References

- <https://www.tailwind-variants.org>
- VIM-124 spec/plan under `docs/superpowers/`
- Prior UI-primitive decision: [`2026-04-22-tooltip-library.md`](./2026-04-22-tooltip-library.md)
