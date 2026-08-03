---
id: surface-configuration-propagation
category: correctness
created: 2026-08-03
last_updated: 2026-08-03
ref_count: 1
---

# Surface Configuration Propagation

## Summary

Native surfaces with primary and secondary child views must treat runtime
configuration as shared surface state, not as a primary-view-only side effect.
When a setter updates the primary terminal view, it also needs to persist the
current value and mirror it to any existing secondary child. Child creation must
seed the same value alongside neighboring color, font, shader, and layout
settings so split-pane terminals behave identically to the primary pane.

## Findings

### 1. Resize throttle never propagated to split-pane secondary surface

- **Source:** github-claude | PR #776 round 1 | 2026-08-03
- **Severity:** HIGH
- **File:** `native/ghostty-helper/Sources/GhosttyElectronBridge/GhosttyElectronBridge.swift` L745
- **Finding:** `EmbeddedGhosttySurface.setResizeThrottle(milliseconds:)` only
  updated the primary `terminalView`, while sibling setters propagated their
  values to `secondaryChild`. `addSecondary` also seeded background,
  foreground, font, and cursor-shader state but omitted the current resize
  throttle, leaving split-pane secondary terminals on the engine default.
- **Fix:** Added a child resize-throttle setter, cached the parent surface's
  current throttle value, forwarded updates to any existing secondary child,
  and seeded newly created secondary children with the cached throttle.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Resize throttle parent propagation path lacked a regression test

- **Source:** github-codex-connector | PR #776 round 2 | 2026-08-03
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-parent.test.ts`
- **Finding:** The Electron-side propagation call for
  `addon.setResizeThrottleMs`, its duplicate-value cache, and the cache reset
  on surface rebuild had no direct test. A future refactor could remove the
  renderer-to-native throttle setter while neighboring tests still passed.
- **Fix:** Extended the parented surface replay test to mock
  `setResizeThrottleMs`, assert first dispatch, assert duplicate dedupe, and
  assert redispatch after destroy/recreate resets the surface-scoped cache.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
