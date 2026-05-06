---
title: UI Handoff Migration — Design Spec
date: 2026-05-05
status: draft
owners: [winoooops]
related:
  - docs/design/handoff/README.md
  - docs/design/UNIFIED.md
  - docs/roadmap/progress.yaml
  - docs/roadmap/tauri-migration-roadmap.md
---

# UI Handoff Migration

## Context

`docs/design/handoff/` (currently untracked in `main`) is a high-fidelity handoff package — README + HTML/React prototype + screenshots — for the full Vimeflow desktop shell. It supersedes the visual + behavioural targets in `docs/design/UNIFIED.md` for the parts it covers (icon rail, sidebar, session tabs, layout switcher, split view, terminal pane, activity panel, bottom panel, status bar, command palette).

The existing `WorkspaceView` already implements ~80% of these regions in shape, wired to real Tauri commands (`spawn_pty`, `write_pty`, `list_sessions`, `list_dir`, `read_file`, `git_status`, `get_git_diff`, `detect_agent_in_session`, …). What changes is the visual language, region proportions, and a few new behaviours (5-layout `SplitView`, browser-style session tabs, collapsible 36px activity rail, agent-accent focus rings).

This is a multi-PR **migration**, not a green-field build. Tauri backend untouched.

## Goals

1. Match the handoff visual + behavioural spec pixel-for-pixel for the canonical `obsidian` aesthetic.
2. Land the migration as a sequence of small, mergeable PRs aligned to handoff §9's nine-step implementation order, plus a final token-cleanup pass we add (step 10).
3. Keep all existing Tauri integrations working at every intermediate step.
4. Track progress in repo-native artifacts that mirror the existing `tauri-migration-roadmap.md` ↔ `progress.yaml` pair.

## Non-goals

- Porting the prototype's localStorage `tweaks` system, `window.parent.postMessage` edit-mode protocol, or `editorial`/`dense` aesthetic variants. Only `obsidian` ships.
- Replacing the Rust backend or any Tauri command.
- Breaking parity with existing test coverage. Each PR keeps `vitest run` green.

## Decisions (resolved during brainstorming)

| #   | Decision                                                                            | Rationale                                                                                                                                |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Decompose by handoff §9's 9-step order, plus a final token-cleanup step (10) we add | Pre-validated ordering; smallest blast radius first (tokens), proportions next, polish last. Step 10 closes the additive-token strategy. |
| 2   | In-place refactor; new files only when no existing analogue                         | Branch is the isolation; existing Tauri hooks are reusable; doubling the component tree adds cognitive load.                             |
| 3   | Additive token migration with parallel new names; final cleanup PR after step 9     | Eliminates silent value-shift risk. Old class names keep rendering old colours/sizes until each consumer is migrated.                    |
| 4   | Two PRs for steps 1 + 2 (one per step)                                              | Step 1 has zero visual change; step 2 is the first visible diff. Reviewable in isolation.                                                |
| 5   | Step 1 includes both `tailwind.config.js` extensions AND `src/agents/registry.ts`   | Handoff §6 ships them together; registry has zero runtime cost when unused.                                                              |

## Architecture

### Tracking artifacts

Two paired files, matching existing `tauri-migration-roadmap.md` ↔ `progress.yaml` convention:

- **`docs/roadmap/ui-update-roadmap.md`** (new) — human narrative. One section per §9 step with: goal, files touched, DoD bullets, risks.
- **`docs/roadmap/progress.yaml`** (extend) — append a new phase `ui-handoff-migration` with 9 steps, statuses (`pending|in_progress|done|blocked`), and PR/commit linkage on landing.

### Module decomposition (handoff §9, plus step 10 cleanup)

Steps 1–9 mirror handoff §9 verbatim. Step 10 is added by this spec to close the additive-token strategy.

| Step | Module                               | Files (primary)                                                                                       | DoD                                                                                                                                                                                                                           |
| ---- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Tokens + agents registry             | `tailwind.config.js`, `src/agents/registry.ts`                                                        | New tokens present; existing classes unchanged; agents registry exported and typed.                                                                                                                                           |
| 2    | App shell layout                     | `src/features/workspace/WorkspaceView.tsx`, `IconRail.tsx`, `Sidebar.tsx`, status-bar component (new) | Region proportions match §3 (48 / 272 / flex / 284) ; 24px status bar mounted; 38px session-tab strip mounted (placeholder); inner regions still current implementation.                                                      |
| 3    | Sidebar sessions list + session tabs | `Sidebar.tsx`, new `SessionTabs.tsx`                                                                  | Sidebar sessions list restyled to §4.2; browser-style session-tab strip wired to `useSessionManager`; tab open/close/`+` work.                                                                                                |
| 4    | Single TerminalPane                  | `src/features/terminal/components/TerminalPane.tsx`, agents registry consumed                         | Pane header (collapsible) + scroll body + input footer per §4.6; focus ring; agent identity chip; wired to one PTY.                                                                                                           |
| 5    | SplitView grid                       | new `SplitView.tsx` + `LayoutSwitcher.tsx`; refactor `TerminalZone.tsx`                               | 5 layouts via CSS Grid with `minmax(0, 1fr)`; ⌘1-4 focus, ⌘\ toggle; pane spawn/close auto-shrink.                                                                                                                            |
| 6    | Activity panel                       | `src/features/agent-status/components/AgentStatusPanel.tsx`                                           | Always-expanded sections per §4.7 (CONTEXT bar, 5-HOUR USAGE, TURNS, TOKEN CACHE block); follows pane focus; collapse rail (36px) added in step 9 polish.                                                                     |
| 7    | Bottom panel                         | `src/features/workspace/components/BottomDrawer.tsx`, `panels/{EditorPanel,DiffPanel,FilesPanel}.tsx` | Tab strip restyled per §4.8; 26px "show editor & diff" peek button when collapsed.                                                                                                                                            |
| 8    | Command palette + keyboard shortcuts | `src/features/command-palette/CommandPalette.tsx`, key handler in `WorkspaceView.tsx`                 | ⌘K toggles modal per §4.10; ⌘1-4 / ⌘\\ already wired in step 5; Esc dismisses.                                                                                                                                                |
| 9    | Polish                               | scattered                                                                                             | Focus rings transition 180–220ms, status pips, ContextSmiley, RelTime ticking, activity-panel collapse rail, status-bar §4.9 contents.                                                                                        |
| 10   | Cleanup (token rename pass)          | `tailwind.config.js`, codemod across `src/**/*.{ts,tsx}`                                              | Old tokens deleted (`surface-tint`, `font-body/headline/label`, `tertiary*`, old `secondary-container`, `on-primary`). `text-vf-*` renamed to `text-*` overriding Tailwind defaults. Visual regression check on every screen. |

### Token migration plan (step 1)

**Additive entries in `tailwind.config.js`:**

- `colors.primary-deep: '#57377f'` — deep-purple companion to `primary`. (Handoff `secondary.container`. Renamed because existing `secondary-container: '#124988'` is azure and stays for backward compat until cleanup.)
- `colors.on-surface-muted: '#8a8299'` — no existing analogue.
- `colors.warning: '#ff94a5'` — alias to existing `tertiary` value.
- `colors.syn.{keyword, string, fn, var, comment, type, tag}` — Catppuccin syntax subset for terminal/code rendering.
- `fontSize.{vf-2xs, vf-xs, vf-sm, vf-base, vf-lg, vf-xl, vf-2xl}` — handoff scale under `vf` namespace so existing `text-base` etc. keep current sizes during migration.
- `borderRadius.{pane, tab, chip, pill, modal}` — semantic radii.
- `boxShadow.{pane-focus, modal, pip-glow}` — handoff §6.
- `transitionTimingFunction.pane: cubic-bezier(0.32, 0.72, 0, 1)`.
- `fontFamily.{sans: Inter, display: Instrument Sans → Manrope, mono: JetBrains Mono}` — added alongside existing `headline/body/label` aliases.

**Untouched at step 1**: every existing token. Old class names render unchanged values.

**New file `src/agents/registry.ts`**:

```ts
export const AGENTS = { claude: {...}, codex: {...}, gemini: {...}, shell: {...} } as const
export type AgentId = keyof typeof AGENTS
```

per handoff §6's TypeScript snippet — id, name, short, glyph, model, accent, accentDim, accentSoft, onAccent.

### Refactor strategy

**In-place** on the `worktree-ui-update` branch. New components added only when no existing analogue exists (e.g., `SplitView`, `LayoutSwitcher`, per-pane `TerminalPane` wrapper). Existing Tauri hooks (`useSessionManager`, `useAgentStatus`, `useGitStatus`, `useEditorBuffer`, `createTerminalService`, `createFileSystemService`) reused as-is.

Trade-off: intermediate commits between step 2 and step 9 may render an "in-progress" UI (e.g., new tokens applied but sidebar still 340px wide). Acceptable on a feature branch — every PR ships a coherent, mergeable state.

### Setup actions (executed before step 1 PR opens)

1. `mv` the untracked `docs/design/handoff/` from main checkout into this worktree at the same path; `git add` it.
2. Create `docs/roadmap/ui-update-roadmap.md` with §9-aligned narrative.
3. Append `ui-handoff-migration` phase to `docs/roadmap/progress.yaml`.
4. Single setup commit: `chore: scaffold ui-update tracking + import handoff bundle`.

### Testing approach

- Step 1: extend or add a `tailwind.config.test.ts` asserting new token keys present; no component test changes.
- Step 2+: each new/restyled component gets/keeps a sibling `.test.tsx`. Tests exercise observable behaviour (region proportions, keyboard wiring, focus state, pane lifecycle), not implementation details.
- Pre-push hook (`vitest run`) gates every PR. ESLint + Prettier via lint-staged on commit.
- Per `rules/typescript/testing/CLAUDE.md`: `test()` not `it()`; co-located test files; testing-library queries.

### Out of scope (explicit non-ports)

- LocalStorage `tweaks` system from prototype `app.jsx`.
- `window.parent.postMessage` edit-mode protocol.
- `aesthetic` and `density` variants (`editorial`, `dense`). Only `obsidian` ships.
- Prototype's mock data (`VIMEFLOW_SESSIONS`, `VIMEFLOW_TREE`, etc.) — replaced by existing Tauri commands.

## Risks & mitigations

| Risk                                                                              | Mitigation                                                                                                                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing usage of `secondary-container` (azure) shifts when we add `primary-deep` | Token is additive; existing class name unchanged in value. Risk only at step 10 cleanup; do a `grep -rn 'secondary-container'` audit before deleting. |
| `text-vf-*` namespace bloats config and is forgotten at cleanup                   | Cleanup is its own tracked PR (step 10) with codemod. The `vf-` prefix makes it grep-able.                                                            |
| Handoff and existing `UNIFIED.md` design contradict                               | When in doubt, handoff wins — handoff is newer and more complete. Note this in `docs/design/UNIFIED.md` with a banner pointing at the handoff.        |
| Sidebar resizable behaviour conflicts with handoff's fixed 272px spec             | Keep resizable; seed from 272px. If review pushes back, drop resizing in step 3.                                                                      |

## Open questions

- Should `docs/design/UNIFIED.md` be updated in this migration, or left as-is and superseded by handoff? (Default: leave + add banner.)
- Does the existing test runner cover `tailwind.config.js`? If not, step 1 may add the first config-shape test in the repo.

## References

- `docs/design/handoff/README.md` — primary spec (after move into worktree)
- `docs/design/UNIFIED.md` — older 5-zone layout spec (partially superseded)
- `docs/roadmap/tauri-migration-roadmap.md` — example of human-readable roadmap format
- `docs/roadmap/progress.yaml` — example of machine-readable schema
- `rules/typescript/coding-style/CLAUDE.md` — code style rules
- `rules/typescript/testing/CLAUDE.md` — testing rules

## Next step after approval

Invoke `superpowers:writing-plans` to produce the implementation plan for **step 1 only** (tokens + agents registry). Step 2 gets its own plan after step 1 lands.
