# PR1 — Spec Artifacts And Documentation Guardrails

**Status:** draft
**Scope:** documentation only
**Base branch:** `main`
**Feature branch:** `feature/vim-127`
**Linear:** [VIM-127](https://linear.app/vimeflow/issue/VIM-127/epic-stabilize-activity-panel-hot-reload-across-pane-switching)

## Goal

Create the first implementation-ready plan for VIM-127 without changing runtime code. This PR establishes the five-PR sequence, the supporting HTML analysis, the validation expectations, and the Claude Code review loop.

## Changes

- Add the VIM-127 spec bundle under `docs/superpowers/specs/2026-06-14-activity-panel-hot-reload/`.
- Add five PR draft documents so each implementation PR starts from a concrete but revisitable plan.
- Keep the Chinese technical analysis at `docs/design/activity-panel-hot-reload-analysis.html` as the supporting design document.
- Opt that single HTML document back into Prettier with a `.prettierignore` exception.

## Checks

- `npx prettier --check docs/design/activity-panel-hot-reload-analysis.html`
- `npx prettier --check docs/superpowers/specs/2026-06-14-activity-panel-hot-reload/**/*.md`
- `npm run format:check`
- Local Claude Code review until `overall_correctness` is `patch is correct`.

If `npm run format:check` fails because of unrelated pre-existing ignored or untracked docs, keep the failure isolated in the PR notes and do not repair unrelated files in this PR.

## Acceptance Criteria

- The PR contains only documentation, `.prettierignore`, and the supporting HTML artifact.
- The plan is in English so it matches the project's existing `docs/superpowers` context.
- The HTML supporting artifact passes Prettier directly.
- Claude Code reviewer approves the patch.

## PR Boundary Notes

Before PR2 starts, reread this spec and revise PR2's plan if the accepted PR1 review identifies a better sequencing or validation strategy. Do not treat this first draft as frozen.
