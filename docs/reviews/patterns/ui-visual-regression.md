---
id: ui-visual-regression
category: code-quality
created: 2026-06-11
last_updated: 2026-07-03
ref_count: 15
---

# UI Visual Regression

## Summary

UI color and styling choices must be verified against the full state matrix of
the component. A new gradient, border, or accent color can silently collide with
an existing state color and render two distinct segments indistinguishable.
Regressions are especially likely when:

- A named palette constant (e.g. Catppuccin Mocha hex) is reused for a new
  semantic purpose without checking existing usages.
- Tests exercise only the "healthy" or default state and omit edge states
  (cold, empty, error) where the collision occurs.
- Native or external surface adapters encode visibility through dimensions, and
  one backend handles zero-size first-paint frames differently from another.

The fix shape: pick a visually distinct color from the palette, and add a
test case for the state that triggers the collision.

## Findings

### 1. Fresh-segment gradient collides with cold-state cached segment

- **Source:** github-claude | PR #419 round 1 | 2026-06-11
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/TokenCache.tsx`
- **Finding:** `FRESH_STACK_GRADIENT` was changed to
  `linear-gradient(90deg, #ff94a5, #ffb4ab)`. The existing `cachedShareHex`
  function already returns `#ff94a5` for the cold-state cached segment
  (`sharePct < 40`). In a cold-cache scenario both the cached and fresh
  segments opened with the same pink, merging visually into one block.
  The new test only used a healthy-cache input (`makeUsage(7500, 1800, 700)`),
  so the collision was never exercised.
- **Fix:** Changed `FRESH_STACK_GRADIENT` to
  `linear-gradient(90deg, #fab387, #f9a87b)` (Catppuccin Peach), which does
  not overlap with any `cachedShareHex` output (`#7defa1`, `#cba6f7`,
  `#ff94a5`). Added a cold-cache test case asserting that cached and fresh
  stack styles differ.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Browser pane focus halo referenced an undefined `--color-scrim` token

- **Source:** github-codex-connector | PR #424 round 1 | 2026-06-12
- **Severity:** P2 / MEDIUM
- **File:** `src/features/browser/components/BrowserPane.tsx`
- **Finding:** The focused browser pane `boxShadow` used `color-mix(in srgb, var(--color-scrim) 35%, transparent)`, but the theme token set did not define `--color-scrim`. The unresolved variable invalidated the `box-shadow` declaration, so the focus halo was lost instead of themed.
- **Fix:** Added `scrim` to `EFFECT_COLOR_TOKENS`, defined it in both Catppuccin (the default theme, slug `obsidian-lens`) and Flexoki themes, and synced `src/theme/theme.css` so `--color-scrim` resolves.
- **Commit:** same commit as this entry

### 3. Hard-coded context-menu height clips at high-DPI scaling

- **Source:** github-claude | PR #428 round 1 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/MarkdownReadingView.tsx`
- **Finding:** `CONTEXT_MENU_HEIGHT = 112` was used to clamp the context menu's Y coordinate before render. At 125–150% system DPI the effective rendered height exceeds the room reserved at the bottom edge, causing the menu to overflow the viewport. The fix shape is the same as other visual-regression issues: verify the component against the full display state matrix, not just the default 1x scale.
- **Fix:** Increased the clamp constant from 112 to 160 px, reserving enough bottom margin for common HiDPI scales. Added a regression test for the clipboard fallback path; future work could measure the actual `offsetHeight` from the menu ref after render for pixel-perfect clamping.
- **Commit:** same commit as this entry

### 4. File tree git status badges use syntax tokens instead of VCS tokens

- **Source:** github-claude | PR #424 round 1 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/FileTreeNode.tsx`
- **Finding:** `getGitStatusColor` mapped every git status badge to `bg-syn-*` syntax tokens (`syn-class`, `syn-string`, `syn-tag`, `syn-operator`, `syn-keyword`) even though the same PR introduced dedicated `vcs-*` tokens. In Obsidian Lens the same status rendered in a visibly different shade in the file tree than in `ChangedFilesList`/`DiffLegend`.
- **Fix:** Replaced the `bg-syn-*` classes with the matching `bg-vcs-modified`, `bg-vcs-added`, `bg-vcs-deleted`, `bg-vcs-renamed`, and `bg-vcs-untracked` classes, keeping the `text-surface-container` overlay.
- **Commit:** same commit as this entry

### 5. Right activity panel divider uses full-opacity outline token

- **Source:** github-claude | PR #442 round 1 | 2026-06-13
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The new `border-l border-outline-variant` on the `activity-panel-shell` divider used the token at full opacity while every other workspace hairline uses an opacity modifier (`/25` or lower). This made the right panel edge read visibly heavier than the rest of the shell and broke the surface/hairline design contract.
- **Fix:** Changed the divider class to `border-l border-outline-variant/25` to match the surrounding hairline convention.
- **Commit:** same commit as this entry

### 6. New right activity panel hairline lacks a visual regression test

- **Source:** github-codex-connector | PR #442 round 2 | 2026-06-13
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.visual.test.tsx`
- **Finding:** The diff added `border-l border-outline-variant/25` to the `activity-panel-shell` divider, but `WorkspaceView.visual.test.tsx` only updated existing sidebar and top-chrome surface assertions and did not assert the new divider. Without a guard, a future class cleanup or token migration could silently remove or mistype the divider and recreate the visual regression the PR just fixed.
- **Fix:** Added a focused assertion in the existing Surface Hierarchy block that `activity-panel-shell` includes both `border-l` and `border-outline-variant/25`.
- **Commit:** same commit as this entry

### 7. AgentStatusRail background token change is not guarded by its co-located test

- **Source:** github-claude | PR #442 round 3 | 2026-06-13
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/components/AgentStatusRail.tsx`
- **Finding:** The diff changed `agent-status-rail` from `bg-surface-container` to `bg-surface`, but no co-located test asserted the new token. A future cleanup could silently revert the rail and recreate the visual regression, because the workspace-level visual assertion covers a different wrapper.
- **Fix:** Added a focused `AgentStatusRail.test.tsx` assertion that the rail element's class list contains `bg-surface` and does not contain `bg-surface-container`.
- **Commit:** same commit as this entry

### 8. Workspace root backdrop token lacks a visual test guard

- **Source:** github-claude | PR #442 round 3 | 2026-06-13
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The root `workspace-view` div was given `bg-surface-container-low` to complete the surface hierarchy behind the rounded main-column edges, but no visual test asserted the class. Existing layout assertions queried the root element but checked only height and overflow.
- **Fix:** Added a `WorkspaceView.visual.test.tsx` Surface Hierarchy assertion that `workspace-view` includes `bg-surface-container-low`.
- **Commit:** same commit as this entry

### 9. Workspace backdrop guard uses substring match that accepts the old token

- **Source:** github-codex-connector | PR #442 round 4 | 2026-06-13
- **Severity:** P2 / MEDIUM
- **File:** `src/features/workspace/WorkspaceView.visual.test.tsx` L197-210
- **Finding:** The new surface-container-low assertion used `className.toContain('bg-surface-container-low')`. Because `bg-surface-container-lowest` contains that substring, a future regression back to the old backdrop token would keep the visual test green. The workspace root has no stricter backup assertion.
- **Fix:** Replaced both `bg-surface-container-low` substring assertions (workspace root and sidebar) with exact jest-dom `toHaveClass('bg-surface-container-low')` checks, matching existing project test patterns.
- **Commit:** same commit as this entry

### 10. Floating reopen tabs keep IconButton's all-corner radius alongside directional radius classes

- **Source:** github-codex-connector | PR #454 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/diff/components/CommitInfoPanel.tsx`, `src/features/editor/components/ExplorerPane.tsx`
- **Finding:** The migration from raw `<button>` elements to `IconButton` passed directional radius classes (`rounded-l-lg` and `rounded-r-lg`) via `className`. `IconButton`'s internal icon geometry contributes `rounded-chip`, and Tailwind's shorthand and side-specific radius utilities can coexist, so the flush edge of the collapsed panel tabs remained rounded instead of square.
- **Fix:** Added `rounded-none` immediately before the directional radius class on both floating reopen `IconButton`s so the inherited all-corner rounding is removed and only the intended side radius remains.
- **Commit:** same commit as this entry

### 11. New-session button loses its custom corner radius during Button migration

- **Source:** github-claude | PR #454 round 2 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/features/workspace/components/NewSessionButton.tsx`
- **Finding:** The original raw button carried `rounded-[10px]` (10 px). The migrated `Button` uses the default `shape="pill" size="md"` compound variant, which resolves to `rounded-md` (6 px). The new `className` overrode height and padding but omitted a radius class, so `rounded-md` survived via tailwind-merge.
- **Fix:** Added `rounded-[10px]` to the `className` override so the sidebar new-session button keeps its previous radius.
- **Commit:** same commit as this entry

### 12. ClaudeCode brand icon distorts with non-uniform scaling after cropping to a non-square viewBox

- **Source:** github-claude | PR #572 round 1 | 2026-06-20
- **Severity:** MEDIUM
- **File:** `src/agents/brandIcons.tsx`, `src/agents/brandIcons.test.tsx`
- **Finding:** The `ClaudeCode` icon was cropped to `viewBox="0 4 24 17"`, but the shared `BrandSvg` wrapper still renders a square SVG (`width={size}` / `height={size}`). Adding `preserveAspectRatio="none"` forced independent X/Y scaling, so the 24:17 mark stretched vertically inside the square chip and undid the intended ratio correction.
- **Fix:** Removed `preserveAspectRatio="none"` from the `ClaudeCode` `BrandSvg` call so the cropped mark scales uniformly and is letterboxed inside the square icon. Removed the matching `preserveAspectRatio="none"` assertion from the regression test.
- **Commit:** same commit as this entry

### 13. Toolbar icon inherits `text-[0px]` and renders at 0 px

- **Source:** github-claude | PR #461 round 1 | 2026-06-15
- **Severity:** MEDIUM
- **File:** `src/components/SegmentedControl.tsx`
- **Finding:** The `toolbar` and `toolbarInline` variants set `text-[0px]` on the button to hide labels, but `renderDefaultOption` fell back to `iconClassName ?? 'material-symbols-outlined text-[1.1em]'`. With no explicit `iconClassName`, the icon span inherited the parent's zero font-size and `1.1em` resolved to `0 px`, making the icon invisible.
- **Fix:** Changed the default icon class fallback to `text-[16px]` so the icon size is independent of the parent button's label-hiding font-size.
- **Commit:** same commit as this entry

### 14. ClaudeCode crop keeps a square rendered viewport

- **Source:** github-codex-connector | PR #572 round 1 | 2026-06-20
- **Severity:** P2 / MEDIUM
- **File:** `src/agents/brandIcons.tsx`, `src/agents/brandIcons.test.tsx`
- **Finding:** The ClaudeCode icon used a cropped `viewBox="0 4 24 17"` but still rendered into the shared square SVG dimensions. Because the viewBox remained width-limited inside the square viewport, the crop mostly recentered the mark without proving the rendered logo ratio changed.
- **Fix:** Gave the ClaudeCode SVG a height derived from the cropped 24:17 viewBox while keeping uniform scaling, and added a regression assertion that the rendered width-to-height ratio matches the cropped geometry.
- **Commit:** same commit as this entry

### 15. ClaudeCode regression test omits the no-distortion invariant

- **Source:** github-claude | PR #572 round 1 | 2026-06-20
- **Severity:** LOW
- **File:** `src/agents/brandIcons.test.tsx`
- **Finding:** The ClaudeCode regression test asserted the cropped viewBox and removed circle, but did not guard against reintroducing `preserveAspectRatio="none"`. That left the prior non-uniform scaling regression able to return without breaking the test.
- **Fix:** Added an explicit assertion that the rendered SVG has no `preserveAspectRatio` attribute, preserving the uniform-scaling invariant alongside the rendered-ratio assertion.
- **Commit:** same commit as this entry

### 16. Native Ghostty parent forwarded fractional AppKit frame bounds

- **Source:** github-claude | PR #630 round 5 | 2026-06-28
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** The parented Ghostty surface path forwarded fractional `getBoundingClientRect()` coordinates directly to `addon.setFrame`, while the helper path rounded them before crossing into native code. On HiDPI displays this could place the NSView on subpixel boundaries and create a visible one-pixel gap, blur, or overlap against adjacent panes.
- **Fix:** Rounded x, y, width, and height before calling `addon.setFrame`, preserving the existing hidden-pane behavior that sends zero width and height.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 17. Native Ghostty parent treated visible zero-area panes as shown

- **Source:** github-claude | PR #630 round 7 | 2026-06-28
- **Severity:** MEDIUM
- **File:** `electron/ghostty-native-parent.ts`
- **Finding:** The parent backend encoded pane visibility only from the
  renderer's `visible` flag, so a first-paint `visible=true` pane with a zero
  width or height still called `addon.setFrame(..., 0, 0)`. The helper backend
  already suppressed the same input with `visible && width > 0 && height > 0`,
  leaving the two native paths inconsistent and risking transient zero-area
  native-surface artifacts.
- **Fix:** Compute `frameVisible` from `visible` plus positive rounded width
  and height, and send a hidden 0x0 frame whenever the measured pane area is
  zero. Added a parent-controller regression test for visible zero-area bounds.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 18. Surface-bright collision hides hover affordances

- **Source:** github-claude | PR #647 round 1 | 2026-07-03
- **Severity:** MEDIUM
- **File:** `src/theme/themes/gruvbox/gruvbox-light.ts`, `src/theme/themes/tokyo-night.ts`
- **Finding:** The surface elevation shift updated `surface-container-highest` in Gruvbox Light and Tokyo Night but left `surface-bright` on the previous rung, making it collide with `surface-container-high`. Hover backgrounds over panels already using the high surface could become visually invisible.
- **Fix:** Re-pointed `surface-bright` to the same top step as `surface-container-highest` in both themes and added focused assertions so the intended pairing is guarded.
- **Commit:** same commit as this entry

### 19. Adjacent Gruvbox Dark surface rungs collapsed

- **Source:** github-claude | PR #647 round 4 | 2026-07-03
- **Severity:** MEDIUM
- **File:** `src/theme/themes/gruvbox/gruvbox-dark.ts`
- **Finding:** `surface-container-low` and `surface-container` both resolved to
  `#504945`, so nested panels using the adjacent semantic rungs rendered as one
  flat surface in Gruvbox Dark.
- **Fix:** Assigned `surface-container` to a distinct intermediate value that
  still passes the label contrast guard, and added a regression test asserting
  lower adjacent surface rungs remain distinct.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 20. Top-tier surface rungs collapse in Gruvbox Dark and Tokyo Night

- **Source:** github-codex-connector | PR #647 round 5 | 2026-07-03
- **Severity:** HIGH
- **File:** `src/theme/themes/gruvbox/gruvbox-dark.ts`, `src/theme/themes/tokyo-night.ts`
- **Finding:** Gruvbox Dark and Tokyo Night reused the same accessible color for
  `surface-container-high`, `surface-container-highest`, and `surface-bright`,
  so controls using high-to-highest hover or elevation feedback rendered without
  a visible state change in those themes.
- **Fix:** Chose distinct accessible top-rung surface values for both themes and
  added a shared regression test asserting the three interactive top rungs stay
  pairwise distinct.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 21. Terminal-canvas guard skipped surface rungs used at the canvas edge

- **Source:** github-claude | PR #647 round 7 | 2026-07-03
- **Severity:** MEDIUM
- **File:** `src/theme/themes/background-separation.test.ts`
- **Finding:** The terminal-background collision guard checked only `surface`,
  `surface-container-lowest`, and `surface-container`, omitting
  `surface-container-low`, `surface-container-high`, `surface-container-highest`,
  and `surface-bright`. The omitted low rung is used by the workspace chrome
  adjacent to the terminal canvas, so a future theme edit could recreate the
  disappearing-canvas-edge regression without failing the test.
- **Fix:** Replaced the three explicit assertions with a full surface-rung list
  and loop, so every shipped surface background stays distinct from each
  theme's terminal canvas background.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 22. Top-rung surface guard omitted a previously broken theme

- **Source:** github-claude | PR #647 round 8 | 2026-07-03
- **Severity:** LOW
- **File:** `src/theme/themes/background-separation.test.ts`
- **Finding:** The top-rung distinctness guard covered Gruvbox Dark and Tokyo
  Night but omitted Gruvbox Light, even though Gruvbox Light hit the same
  `surface-bright` collision class earlier in the PR. Future edits could
  collapse `surface-container-high`, `surface-container-highest`, or
  `surface-bright` in that theme without failing the regression test.
- **Fix:** Added Gruvbox Light to the shared top-surface theme matrix so every
  theme that has previously hit this collision class is guarded by the same
  pairwise-distinctness assertion.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 23. Browser bar chrome collided with app surface

- **Source:** github-claude | PR #647 round 9 | 2026-07-03
- **Severity:** HIGH
- **File:** `src/theme/themes/dracula.ts`, `src/theme/themes/flexoki.ts`,
  `src/theme/themes/gruvbox/gruvbox-dark.ts`,
  `src/theme/themes/gruvbox/gruvbox-light.ts`,
  `src/theme/themes/tokyo-night.ts`
- **Finding:** The surface ladder shift moved `ui.surface` onto palette values
  already used by `ui['browser-bar']` in five shipped themes. Browser tab-bar
  chrome could therefore blend into its `bg-surface` browser pane parent,
  recreating the disappearing-boundary issue for native browser panes.
- **Fix:** Moved the affected `browser-bar` tokens to distinct adjacent palette
  steps and added a shared regression test asserting every shipped theme keeps
  `browser-bar` distinct from `surface`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 24. Browser bar chrome collided with adjacent toolbar surface

- **Source:** github-codex-connector | PR #647 round 11 | 2026-07-03
- **Severity:** HIGH
- **File:** `src/theme/themes/dracula.ts`, `src/theme/themes/flexoki.ts`,
  `src/theme/themes/gruvbox/gruvbox-light.ts`,
  `src/theme/themes/tokyo-night.ts`,
  `src/theme/themes/background-separation.test.ts`
- **Finding:** Dracula, Flexoki, Gruvbox Light, and Tokyo Night kept
  `ui['browser-bar']` equal to `ui['surface-container-lowest']`, the toolbar
  row adjacent to the browser tab row. The browser tab bar and toolbar could
  visually merge in those shipped themes even though the terminal and parent
  surface collision guards passed.
- **Fix:** Moved the four `browser-bar` tokens to distinct neighboring theme
  values and added a regression test asserting `browser-bar` remains distinct
  from `surface-container-lowest` in every shipped theme.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 25. Native Ghostty corner radius used unscaled renderer pixels

- **Source:** github-codex-connector | PR #651 round 1 | 2026-07-03
- **Severity:** P2 / MEDIUM
- **File:** `src/features/terminal/components/TerminalPane/GhosttyBody.tsx`
- **Finding:** Native Ghostty frame bounds were converted from renderer CSS
  pixels to AppKit window points, but the collapsed-pane bottom corner radius
  was still sent as the original CSS-pixel value. In zoomed or viewport-mismatch
  environments, the native rounded corners could become too small or too large
  relative to the converted frame and visibly diverge from the DOM wrapper.
- **Fix:** Added a corner-radius conversion helper that applies the same
  native point scale before calling `updateNativeGhostty`, and covered both the
  helper and IPC payload with regression tests for mismatched viewport metrics.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
