# Tooltip Primitive — Design

**Date:** 2026-04-23
**Status:** Approved (pending implementation)
**Decision record:** [`docs/decisions/2026-04-22-tooltip-library.md`](../../decisions/2026-04-22-tooltip-library.md) — chooses `@floating-ui/react`

## 1. Context

Two call-sites need a real tooltip:

1. **`src/features/agent-status/components/ActivityEvent.tsx:156`** — the event body is currently CSS-truncated (`truncate` class). Long bodies become `bash -c "…"` cut at one line. Hover should reveal the full body.
2. **`src/features/workspace/components/IconRail.tsx`** — already has a hand-rolled tooltip (`useState` + `<div className="absolute …">`). It was invisible in production because the absolutely-positioned `<div>` rendered into the Sidebar's grid cell and was painted over (no `z-index`). Patched temporarily with `z-50` (lines 42, 69) on 2026-04-22; the patch will be removed when this primitive replaces those blocks.

We currently have no shared tooltip primitive, no `@floating-ui/react` or Radix in `package.json`, and no portal pattern for overlays other than the CommandPalette's bespoke z-100 overlay.

## 2. Decision recap

Build a generic `<Tooltip>` primitive on `@floating-ui/react`. Migrate both call-sites to it in the same change, removing IconRail's hand-rolled implementation (and its temporary `z-50` patch) entirely. Full justification is in the decision record above; this spec assumes that decision.

## 3. Component contract

**Location:** `src/components/Tooltip.tsx` (flat — matches existing convention; refactor to a folder later if the primitive grows).
**Test:** `src/components/Tooltip.test.tsx` (co-located).

**Public API:**

```ts
interface TooltipProps {
  content: ReactNode // floating-side content; if null/undefined, primitive returns children unchanged
  children: ReactElement // single trigger element that can accept ref + interaction props
  placement?: Placement // re-uses Floating UI's Placement union directly; default 'top' (auto-flips on viewport edge)
  delayMs?: number // open delay in ms; default 250
  disabled?: boolean // short-circuits via Floating UI's `enabled` flag on each interaction hook
  maxWidth?: number // px cap on tooltip width; default 320
  className?: string // ADDITIVE utility classes only — see §5 for the contract
}
```

**Behavior contract:**

- **Trigger:** must be a single React element that can accept a `ref` and event-handler props. Existing refs on the trigger are merged via `useMergeRefs`.
- **Open trigger:** mouse hover (after `delayMs`) **or** keyboard focus on the trigger.
- **Close trigger:** mouse leave (immediate), trigger blur, or `Escape` key.
- **Positioning:** anchored to the trigger via Floating UI; auto-flips opposite if the chosen `placement` would clip; nudges inward if it would overflow horizontally.
- **Portal:** always portals to `document.body` via `<FloatingPortal>` — escapes any clipping or stacking context (this is the IconRail-bug-class fix).
- **Pointer-events:** the floating element is `pointer-events-none`. Tooltips are informational, not interactive.
- **Disabled / empty:** if `disabled` or `content == null`, the primitive returns `children` unchanged. Internally, every interaction hook is gated by an `enabled` flag (Floating UI's documented pattern), so no listeners are attached, no `cloneElement` runs, and no ref is injected into the trigger. Hooks themselves still execute (rules-of-hooks compliance), but the cost is negligible.

## 4. Internal composition

Single component using Floating UI's `enabled` flag pattern. Hooks always run, but each interaction hook gates its listeners on `enabled`. When disabled or content is empty, we return `children` unchanged after the hooks — no `cloneElement`, no ref injection into the trigger, no interaction props attached. The cost of running hooks for disabled tooltips is negligible (`useState(false)`, plus `useFloating` doing nothing without an open state, plus four interaction hooks returning empty prop-getters).

```tsx
export const Tooltip = ({
  content,
  children,
  placement = 'top',
  delayMs = 250,
  disabled = false,
  maxWidth = 320,
  className,
}: TooltipProps): ReactElement => {
  const enabled = !disabled && content != null && isValidElement(children)

  const [open, setOpen] = useState(false)

  const {
    refs,
    floatingStyles,
    context,
    placement: resolvedPlacement,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  })

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, {
      enabled,
      delay: { open: delayMs, close: 0 },
      handleClose: safePolygon(),
    }),
    useFocus(context, { enabled }),
    useDismiss(context, { enabled, escapeKey: true }),
    useRole(context, { enabled, role: 'tooltip' }), // also wires aria-describedby on trigger
  ])

  const childRef = isValidElement(children)
    ? (children.props as { ref?: Ref<unknown> }).ref
    : undefined
  const mergedRef = useMergeRefs([refs.setReference, childRef])

  if (!enabled) return children

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        ...getReferenceProps(children.props),
      })}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            data-placement={resolvedPlacement}
            style={{ ...floatingStyles, maxWidth }}
            className={`${TOOLTIP_CLASSES} ${className ?? ''}`.trim()}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
```

**Hook rationale:**

| Piece                             | Purpose                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `useFloating` + `autoUpdate`      | Owns open state + reanchors on scroll/resize.                                                                                                  |
| `offset(6)`                       | 6px gap between trigger and tooltip.                                                                                                           |
| `flip()`                          | Auto-swap to opposite side when chosen placement would clip — critical for ActivityEvent body near the panel's bottom edge.                    |
| `shift({ padding: 8 })`           | Nudge inward 8px from viewport edges.                                                                                                          |
| `useHover` + `safePolygon()`      | Hover trigger; `safePolygon` mitigates [floating-ui#3368](https://github.com/floating-ui/floating-ui/issues/3368) (close-on-hover regression). |
| `useFocus`                        | Keyboard a11y — opens on trigger focus.                                                                                                        |
| `useDismiss({ escapeKey: true })` | ESC closes any open tooltip.                                                                                                                   |
| `useRole({ role: 'tooltip' })`    | Wires `role="tooltip"` on floating element AND `aria-describedby` on trigger.                                                                  |
| `useMergeRefs`                    | Preserves any existing ref on the trigger.                                                                                                     |
| `<FloatingPortal>`                | Renders into `document.body` — solves the stacking-context bug class.                                                                          |

## 5. Visual contract

Per `docs/design/DESIGN.md:39-44`, "Floating elements (Modals, Tooltips, Command Palette) must utilize Glassmorphism." The primitive owns this baseline.

**`className` contract:** the consumer-supplied `className` is appended to the baseline (`${TOOLTIP_CLASSES} ${className ?? ''}`). It is intended for **additive** utility classes only — for example, a wider `max-w-[400px]` for a specific call-site, or a one-off `tracking-tight`. Overriding baseline visual properties (background, blur, shadow, padding, text color) is **misuse** — it produces non-deterministic results because Tailwind utilities have equal specificity, so the winner depends on stylesheet order rather than concat order. If a real "different look" need emerges (e.g. an error-tone tooltip), introduce a discrete `variant` enum prop instead of relying on `className` overrides. We can adopt `tailwind-merge` later if class-precedence problems become recurring.

```ts
const TOOLTIP_CLASSES =
  'pointer-events-none z-50 rounded-lg shadow-lg px-3 py-2 ' +
  'bg-surface-container-high/70 backdrop-blur-md backdrop-saturate-150 ' +
  'text-xs text-on-surface'
```

- `bg-surface-container-high/70` — glass fill at 70% (within DESIGN.md's 60–80% range).
- `backdrop-blur-md` — 12px blur (matches the lower end of DESIGN.md's 12–20px range).
- `backdrop-saturate-150` — 150% saturation per DESIGN.md.
- `z-50` — sits above standard layout chrome (50) but below the CommandPalette overlay (100) per UNIFIED.md §5.4.
- `text-xs text-on-surface` — same body sizing as the existing IconRail tooltip.

## 6. A11y contract

- **`role="tooltip"`** on the floating element (via `useRole`).
- **`aria-describedby={tooltipId}`** automatically wired on the trigger (via `useRole`).
- **Keyboard support:** trigger focus opens, blur closes, `Escape` closes.
- **Focusable triggers:** consumers must ensure the trigger is keyboard-focusable for the focus path to work. `<button>` elements are focusable by default. Plain `<div>` triggers (e.g. ActivityEvent body) need an explicit `tabIndex={0}` — see §7.1.
- **Screen-reader behavior:** `aria-describedby` causes screen readers to read the tooltip content as the trigger's accessible description, after its accessible name.

## 7. Integration plans

### 7.1 ActivityEvent

`src/features/agent-status/components/ActivityEvent.tsx:156` currently:

```tsx
<div className={`mt-0.5 truncate ${getBodyClass(event.kind)}`}>
  {event.body}
</div>
```

Becomes:

```tsx
<Tooltip content={event.body} placement="left" maxWidth={320}>
  <span
    tabIndex={0}
    className={`mt-0.5 block truncate outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${getBodyClass(event.kind)}`}
  >
    {event.body}
  </span>
</Tooltip>
```

Notes:

- **`<span>` not `<div>`** — `cloneElement` works on either, but `<span>` is semantically lighter for a focusable inline-style block.
- **`tabIndex={0}`** — the focus affordance discussed in design §5a. Lets keyboard users Tab to each event and have the tooltip read out the full body via `aria-describedby`.
- **`focus-visible:ring-1 focus-visible:ring-primary-container`** — visible focus indicator using the existing `primary-container` token (matches the active-session highlight from UNIFIED.md).
- **`placement="left"`** — the activity panel sits at the right edge of the screen; left placement keeps tooltips inside the viewport. `flip()` middleware handles the edge case if a tooltip near the panel's left border would still overflow.

### 7.2 IconRail

`src/features/workspace/components/IconRail.tsx` — replace **both** hand-rolled tooltip blocks (lines 40–45 and 67–72) and remove the `z-50` patch.

Each item changes from:

```tsx
<div
  className="relative flex w-full justify-center"
  onMouseEnter={() => setHoveredItem(item.id)}
  onMouseLeave={() => setHoveredItem(null)}
>
  <button …>…</button>
  {hoveredItem === item.id && (
    <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 z-50 …">
      {item.name}
    </div>
  )}
</div>
```

To:

```tsx
<div className="flex w-full justify-center">
  <Tooltip content={item.name} placement="right">
    <button …>…</button>
  </Tooltip>
</div>
```

Removed:

- `useState<string | null>(hoveredItem)` and the two handlers — no longer needed.
- The conditional tooltip `<div>` blocks at lines 40–45 and 67–72.
- The `z-50` patch (no longer needed; `<FloatingPortal>` escapes the grid cell).
- The `relative` class on the per-item wrappers — was only there to anchor the absolutely-positioned tooltip; Floating UI computes coordinates from `getBoundingClientRect()` and doesn't need a positioned ancestor.

## 8. Test strategy

### 8.1 `Tooltip.test.tsx` (new)

Covers the primitive's contract:

```tsx
test('returns children unchanged when disabled', …)
test('returns children unchanged when content is null', …)
test('opens on hover after delayMs and renders content', …)
test('closes on mouse leave', …)
test('opens on focus', …)
test('closes on Escape', …)
test('exposes content as accessible description on the trigger', …)  // covers role + describedby chain via toHaveAccessibleDescription
test('respects placement prop', …)
test('applies maxWidth to the floating element', …)
test('preserves existing ref on the trigger', …)
test('appends className to the baseline classes', …)
```

All hover/focus tests pass `delayMs={0}` to skip the 250ms open delay (cleaner than fake timers).

### 8.2 `IconRail.test.tsx` (rewrite)

Existing tests at lines ~102–143 assert inline DOM details (`.toHaveClass('bg-surface-container')`) that won't survive portaling. Migration:

- **Remove:** assertions on tooltip class names or DOM siblings of the trigger.
- **Replace with:** _integration_ assertions — the right item name is wired to the right Tooltip. Tooltip's own behaviour (hover/focus/escape, a11y attribute wiring) is covered by `Tooltip.test.tsx`; duplicating it here adds maintenance cost with no coverage benefit.

```tsx
test('shows item name as tooltip on hover', async () => { … })           // nav-items JSX path
test('shows settings item name as tooltip on hover', async () => { … })  // settings JSX path
```

### 8.3 `ActivityEvent.test.tsx` (extend)

Add the two tests specific to this consumer's integration. Tooltip's own behaviour is covered by `Tooltip.test.tsx`; we don't re-test it here.

- On hover, full body appears in the tooltip (integration: body content flows to Tooltip).
- The `<span>` wrapper has `tabIndex={0}` (the deliberate focus affordance discussed in §7.1).

## 9. Implementation order

1. `npm install --save @floating-ui/react` — adds the dep (and `@floating-ui/react-dom`, `@floating-ui/utils`, `tabbable` transitively).
2. Write `Tooltip.test.tsx` (red).
3. Write `Tooltip.tsx` until tests pass (green).
4. Refactor any awkward bits.
5. Migrate `IconRail.tsx`: replace tooltip blocks, drop hover state, drop `z-50` patch, drop `relative` wrappers.
6. Update `IconRail.test.tsx` per §8.2.
7. Migrate `ActivityEvent.tsx`: wrap truncated body in `<Tooltip>` + focusable `<span>`.
8. Extend `ActivityEvent.test.tsx` per §8.3.
9. Smoke-test in `npm run tauri:dev` — hover icons + activity events to verify portaling, placement, and ESC dismiss.
10. Lint, type-check, full test run.

## 10. Non-goals & deferrals

- **No controlled `open`/`onOpenChange` props.** Uncontrolled-only until a real need surfaces.
- **No `arrow` indicator.** Design doesn't call for it; can add via Floating UI's `arrow` middleware later.
- **No interactive tooltips.** `pointer-events-none` is intentional. If we ever need a hover-into-tooltip pattern (e.g. tooltip with a copy button), we revisit by removing `pointer-events-none` and tuning `safePolygon()`.
- **No portal-target prop.** Always portals to `document.body`. If a constrained-portal use case appears, add the prop then.
- **No tooltip groups / shared delays.** Each tooltip's delay is independent. Floating UI doesn't have a Radix-like provider for skip-delay grouping; we accept that until users complain about feel.
- **No animation on open/close.** Snap-in matches the existing IconRail behavior. Animation can be added via `useTransitionStyles` later if visual polish is desired.

## 11. Open questions resolved

- **Folder vs flat file structure** → flat, matches convention. Revisit if primitive grows.
- **Default `placement`** → `'top'`. Both call-sites override per their layout (IconRail → `'right'`, ActivityEvent → `'left'`).
- **Default `delayMs`** → 250ms. Tests override to 0.
- **`safePolygon` on day one** → yes, per decision record mitigation.
- **ActivityEvent focus affordance** → 5a (add `tabIndex={0}` + focus ring), per design discussion.

## 12. References

- Decision record: [`docs/decisions/2026-04-22-tooltip-library.md`](../../decisions/2026-04-22-tooltip-library.md)
- Floating UI tooltip recipe: <https://floating-ui.com/docs/tooltip>
- `useRole` (a11y wiring): <https://floating-ui.com/docs/userole>
- Glassmorphism baseline: `docs/design/DESIGN.md:37-44`
- CommandPalette z-100 overlay precedent: `docs/design/UNIFIED.md` §5.4
