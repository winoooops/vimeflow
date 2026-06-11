---
id: macos-window-chrome
category: cross-platform
created: 2026-06-09
last_updated: 2026-06-11
ref_count: 2
---

# macOS Window Chrome

## Summary

When implementing Electron's hidden-titlebar chrome on macOS, renderer-side
changes must stay gated to macOS just as strictly as main-process options.
Unconditional `-webkit-app-region: drag` classes leak window-drag behavior to
Windows and Linux, and native traffic-light geometry must be reserved in both
dimensions so the controls do not overlay adjacent UI columns.

## Findings

### 1. vf-app-drag-region applied on all platforms, not just macOS

- **Source:** github-claude | PR #407 round 1 | 2026-06-09
- **Severity:** MEDIUM
- **File:** `src/features/sessions/components/Tabs.tsx`, `src/features/workspace/components/IconRail.tsx`
- **Finding:** Both components unconditionally added `vf-app-drag-region` to their root elements. Electron honors `-webkit-app-region: drag` on Windows and Linux even with `frame: true`, turning empty chrome areas into unintended window-drag handles.
- **Fix:** Made the class conditional on `reserveWindowControls` (macOS-only) in both `Tabs` and `IconRail`, and passed the flag down from `WorkspaceView`.

### 2. Reserve the full traffic-light width

- **Source:** github-codex-connector | PR #407 round 1 | 2026-06-09
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/components/IconRail.tsx`
- **Finding:** The 48px icon rail was narrower than the native traffic-light group placed at `x: 16` in `electron/main.ts`, so the yellow/green controls extended into the sidebar column.
- **Fix:** Widened the rail to 68px (`w-[68px]`) when `reserveWindowControls` is true and updated the parent `gridTemplateColumns` in `WorkspaceView.tsx` to match.

### 3. reserveWindowControls uses a redundant double platform check

- **Source:** github-claude | PR #407 round 1 | 2026-06-09
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `reserveWindowControls = preferModifier === 'meta' && isMacPlatform()` — both sub-expressions resolve via the exact same macOS detection, making the `&&` a logical no-op.
- **Fix:** Simplified to `const reserveWindowControls = preferModifier === 'meta'` and removed the now-unused `isMacPlatform` helper.

### 4. Magic number 52 in IconRail paddingTop is undocumented

- **Source:** github-claude | PR #407 round 1 | 2026-06-09
- **Severity:** LOW
- **File:** `src/features/workspace/components/IconRail.tsx`
- **Finding:** The `52` in `paddingTop: reserveWindowControls ? 52 : 10` encoded `trafficLightPosition.y (13) + button diameter (~28) + gap (~11)` from `electron/main.ts` with no comment or named constant.
- **Fix:** Introduced `MACOS_TRAFFIC_LIGHT_RESERVE_PX = 52` with an inline comment explaining the derivation.

### 5. IconRail.test.tsx missing conditional vf-app-drag-region assertions

- **Source:** github-claude | PR #407 round 2 | 2026-06-09
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/IconRail.test.tsx`
- **Finding:** The `reserveWindowControls` test only asserted `paddingTop: '52px'`; it did not check that `vf-app-drag-region` is present when the prop is true, nor that it is absent when false. A regression reverting the class to unconditional application would pass tests undetected.
- **Fix:** Added `toHaveClass('vf-app-drag-region')` and `toHaveClass('w-[68px]')` assertions to the existing test, plus a mirroring no-reserve test asserting `not.toHaveClass('vf-app-drag-region')`.

### 6. backgroundColor '#121221' undocumented in main-process options

- **Source:** github-claude | PR #407 round 2 | 2026-06-09
- **Severity:** LOW
- **File:** `electron/main.ts`
- **Finding:** `backgroundColor: '#121221'` in `macosWindowChromeOptions` mirrored the Tailwind `bg-background` token with no comment linking the two. A future design iteration updating the token would leave the native window flash color stale.
- **Fix:** Added an inline comment documenting the relationship to the Tailwind token and warning to keep them in sync.

### 7. SidebarTopBar drag region applied unconditionally on all platforms

- **Source:** github-codex-connector | PR #412 round 1 | 2026-06-10
- **Severity:** HIGH
- **File:** `src/features/workspace/components/SidebarTopBar.tsx`
- **Finding:** `SidebarTopBar` unconditionally added `vf-app-drag-region` to its root element, while `WorkspaceView` already computed the macOS-only `reserveWindowControls` flag and `Tabs` correctly gated the same class behind it. Electron honors `-webkit-app-region: drag` on Windows and Linux, turning the expanded sidebar top bar into an unintended window-drag handle.
- **Fix:** Added a `reserveWindowControls` prop to `SidebarTopBar`, made `vf-app-drag-region` conditional on it, passed the existing `reserveWindowControls` value from `WorkspaceView`, and added a non-macOS test asserting the class is absent.

### 8. Outer right padding excluded from drag region after moving class to inner children

- **Source:** github-claude | PR #415 round 1 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/SidebarTopBar.tsx`, `src/features/sessions/components/Tabs.tsx`
- **Finding:** Both bars moved `vf-app-drag-region` from the outer container to inner grid/flex children, but left `paddingRight: 10` (`SidebarTopBar`) and `pr-2` (`Tabs`) on the non-draggable outer containers. CSS grid/flex children occupy the content box, not the parent padding area, so the rightmost 10 px / 8 px strips stopped being draggable on macOS compared with the previous behavior.
- **Fix:** Removed the outer right padding from both containers and placed the same spacing on the rightmost inner element that already owns the drag/no-drag behavior, restoring the full right-edge draggable strip.
