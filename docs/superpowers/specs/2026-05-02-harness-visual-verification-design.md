# Harness Visual Verification Design

**Date:** 2026-05-02
**Status:** Design - first deliverable for issue [#76](https://github.com/winoooops/vimeflow/issues/76)
**Builds on:** [Harness Loop v2 proposal](./2026-04-21-harness-loop-v2-proposal.md), [Activity Panel harness retrospective](../../reviews/retrospectives/2026-04-21-activity-panel-harness-session.md)

## Problem

The harness can decompose work, run coder sessions, run code review, and keep tests green. It still cannot tell whether a UI feature visually matches the design target. The activity-panel harness run proved that this gap is material: the output passed tests and review but failed the user's visual bar.

Tier 5 from the v2 proposal covers three related fixes:

- A1: Visual Reviewer role
- A2: prototype screenshots as coder input
- A3: final design coherence pass

This spec resolves the open design questions so implementation can proceed in smaller PRs.

## Goals

- Give UI features a deterministic visual gate before the harness marks them complete.
- Make prototype screenshots and design docs visible to coder sessions before they write code.
- Preserve backend and non-UI harness throughput by gating only visual work.
- Store committed reference assets in a predictable repo location.
- Keep generated screenshots and diff artifacts out of normal commits.
- Add one final composed-screen pass so independently completed UI components are judged together.

## Non-Goals

- Replacing Codex code review. Visual review is an additional gate, not a substitute.
- Requiring Storybook before this can ship. A lightweight fixture route is enough.
- Pixel-perfect enforcement on the first release. The first threshold is intentionally generous.
- Running visual review for backend, CLI, harness-only, or pure test features.
- Persisting every run artifact forever. Failed-run artifacts are temporary debugging output.

## Decisions

| Question           | Decision                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference storage  | Commit references under `docs/design/<surface>/references/<scenario>/<viewport>.png`. Existing `docs/design/<surface>/screen.png` may be referenced for legacy screens, but new captures should use `references/`.              |
| Runtime artifacts  | Write current screenshots and diffs to `harness/.visual-runs/<feature-id>/<timestamp>/`. This directory is generated output and should be git-ignored in the implementation PR.                                                 |
| Diff threshold     | Default to `max_changed_ratio: 0.10` per viewport. The first implementation should also report the exact ratio so later PRs can tighten per-surface thresholds with data.                                                       |
| Feature selection  | Run visual review only for features with `visual_review.mode` of `required` or `advisory`. The Initializer sets this for UI categories and may set `skip` with a reason for non-rendered UI plumbing.                           |
| Missing screenshot | If `mode: required` and no screenshot path exists, visual review may use model judgment only when `allow_model_only: true`; otherwise it fails as "missing visual reference". `advisory` mode may warn without blocking.        |
| Viewports          | Default viewport is `desktop-1440x900`. Add `mobile-390x844` only when the app spec, design ref, or feature description mentions responsive or mobile behavior.                                                                 |
| Browser driver     | Start with Chrome DevTools MCP because it is already present in harness fixture logs and does not require the user's separate Claude browser extension. Keep `claude-in-chrome` as an adapter option, not the first dependency. |
| Diff engine        | Use a small Node script around `pixelmatch` + `pngjs` from the harness, because screenshots are PNGs and the project already depends on Node. The script returns JSON, not prose.                                               |
| Coder input        | Add a `Visual reference` section to `coding_prompt.md` when the selected feature has `design_ref`. It lists spec files and screenshot paths and instructs the coder to read/view them before implementation.                    |
| Coherence pass     | The Initializer appends one synthetic `Design coherence pass` feature when any feature has visual review enabled. Its dependencies are all UI visual features.                                                                  |

## Schema

`feature_list.json` remains an array. The Initializer may add two optional objects to each feature.

```json
{
  "id": 8,
  "phase": 3,
  "category": "frontend-ui",
  "description": "TestResults rewrite + AgentStatusPanel wiring",
  "steps": ["..."],
  "passes": false,
  "dependencies": [7],
  "design_ref": {
    "surface": "agent_status_sidebar",
    "prototype_url": "https://example.invalid/prototype",
    "spec_paths": [
      "docs/design/UNIFIED.md",
      "docs/design/agent_status_sidebar/code.html"
    ],
    "screenshot_paths": [
      "docs/design/agent_status_sidebar/references/test-results/desktop-1440x900.png"
    ]
  },
  "visual_review": {
    "mode": "required",
    "fixture_url": "/__visual__/agent-status/test-results",
    "viewports": [{ "name": "desktop-1440x900", "width": 1440, "height": 900 }],
    "max_changed_ratio": 0.1,
    "allow_model_only": false
  }
}
```

Rules:

- `design_ref.surface` maps to a directory under `docs/design/`.
- `spec_paths` and `screenshot_paths` are repo-relative paths and must exist when `visual_review.mode` is `required`.
- `fixture_url` is relative to the Vite dev server origin.
- `mode` values are `required`, `advisory`, or `skip`.
- `skip` requires `reason`, for example `"reason": "backend-only IPC feature"`.
- After initialization, the existing feature-list hook still allows only `passes` changes. Visual metadata is initialized once and then treated as immutable run contract.

## Reference Assets

Committed reference screenshots use this layout:

```text
docs/design/
`-- <surface>/
    |-- DESIGN.md
    |-- code.html
    |-- screen.png
    `-- references/
        `-- <scenario>/
            |-- desktop-1440x900.png
            `-- mobile-390x844.png
```

`screen.png` remains the human-friendly default screenshot for a surface. `references/` is the machine-readable set used by the harness. A scenario name should be stable and feature-sized, for example `activity-feed-empty`, `activity-feed-running`, or `workspace-composed`.

When a design source is an HTML prototype, the reference-capture flow should render that prototype and write PNGs into `references/`. When the source is an external prototype URL, the user or Initializer must first capture the screenshots into the repo. The harness should not depend on remote prototype availability during a run.

## Visual Fixture URLs

The implementation should add a small visual fixture surface instead of adopting Storybook as a prerequisite.

Proposed route shape:

```text
/__visual__/<surface>/<scenario>
```

Requirements:

- The route renders only the target surface or composed screen, with deterministic fixture data.
- Animations are disabled or frozen where possible.
- Date, time, random IDs, and network results are mocked.
- The route runs in browser/Vite mode and must not require Tauri IPC.
- The route can reuse existing mock data but must not mutate app state.

If a feature touches only a component inside a larger composed panel, the fixture should still render enough surrounding UI to expose spacing, depth, and hierarchy. This is what prevents the "passes alone, fails together" problem from recurring.

## Visual Reviewer Flow

The harness adds a visual-review stage after the code reviewer is clean and before the feature is accepted as passing.

```text
Coder commit
  -> existing verification
  -> Codex local review
  -> Visual Reviewer for required/advisory UI features
  -> mark feature accepted or feed findings back to Coder
```

Visual Reviewer steps:

1. Resolve the selected feature's `design_ref` and `visual_review` objects.
2. Start or reuse Vite on `127.0.0.1` in the worktree.
3. For each viewport:
   - open `fixture_url`,
   - wait for network idle or an explicit ready marker,
   - capture a PNG screenshot,
   - compare it with the matching reference screenshot when available.
4. If no screenshot comparison is available and model-only review is allowed:
   - pass the current screenshot, design snippets, and feature description to a model reviewer,
   - ask for a strict pass/fail judgment with concrete visual findings.
5. Return structured JSON to the harness.

Result format:

```json
{
  "status": "fail",
  "feature_id": 8,
  "mode": "required",
  "artifacts_dir": "harness/.visual-runs/8/20260502T120000Z",
  "viewports": [
    {
      "name": "desktop-1440x900",
      "changed_ratio": 0.184,
      "threshold": 0.1,
      "reference": "docs/design/agent_status_sidebar/references/test-results/desktop-1440x900.png",
      "actual": "harness/.visual-runs/8/20260502T120000Z/desktop-1440x900.actual.png",
      "diff": "harness/.visual-runs/8/20260502T120000Z/desktop-1440x900.diff.png"
    }
  ],
  "findings": [
    {
      "id": "VIS-1",
      "severity": "HIGH",
      "title": "Activity rows lost glass depth and compact spacing",
      "viewport": "desktop-1440x900",
      "evidence": "Pixel diff changed 18.4%, concentrated in the row stack and header controls.",
      "expected": "Match the reference row density, tonal layering, and button scale.",
      "actual": "Rows render as flat cards with larger gaps and oversized controls."
    }
  ]
}
```

Failure handling:

- `required + fail`: feed findings to the next Coder iteration and do not accept the feature.
- `required + error`: fail closed unless the error is explicitly classified as infrastructure flake and the retry budget remains.
- `advisory + fail`: print findings and attach them to the run log, but do not block unless severity is `HIGH` or above.
- `skip`: no visual reviewer run.

## Coder Prompt Integration

When a selected feature has `design_ref`, the harness prepends a generated section to the coding prompt:

```text
## Visual reference

This feature has a visual target. Before implementing, inspect:

- Design specs:
  - docs/design/UNIFIED.md
  - docs/design/agent_status_sidebar/code.html
- Reference screenshots:
  - docs/design/agent_status_sidebar/references/test-results/desktop-1440x900.png

Use these assets as ground truth for spacing, hierarchy, depth, and state.
Do not rely only on prose in app_spec.md.
```

This addresses retrospective item 12 directly: screenshots captured during planning must reach the coder as local file paths, not as remote URLs or prose summaries.

## Initializer Changes

The Initializer is responsible for visual metadata because the feature-list hook freezes feature shape after initialization.

Initializer additions:

- Classify rendered UI features as `visual_review.mode: "required"` by default.
- Classify frontend plumbing without a rendered surface as `advisory` or `skip` with a reason.
- Populate `design_ref.surface` when an `app_spec.md` section names a design folder under `docs/design/`.
- Populate `spec_paths` from linked design docs and prototypes.
- Populate `screenshot_paths` from `docs/design/<surface>/references/**/<viewport>.png`, falling back to `docs/design/<surface>/screen.png` only for existing surfaces.
- Add `fixture_url` using the proposed `/__visual__/<surface>/<scenario>` route.
- Append `Design coherence pass` when at least one feature has `required` or `advisory` visual review.

Synthetic feature shape:

```json
{
  "id": 99,
  "phase": 99,
  "category": "visual-coherence",
  "description": "Design coherence pass - compare the composed UI against the full reference surface and refine spacing, rhythm, depth, and state transitions",
  "steps": [
    "Open the composed visual fixture",
    "Compare against the full-surface reference screenshot",
    "Refine cross-component spacing, hierarchy, and tonal depth",
    "Run required checks and visual review"
  ],
  "passes": false,
  "dependencies": [8, 9, 10],
  "design_ref": {
    "surface": "agent_status_sidebar",
    "spec_paths": ["docs/design/UNIFIED.md"],
    "screenshot_paths": [
      "docs/design/agent_status_sidebar/references/workspace-composed/desktop-1440x900.png"
    ]
  },
  "visual_review": {
    "mode": "required",
    "fixture_url": "/__visual__/agent-status/workspace-composed",
    "viewports": [{ "name": "desktop-1440x900", "width": 1440, "height": 900 }],
    "max_changed_ratio": 0.1,
    "allow_model_only": false
  }
}
```

The coherence pass has no special exemption from tests. It is a normal feature whose primary acceptance gate is visual review.

## Implementation Slices

1. **Schema and prompt plumbing**
   - Extend Initializer prompt docs with `design_ref` and `visual_review`.
   - Add generated `Visual reference` prompt section for coder sessions.
   - Add tests for selecting UI features and preserving schema.

2. **Fixture route and reference layout**
   - Add the `/__visual__/<surface>/<scenario>` route.
   - Add the first fixture for a current design surface.
   - Add `.gitignore` entry for `harness/.visual-runs/`.

3. **Screenshot and pixel diff runner**
   - Add a harness visual-review module.
   - Start/reuse Vite.
   - Use Chrome DevTools MCP to capture screenshots.
   - Use `pixelmatch` JSON output for threshold decisions.

4. **Harness loop integration**
   - Insert visual review after local code review.
   - Feed `VIS-*` findings through the existing retry prompt path.
   - Enforce required/advisory/skip semantics.

5. **Design coherence pass**
   - Teach Initializer to append the synthetic feature.
   - Add a composed fixture and reference screenshot.
   - Verify that a UI run cannot finish without the coherence feature passing.

## Acceptance Criteria

- UI features in `feature_list.json` carry `design_ref` and `visual_review` metadata after initialization.
- Coder prompts include local screenshot paths for UI features.
- A required UI feature with a changed-pixel ratio above 10% fails visual review and returns actionable `VIS-*` findings.
- A backend feature does not start Vite or run visual review.
- Missing required screenshots fail loudly unless `allow_model_only` is set.
- The Initializer appends exactly one `Design coherence pass` when any visual feature exists.
- Runtime screenshots and diffs are written under `harness/.visual-runs/` and are not committed by default.
- A rerun of the rejected activity-panel style workflow would block before `passes: true` if the rendered output is visually far from the reference.

## Open Follow-Ups

- Tune thresholds per surface after the first few real runs.
- Decide whether mobile viewports should become default for all layout features once fixture coverage is stable.
- Add masking support for intentionally dynamic regions if needed.
- Consider Storybook only if fixture routes become hard to maintain.
