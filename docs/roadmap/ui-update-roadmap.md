# UI Handoff Migration Roadmap

> Paired with `docs/roadmap/progress.yaml` phase `ui-handoff-migration`. Spec: `docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md`. Visual + behavioural source of truth: `docs/design/handoff/`.

10 sequential steps land the existing `WorkspaceView` onto the handoff visual + behavioural spec while keeping the Electron + Rust-sidecar integrations intact. Steps 1–9 mirror handoff §9 verbatim; step 10 is a token-cleanup pass that closes the additive-token strategy.

**Status (2026-05-20).** Steps 1-5c2 are merged on `main`:
tokens + agents registry ([#171](https://github.com/winoooops/vimeflow/pull/171), `38af7ab`),
app shell layout ([#173](https://github.com/winoooops/vimeflow/pull/173), `266b3a0`),
sidebar sessions + browser-style tabs ([#174](https://github.com/winoooops/vimeflow/pull/174), `ab1b888`),
single TerminalPane ([#190](https://github.com/winoooops/vimeflow/pull/190), `f585ac8`),
pane model ([#198](https://github.com/winoooops/vimeflow/pull/198), `a76d962`),
SplitView render ([#199](https://github.com/winoooops/vimeflow/pull/199), `c0b7e88`),
layout picker + focus + motion ([#203](https://github.com/winoooops/vimeflow/pull/203), `fed7ee8`),
and pane lifecycle ([#204](https://github.com/winoooops/vimeflow/pull/204), `4795671`).
DockPanel positioning ([#215](https://github.com/winoooops/vimeflow/pull/215)), shared focus shortcuts ([#218](https://github.com/winoooops/vimeflow/pull/218)), elastic dock resize ([#219](https://github.com/winoooops/vimeflow/pull/219)), command-palette result styling ([#221](https://github.com/winoooops/vimeflow/pull/221)), and tooltip shortcut chips ([#224](https://github.com/winoooops/vimeflow/pull/224)) have also landed. Remaining gaps: step 5d auto-grow on layout pick, activity-panel polish, full command-palette modal polish, and shortcut discovery for `Mod+\` / `Mod+B` ([#225](https://github.com/winoooops/vimeflow/issues/225)).

## Step 1 — Tokens + agents registry (done)

**Goal.** Extend `tailwind.config.js` with the handoff §6 design tokens (additive only) and add `src/agents/registry.ts` per handoff §6's TypeScript snippet.

**Files.** `tailwind.config.js`, `tailwind.config.test.js`, `src/agents/registry.ts`, `src/agents/registry.test.ts`, `docs/design/handoff/`.

**DoD.** New tokens present and asserted by test; existing classes unchanged in value; agents registry exported with `AgentId` keyof-type; handoff prototype/screenshots checked in; `npm run lint`, `npm run test`, `npm run type-check` all green.

**Risks.** None to runtime — no consumer in this step. Tests landed in `tailwind.config.test.js` and `src/agents/registry.test.ts`, matching the implemented file layout.

## Step 2 — App shell layout (done)

**Goal.** Adjust `WorkspaceView`'s grid to handoff §3 proportions (48 / 272 / flex / 284), mount a 38px session-tab strip placeholder above the existing TerminalZone, mount a 24px status bar below the main workspace.

**Files.** `src/features/workspace/WorkspaceView.tsx`, `IconRail.tsx`, `Sidebar.tsx`, new status-bar component.

**DoD.** Region proportions match §3; status bar mounted (placeholder content); session-tab strip mounted (placeholder content); inner regions render unchanged from step 0.

**Risks.** Sidebar resizable behaviour: handoff says fixed 272px. We keep resizable, seed from 272px. If review pushes back, drop resizing in step 3.

## Step 3 — Sidebar sessions list + session tabs (done)

**Goal.** Restyle sidebar sessions list per §4.2; replace placeholder session-tab strip with browser-style tabs per §4.3 wired to `useSessionManager`.

**Files.** `Sidebar.tsx`, new `SessionTabs.tsx`.

**DoD.** Sessions list rows match §4.2 (status dot, title, time, subtitle, state pill, +/- counts); session tabs open/close/`+` interactions work; active tab uses focused agent's accent stripe.

**Risks.** Negative-margin trick on active tab can clip — verify in browser before merge.

## Step 4 — Single TerminalPane (done)

**Goal.** Replace existing TerminalPane with handoff §4.6 spec (collapsible header, scroll body, input footer, focus ring) wired to one PTY.

**Files.** `src/features/terminal/components/TerminalPane/`, consumes `src/agents/registry.ts`.

**DoD.** Pane header collapsible; agent identity chip displays correct accent/glyph; focus ring matches §4.6 spec (outline + box-shadow + cursor swap); status pip tracks PTY health.

**Risks.** Focus-ring transition timing (180–220ms) — verify visually.

## Step 5 — SplitView grid (5a-5c2 done, 5d pending)

**Goal.** Add 5-canonical-layouts CSS Grid `SplitView` with `LayoutSwitcher`. Refactor `TerminalZone` to host SplitView. Wire `Mod+1-4` (focus pane), `Mod+\` (cycle layouts), pane add/remove, and close controls.

**Files.** `src/features/terminal/components/SplitView/`, `src/features/terminal/components/LayoutSwitcher/`, `src/features/terminal/hooks/usePaneShortcuts.ts`, `src/features/sessions/hooks/useSessionManager.ts`, `src/features/workspace/components/TerminalZone.tsx`.

**DoD.** All 5 layouts render correctly using `minmax(0, 1fr)`; users can focus panes, cycle layouts, add panes into empty slots, and close non-last panes with auto-shrink to the smallest fitting layout. Auto-grow on selecting a larger layout is still pending as step 5d.

**Risks.** Bare `1fr` columns shrinking to content. Use `minmax(0, 1fr)` everywhere — covered in §3 of handoff.

## Step 6 — Activity panel

**Goal.** Restyle `AgentStatusPanel` per §4.7 — CONTEXT bar, 5-HOUR USAGE, TURNS, TOKEN CACHE block (big % + sparkline + 3-segment bar + past-sessions bars + NOW pulse). Always-expanded for now; collapse rail in step 9.

**Files.** `src/features/agent-status/components/AgentStatusPanel.tsx`.

**DoD.** Sections render per §4.7; panel header switches agent identity when focused pane changes (driven by step 5's focus state).

**Risks.** Sparkline/bar-chart rendering performance with frequent agent telemetry updates — verify with React profiler.

## Step 7 — DockPanel (done)

**Goal.** Replace `BottomDrawer` with `DockPanel`: Editor / Diff tabs, collapse peek button, position switcher, and bottom / top / left / right docking. The current app keeps Files in the left sidebar rather than adding a Files tab to the dock.

**Files.** `src/features/workspace/components/DockPanel.tsx`, `DockTab.tsx`, `DockSwitcher.tsx`, `DockPeekButton.tsx`, `panels/EditorPanel.tsx`, `panels/DiffPanel.tsx`, `panels/FilesPanel.tsx`.

**DoD.** Dock tab strip and peek button work; position switcher supports all four edges; #219 adds elastic sizing and keyboard-adjustable handles.

**Risks.** Existing diff/editor panels may have layout assumptions broken by tab-strip restyle — visually regress before merge.

## Step 8 — Command palette + keyboard shortcuts (in progress)

**Goal.** Restyle `CommandPalette` per §4.10 (centred modal, blur backdrop, Instrument Sans search input). Verify ⌘K toggle + Esc dismiss; ⌘1-4 / ⌘\ already wired in step 5.

**Files.** `src/features/command-palette/CommandPalette.tsx`, key handler in `WorkspaceView.tsx`.

**DoD.** Selected row accent bar and themed scrollbar landed in #221. Palette modal/input/footer polish remains.

**Risks.** Ctrl+K already used in workspace? Check existing bindings.

## Step 9 — Polish (in progress)

**Goal.** Focus-ring transitions (180–220ms cubic-bezier `pane`), status pips, ContextSmiley, RelTime ticking, activity-panel 36px collapsed rail, status-bar §4.9 contents (`obsidian-cli · v0.9.4` left, ContextSmiley + cache% + turns + ⌘K right).

**Files.** Scattered.

**DoD.** Shared focus highlight and container shortcuts landed in #218; elastic resize landed in #219; shortcut chips landed in #224. Issue #225 tracks the remaining in-UI discovery surface for `Mod+\` and `Mod+B`.

**Risks.** Scope creep — keep this step strictly to polish. Anything structural rolls back into the appropriate earlier step.

## Step 10 — Token cleanup

**Goal.** Close the additive-token strategy. Delete deprecated tokens (`surface-tint` old value, `font-body`, `font-headline`, `font-label`, `tertiary*`, old `secondary-container: #124988`, `on-primary` flat). Codemod `text-vf-*` → `text-*` (overriding Tailwind defaults to handoff scale). Visual regression check on every screen.

**Files.** `tailwind.config.js`, codemod across `src/**/*.{ts,tsx}`.

**DoD.** No reference to deprecated tokens anywhere (`rg` clean); all `text-vf-*` → `text-*`; visual diff vs step 9 is zero.

**Risks.** A consumer of `tertiary` semantic colour that we forget to migrate. Run `rg 'tertiary|font-body|font-headline|font-label|surface-tint|on-primary'` before commit and audit each match.
