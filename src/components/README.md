# Shared Component Library

`src/components` is the public UI primitive layer for Vimeflow. Feature code should compose these primitives instead of re-implementing chrome, accessibility wiring, keyboard behavior, or third-party integration.

## Layers

- Public primitives live flat in `src/components/*.tsx`: `Tooltip`, `Dropdown`, `Menu`, `Popover`, `Dialog`, `Button`, `IconButton`, `ToolbarButton`, `SegmentedControl`, `Toggle`, `Chip`, `ProgressBar`, and similar app-wide components.
- Package-private substrate lives under `src/components/base/**`. It may wrap a third-party engine or own low-level behavior that public primitives share.
- Feature code must not import from `src/components/base/**`. The ESLint ring-2 rule enforces this outside `src/components`.
- `@floating-ui/react` is confined to `src/components/base/floating/**` and the grandfathered `Tooltip`. Feature code composes `Dropdown`, `Menu`, or `Popover`.

## Adding A Primitive

Add a shared primitive only when at least two real call sites need the same behavior, or when one call site owns behavior that must be centralized for accessibility, security, or consistency.

Before adding one:

- Audit the real consumers and list what behavior is shared.
- Keep domain logic in the feature. Shared components own shell, accessibility, focus, dismissal, sizing presets, and tokenized chrome.
- Prefer a flat public file such as `Dialog.tsx`; put reusable internals in `base/<area>/` only when they hide meaningful complexity.
- Add a sibling test file for every new `.tsx` or `.ts` file.
- Document the contract in `docs/design/UNIFIED.md` when the primitive becomes part of the design system.
- Add or update a lint guard when the primitive closes a repeated anti-pattern.

## Overlay Choice

- Use `Tooltip` for hover or focus labels. Do not use native `title=`.
- Use `Dropdown` for controlled option selection.
- Use `Menu` for command menus, including cursor-anchored context menus via `Menu.Context`.
- Use `Popover` for anchored arbitrary dialog cards, including non-blocking dialog-like surfaces that position against a trigger.
- Use `Dialog` for full-screen modal shells. Do not route anchored or cursor-positioned surfaces through `Dialog` just because they use `role="dialog"`.

## Styling

Shared components use semantic theme tokens and the existing Lens surface language. Avoid call-site-specific chrome escape hatches. If a component exposes `className`, treat it as a layout escape hatch, not a way to restyle the primitive.

## Tests

Primitive tests cover primitive behavior: ARIA wiring, focus management, keyboard interaction, disabled states, dismissal, ref forwarding, and visual state attributes. Consumer tests should verify only the consumer-specific integration, copy, and callbacks.
