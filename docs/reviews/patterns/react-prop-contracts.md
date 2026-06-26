---
id: react-prop-contracts
category: react-patterns
created: 2026-06-15
last_updated: 2026-06-26
ref_count: 7
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

### 3. ProgressBar explicit `data-testid` overrides consumer `data-testid`

- **Source:** local-codex | PR #509 round 2 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/components/ProgressBar.tsx` L176-180
- **Finding:** The rendered track `<div>` spread `{...rest}` before an explicit `data-testid={trackTestId}`. Any consumer that passed `data-testid` via `...rest` (e.g. `TokenCache`'s empty-stack band) had its test id silently overwritten by `undefined`, breaking the co-located test and removing the element from `screen.getByTestId`.
- **Fix:** Moved `data-testid={trackTestId}` before `{...rest}` so consumer-supplied `data-testid` takes precedence, while `trackTestId` still provides a default when no consumer id is present.
- **Commit:** same commit as this entry

### 4. RateLimitBar passes styling classes already owned by ProgressBar

- **Source:** github-claude | PR #509 round 2 | 2026-06-17
- **Severity:** LOW
- **File:** `src/features/agent-status/components/RateLimitBar.tsx` L36-43
- **Finding:** `RateLimitBar` passed `className="h-[3px] w-full overflow-hidden rounded-full bg-surface"`. `ProgressBar` already applies `h-[3px]` via `height="thin"`, `rounded-full` via the default `radius="pill"`, and `w-full overflow-hidden` on its track base; `bg-surface` is also the component's own fallback. The redundant classes leak abstraction internals and mislead future callers about the primitive's responsibilities.
- **Fix:** Removed the `className` prop from the `ProgressBar` call; the existing `height="thin"`, `tone`, `value`, and `fillTestId` props fully specify the bar.
- **Commit:** same commit as this entry

### 5. `Chip` `tone="success"` conflicts with caller-supplied `text-success-muted`

- **Source:** github-claude | PR #509 round 3 | 2026-06-17
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/LiveActionCard.tsx` L95-99
- **Finding:** `Chip` with `tone="success"` injects `bg-success/[0.12] text-success` from `TONE_CLASS` before the caller-supplied `className`, which ends with `text-success-muted`. Both text-color utilities land on the same element; Tailwind resolves the conflict by compiled CSS source order rather than JSX class order, so the rendered color is non-deterministic from the author's perspective.
- **Fix:** Changed `tone="success"` to `tone="custom"` so `Chip` does not inject any tone utilities and the caller's explicit `text-success-muted` (plus `bg-success/[0.12]`) remains the sole color source.
- **Commit:** same commit as this entry

### 6. NewSessionButton uses bg-none to override primary variant gradient

- **Source:** github-claude | PR #557 round 1 | 2026-06-19
- **Severity:** LOW
- **File:** `src/features/workspace/components/NewSessionButton.tsx` L26
- **Finding:** The call site passed `bg-primary bg-none` to strip the gradient defined inside the `primary` variant. tailwind-merge currently resolves this as intended, but the intent is invisible at the call site and would silently break if the variant ever expresses the gradient through a non-background-image mechanism.
- **Fix:** Added a dedicated `flat-primary` variant to `buttonVariants.ts` that uses `bg-primary` without the gradient, switched `NewSessionButton` to `variant="flat-primary"`, and updated the co-located test to drop the now-unnecessary `bg-none` assertion.
- **Commit:** same commit as this entry

### 7. Tool calls view switch reimplemented SegmentedControl locally

- **Source:** github-codex-connector | PR #576 round 1 | 2026-06-22
- **Severity:** P2 / MEDIUM
- **File:** `src/features/agent-status/components/ToolCalls/ToolCallsViewSwitch.tsx`
- **Finding:** The view switch rendered two raw icon buttons with a local segmented-track implementation. That duplicated the shared `SegmentedControl` contract and required a lint suppression for the raw icon-button rule.
- **Fix:** Replaced the local button group with `SegmentedControl` using the toolbar variant and icon-only option rendering. The control keeps the same accessible labels while inheriting the shared keyboard and pressed-state behavior.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 8. Quota unavailable tooltip duplicated registry-owned issue metadata

- **Source:** github-claude | PR #603 round 1 | 2026-06-22
- **Severity:** LOW
- **File:** `src/features/agent-status/components/QuotaUnavailableNotice.tsx` L30-34
- **Finding:** The quota notice component hardcoded a tooltip string containing `sst/opencode#16017` while the URL lived in the agent registry. Updating the upstream issue link later could leave the tooltip stale even though the link opened the new destination.
- **Fix:** Added `tooltipLabel` to `QuotaNotice`, populated it beside `trackUrl` in the registry, and made `QuotaUnavailableNotice` render that prop. Updated component and card tests to provide the co-located label.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 9. Optional rendererMode prop could not return to default semantics

- **Source:** github-claude | PR #626 round 1 | 2026-06-26
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/Body.tsx`
- **Finding:** `rendererMode` was applied only when truthy, so a caller that removed the prop after forcing Ghostty left the pane stuck in the prior mode instead of returning to the system default.
- **Fix:** Recomputed the active renderer mode from `rendererMode ?? resolveDefaultTerminalRendererMode()` whenever the prop changes and added a regression test for the forced-mode-to-default transition.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
