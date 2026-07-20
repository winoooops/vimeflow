# Session Island — Design

**Status:** Proposed for implementation; interaction and visual direction accepted from the
2026-07-19 prototype. This document is the production contract.

**Prototype:** `docs/exploration/2026-07-19-session-island-prototype.html` is a temporary
exploration artifact. It must be removed before the production change is handed off.

## 1. Purpose

Add a theme-aware session switcher to the mathematical center of the 44px workspace top
chrome on Linux and macOS. It is an important addition to the existing sidebar and pane-layout
switcher, not a replacement for either.

Each indicator represents one session in the sidebar's **Active** section. The island is
navigation and position chrome; its colors do not encode agent activity or session health.

## 2. Source of truth

- Input order is `sessions.filter(isOpenSession)`, exactly matching the sidebar Active group.
- Reordering the sidebar updates the island immediately. The Ctrl+Tab MRU order is unrelated
  and must not be reused.
- Selection uses the workspace's existing `handleSetActiveSessionId`, preserving terminal
  focus and the current activation controller behavior.
- Recent/completed sessions never receive indicators. If one is selected, the island remains
  visible for open sessions but no indicator is active or wide.
- With zero open sessions the island is not rendered.

## 3. Batching

At most ten indicators render at once. There are no arrows, wheel handling, carousel motion,
or manually selectable pages.

- Selecting an open session derives the batch containing it: 1–10, 11–20, and so on.
- Crossing a ten-session boundary replaces the displayed batch automatically.
- While a Recent/completed session is selected, retain the last displayed open-session batch,
  clamped to the remaining batch count if sessions close.
- If the component mounts with a Recent/completed selection and has no prior open-session
  batch, start with the first batch (1–10).
- Numbers, when enabled, are global sidebar positions rather than batch-local positions.

## 4. Visual contract

The island is absolutely centered within the main workspace's top chrome (`left: 50%` plus
`translateX(-50%)`), independent of sidebar width and the right-aligned layout pillar.

- Island: 28px high, 18px radius, 4px item gap, 5px internal padding, themed translucent
  surface, subtle themed outline, backdrop blur, and no shadow.
- Inactive indicator: 16×16px circle.
- Active indicator: 48×16px capsule in dots and numbers modes.
- Active-label mode: inactive indicators remain circles; the active capsule grows from 48px
  up to 160px and ellipsizes the session name.
- Every indicator has a shared `Tooltip` containing the session name.

Colors come only from live Lens semantic tokens:

| Position relative to selected open session | Token                                       |
| ------------------------------------------ | ------------------------------------------- |
| Active                                     | `primary`                                   |
| Previous / left                            | `secondary` at full opacity                 |
| Upcoming / right                           | `secondary` at 55% opacity                  |
| No selected open session                   | all indicators use upcoming/right treatment |

The split is positional and moves with selection. It is not alternating, per-session, or based
on status. Custom themes inherit the behavior through the same semantic tokens.

## 5. Motion

Keep keyed button nodes stable while selection moves inside a batch and animate CSS properties
directly:

- Properties: width, background color, color, and opacity.
- Duration: `222.222ms` (Noctalia's 200ms base divided by local speed 0.9).
- Curve: `cubic-bezier(.333333, 1, .666667, 1)` (ease-out-cubic).
- `prefers-reduced-motion: reduce`: transition duration becomes 1ms.

No Framer Motion dependency or layout animation is needed.

## 6. Display preference

Add durable `AppSettings.sessionIslandDisplay` with default `dots`. The Appearance pane exposes
three values and safely resolves unknown persisted strings back to `dots`:

- `dots`: no visible text.
- `numbers`: global open-session position in every indicator.
- `labels`: only the selected open session displays its name.

The Rust default, generated TypeScript binding, renderer default, settings search target, and
Appearance control must remain synchronized. The settings schema version stays at 1 because
Serde's struct default makes the new field backward-compatible with existing partial files.
`validate_ipc_payload` includes the field in the existing bounded-string validation.

## 7. Responsive top chrome

The island keeps the exact center and has priority when the top chrome narrows. Define
`SESSION_ISLAND_LAYOUT_COMPACT_WIDTH_PX = 700`; when the main top-chrome container is narrower
than that threshold, the existing right-side layout pillar shows only:

1. the active layout glyph as a readout, and
2. the existing layout configuration menu after its divider.

The full layout choices remain available through that menu. The compact readout must not act
like a selectable one-option segmented control. The same DOM/CSS behavior applies on Linux and
macOS, and the island and layout controls remain `vf-app-no-drag` inside macOS draggable chrome.

The supported window geometry keeps the centered island clear of left-side macOS controls:
Electron enforces an 800px window minimum; compact workspace mode removes the right activity
panel, while desktop mode either keeps the left control outside the main column or leaves at
least 620px when the sidebar is collapsed. The default worst-case 352px active-label island
therefore starts at 134px; even the 377px flag-on notification variant starts at 121.5px. Both
remain beyond the macOS toggle clearance ending at 110px. Cover this invariant with a regression
test; if the window/main-column minimum changes, revise the island capacity or label width rather
than offsetting its center.

## 8. Notifications placeholder

Notification behavior is not part of v1. Reserve an optional trailing outline-bell slot behind
the build flag `VITE_SESSION_ISLAND_NOTIFICATIONS=1`:

- The default/off build renders no bell, wrapper, spacing, or blank reservation.
- The enabled placeholder is quiet and non-interactive; alert state and badge semantics are
  deferred.

## 9. Accessibility

- The island is a navigation region labelled `Open sessions`.
- Each button is named `Switch to session N: <name>` and exposes `aria-current="page"` only
  when it is the selected open session.
- Buttons stay in sidebar order and use normal Tab navigation; clicking one switches session.
- All hover labels use the shared `Tooltip`; there are no native `title` attributes or
  feature-local floating surfaces.
- Hidden responsive layout options are removed from layout, keyboard navigation, and the
  accessibility tree.

## 10. Acceptance criteria

1. 0, 1, 10, 11, and 20+ open-session cases follow the visibility and batching contract.
2. Selection and sidebar reorder update the island without maintaining a duplicate session
   model.
3. Recent selection leaves all open indicators inactive and keeps the last valid batch.
4. Dots, numbers, and active-label modes persist through AppSettings.
5. Active/previous/upcoming colors use live theme tokens and update on theme change.
6. Selection motion matches the duration/curve contract and honors reduced motion.
7. The island remains mathematically centered; narrow chrome compacts the layout pillar.
8. macOS drag/no-drag behavior and Linux/dev rendering remain intact.
9. The notification placeholder is absent unless its build flag is explicitly enabled.
10. The supported minimum-width geometry leaves the centered island clear of both macOS shell
    toggles.
