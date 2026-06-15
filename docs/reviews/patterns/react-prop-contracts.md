---
id: react-prop-contracts
category: react-patterns
created: 2026-06-15
last_updated: 2026-06-15
ref_count: 1
---

# React Prop Contracts

## Summary

Components that wrap native HTML elements and forward `...rest` props must explicitly remove any props whose behavior they override. If the public type still advertises an overridden prop (e.g. `onClick` on a button that supplies its own click handler), consumers can pass it and TypeScript will accept it, but the supplied handler will be silently discarded at runtime.

## Findings

### 1. Toggle accepts onClick but silently discards it

- **Source:** github-claude | PR #461 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/components/Toggle.tsx`
- **Finding:** `ToggleProps` extended `ButtonHTMLAttributes<HTMLButtonElement>` but omitted only `'className' | 'onChange' | 'aria-pressed' | 'value'`, leaving `onClick` in the public surface. The rendered `<button>` spread `{...rest}` before an explicit `onClick={() => onChange(!value)}`, so any consumer-supplied click handler was dropped without warning.
- **Fix:** Added `'onClick'` to the `Omit<>` list so the prop is no longer advertised, making the component's ownership of the click behavior explicit.
- **Commit:** same commit as this entry

### 2. `skipActiveReselect` honored on click but ignored on keyboard navigation

- **Source:** github-codex-connector | PR #461 round 1 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `src/components/SegmentedControl.tsx`
- **Finding:** `SegmentedControl` applied `skipActiveReselect` only to the pointer `onClick` handler. Keyboard navigation (`Home`, `End`, arrow keys) in `handleKeyDown` called `onChange` unconditionally, so pressing `Home` while the first option was already active re-fired the callback with the same value.
- **Fix:** Guarded `handleKeyDown` so `onChange` is skipped when `skipActiveReselect` is true and the computed `nextIndex` equals the current `index`.
- **Commit:** same commit as this entry
