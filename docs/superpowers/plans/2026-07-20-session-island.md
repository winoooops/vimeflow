# Session Island Implementation Plan

**Goal:** Add the accepted centered, theme-aware open-session switcher to Linux and macOS
workspace chrome.

**Architecture:** A presentational `SessionIsland` derives its current ten-item batch from the
ordered session array and existing `isOpenSession` predicate, then delegates selection to the
workspace controller. One backward-compatible AppSettings field owns the display mode. The
existing `LayoutSwitcher` gains a responsive compact readout; native CSS transitions reproduce
the approved Noctalia motion.

**Spec:** `docs/superpowers/specs/2026-07-20-session-island-design.md`

## Constraints

- TDD: write the focused failing test before each behavior change.
- New TypeScript/TSX files have colocated tests.
- Use shared Tooltip and existing settings controls; no new dependency or floating primitive.
- Use semantic theme tokens only; no palette hex values in production.
- Preserve existing macOS drag regions and session activation/focus behavior.
- Remove the temporary prototype before handoff.

## Step 1 — Durable display setting

- Add `session_island_display` / `sessionIslandDisplay`, default `dots`, to Rust AppSettings,
  generated bindings, and renderer defaults.
- Include the new string in `validate_ipc_payload`'s length bound.
- Cover defaulting, camelCase serialization, bounded validation, partial-file migration, and
  renderer parity.
- Add an Appearance settings target and Dots / Numbers / Active label selector.
- Resolve malformed or unknown values to `dots` at the UI boundary.
- Run backend settings tests, binding generation, and focused settings tests.

## Step 2 — Session island model and component

- Add `SessionIsland.tsx` with colocated Testing Library tests.
- Filter only `isOpenSession` entries while preserving input/sidebar order.
- Cover zero-session hiding, selection, click delegation, 10-item batching, boundary crossing,
  retained/clamped batch with a Recent selection, and rerendered order.
- Cover dots, global numbers, active label/ellipsis, accessible names/current state, position
  classes, tooltips, and disabled-by-default notification slot.
- Use keyed buttons and the approved semantic-token/motion classes.

## Step 3 — Workspace integration

- Render the island as an absolute centered, no-drag child of `top-chrome`.
- Pass the ordered sessions, `activeSessionId`, resolved setting, and existing
  `handleSetActiveSessionId` callback.
- Add top-chrome regression tests for exact centering, no-drag behavior, sidebar order, focus
  delegation, zero-open state, and selected Recent state.

## Step 4 — Responsive layout pillar

- Make top chrome an inline-size container and define the named 700px compact threshold.
- Extend `LayoutSwitcher` with an opt-in responsive presentation: full segmented choices at
  normal widths; an active-layout readout plus the same configuration menu at the compact
  threshold.
- Test normal and compact structures, ensuring hidden choices cannot receive focus and the
  configuration menu remains available.
- Add a supported-minimum-width geometry regression for the macOS left toggle clearance.
- Keep vertical/new-session layout pickers unchanged.

## Step 5 — Notification build flag

- Feed `import.meta.env.VITE_SESSION_ISLAND_NOTIFICATIONS === '1'` into the island.
- Render a quiet, non-interactive outline bell only when enabled; render no placeholder node or
  spacing when disabled.
- Add focused flag-off and explicit flag-on component tests.

## Step 6 — Verification and cleanup

- Run focused session-island, top-chrome, LayoutSwitcher, settings, and Rust settings tests.
- Run binding generation, TypeScript checks, ESLint, Prettier, `git diff --check`, and the
  proportionate workspace test suite.
- Build/serve the app and visually verify Catppuccin, Flexoki, Gruvbox, Dracula, and Rosé Pine,
  both sides of the positional color split, batch crossing, display modes, and compact chrome.
- Run `claude -p` correctness/design review and apply actionable findings.
- Add the shipped SessionIsland contract to `docs/design/UNIFIED.md`.
- Delete `docs/exploration/2026-07-19-session-island-prototype.html` and confirm it is absent from
  the final diff.
