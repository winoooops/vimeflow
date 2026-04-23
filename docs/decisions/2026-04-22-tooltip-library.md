# Tooltip library: `@floating-ui/react`

**Date:** 2026-04-22
**Status:** Accepted
**Scope:** the `<Tooltip>` primitive and any future tooltip use. Does **not** preempt later decisions about popover/dropdown/dialog primitives.

## Context

We're adding a `<Tooltip>` primitive to the codebase, first used in:

1. `src/features/agent-status/components/ActivityEvent.tsx` — long event-body content currently CSS-truncated (`truncate` class). Hover should reveal the full body.
2. `src/features/workspace/components/IconRail.tsx` — short label tooltip already exists, hand-rolled with `useState` + `<div className="absolute ...">`. During this session we discovered it's invisible because the `<div>` paints behind the Sidebar's grid cell — pure stacking-context bug. Patched temporarily with `z-50` to validate the diagnosis.

The primitive must:

- Portal out of the layout tree so it can't be clipped or covered by sibling grid cells (the IconRail bug already shipped this regression once)
- Handle viewport edges (ActivityEvent body content is variable-height and can land near the bottom of the panel)
- Wire correct WAI-ARIA: `role="tooltip"`, `aria-describedby` on the trigger, ESC dismiss
- Stay on React 19 (current stack)

## Options considered

1. **Custom-built**, no dependencies — hand-roll React + Tailwind + manual position calc.
2. **`@radix-ui/react-tooltip`** — full headless tooltip from Radix Primitives.
3. **`@floating-ui/react`** — positioning library + composable hooks for state, focus, dismiss, role.

## Decision

**Option 3 — `@floating-ui/react`.** We add the dependency and write a thin (~60 LOC) wrapper at `src/components/Tooltip.tsx` that composes `useFloating` + `useHover` + `useFocus` + `useDismiss` + `useRole` + `useInteractions` + `<FloatingPortal>`, modeled on the [official Floating UI tooltip recipe](https://floating-ui.com/docs/tooltip).

## Justification

1. **No global provider needed.** Unlike Radix's `Tooltip.Provider`, Floating UI's hooks are local — no `App.tsx` restructuring or test-harness wrapping required.
2. **A11y solved without hand-rolling.** `useRole({ role: 'tooltip' })` + `useDismiss` give us the same WAI-ARIA correctness as Radix.
3. **Auto-flip / shift / collision detection out of the box.** ActivityEvent body can be many lines tall; hand-rolling viewport-edge handling is the wrong place to spend complexity.
4. **Smaller, more recently maintained dependency surface.** Floating UI: 48 open issues repo-wide, last push 2026-03-03 (~3 weeks stale at decision time), 11 packages installed. Radix: 801 open issues, last push 2026-02-13 (~10 weeks stale), 29 packages installed (12 internal `@radix-ui/*` subpackages).
5. **Avoids Radix's currently-open React 19 + dense-tooltip regression** ([radix-ui/primitives#3858](https://github.com/radix-ui/primitives/issues/3858)) — fires on pages with 50+ Popper-using components, which the activity feed will hit (a real session screenshot during this discussion already showed 22 events).
6. **Easy escape hatch.** Floating UI is a bag of hooks behind our wrapper. If we later want to switch to Radix or back to custom, only the wrapper changes; consumers stay stable.

## Alternatives rejected

### Option 1 — Custom-built (rejected)

Initially recommended on the assumption we could "punt on auto-flip and let call-sites pick a `side`." Reversed because:

- ActivityEvent body is variable-height and viewport-edge-sensitive — the punt isn't viable without re-implementing `computePosition`, which is exactly Floating UI's job.
- A real custom build that handled flip/shift would be larger than the Floating UI wrapper and would rediscover bugs Floating UI has already fixed.
- Zero-deps was attractive but the cost of writing-it-ourselves doesn't actually disappear — it migrates from `node_modules/` to `src/`, where it's harder to audit and easier to subtly break.

### Option 2 — `@radix-ui/react-tooltip` (rejected)

Strongest out-of-box DX, but:

- **Open R19 bug [#3858](https://github.com/radix-ui/primitives/issues/3858)** — `PopperAnchor` infinite-loop on pages with 50+ Popper components (Tooltip, Popover, DropdownMenu, HoverCard). Activity feed easily exceeds this.
- **12 internal subpackages → 29 npm packages installed** for our two call-sites. Disproportionate footprint.
- **Global `Tooltip.Provider` required**, including in tests.
- Supporting bugs at decision time: [#3799](https://github.com/radix-ui/primitives/issues/3799) (max update depth on R19), [#3043](https://github.com/radix-ui/primitives/issues/3043) (`asChild` throws on R19), [#2375](https://github.com/radix-ui/primitives/issues/2375) (provider causes every tooltip to re-render on hover).
- Repo cadence has slowed (last push 2026-02-13 at decision time).

## Known risks & mitigations

- **`useHover` regression** [floating-ui/floating-ui#3368](https://github.com/floating-ui/floating-ui/issues/3368) — close-on-hover misbehaves without `safePolygon`. Mitigation: enable `safePolygon` in our wrapper from day one.
- **Bundle cost** — ~10 kB min+gzip + 11 packages. Acceptable for a Tauri desktop target; revisit only if we add many more overlay primitives and want to consolidate.
- **Future overlay scope creep** — if we later need popover, dropdown, dialog, hover-card, we should re-evaluate Radix as a complete primitives suite vs. multiple Floating UI wrappers. **This decision applies to tooltip only.**
- **The IconRail `z-50` patch** is a temporary fix that lives in `src/features/workspace/components/IconRail.tsx` until that file migrates to the new `<Tooltip>` primitive. The migration is part of the same workstream as introducing the primitive.

## References

- Floating UI: [docs](https://floating-ui.com/docs/tooltip), [repo](https://github.com/floating-ui/floating-ui), [npm](https://www.npmjs.com/package/@floating-ui/react)
- Radix Tooltip: [repo](https://github.com/radix-ui/primitives), [npm](https://www.npmjs.com/package/@radix-ui/react-tooltip)
- Comparison source: [pkgpulse 2026: Floating UI vs Tippy vs Radix Tooltip](https://www.pkgpulse.com/blog/floating-ui-vs-tippyjs-vs-radix-tooltip-popover-2026)
