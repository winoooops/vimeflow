---
id: macos-window-chrome
category: cross-platform
created: 2026-06-09
last_updated: 2026-06-09
ref_count: 0
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
