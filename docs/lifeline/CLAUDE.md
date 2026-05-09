# Lifeline — Plugin Workflow Notes

English | [简体中文](./CLAUDE.zh-CN.md)

Lifeline is the extracted Claude Code plugin that now owns Vimeflow's autonomous development loop, local Codex review, PR opener, PR review-fix loop, and PR finisher. Source of truth: <https://github.com/winoooops/lifeline>.

The old in-repo `harness/` scripts, `plugins/harness/` plugin, `.claude-plugin/` marketplace, and `scripts/review*.sh` helpers are intentionally removed from this repository. Do not re-add them here; change the shared workflow in the Lifeline repository instead.

Dated specs, changelog entries, review patterns, and retrospectives may still mention `harness-plugin` or `harness/` as historical context. Treat this page, the root `README.md`, root `CLAUDE.md`, `AGENTS.md`, and `rules/` as the current workflow contract.

## Install

```bash
/plugin marketplace add winoooops/lifeline
/plugin install lifeline@lifeline
/reload-plugins
```

For local Lifeline development, register a local clone instead:

```bash
/plugin marketplace add /absolute/path/to/lifeline
/plugin install lifeline@lifeline
/reload-plugins
```

## Skills

| Skill                       | Use                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `/lifeline:planner`         | Brainstorm and write a design spec, then run Codex review on the spec.                                    |
| `/lifeline:loop`            | Launch the autonomous implementation loop.                                                                |
| `/lifeline:review`          | Run local Codex review against the staged diff.                                                           |
| `/lifeline:request-pr`      | Open a PR from the current branch.                                                                        |
| `/lifeline:upsource-review` | Fetch and fix PR review findings from Claude Code Review, `chatgpt-codex-connector`, and human reviewers. |
| `/lifeline:approve-pr`      | Finish a PR end-to-end: squash, delete branches, sync main, and clean worktrees.                          |

## Vimeflow Integration

- `AGENTS.md` remains the Codex review context for `/lifeline:review`, `/lifeline:upsource-review`, and GitHub PR review.
- `.github/workflows/claude-review.yml` and `.github/codex/codex-output-schema.json` stay in this repo because Lifeline's upsource loop consumes the `## Claude Code Review` comment they produce.
- `.lifeline-upsource-review/` is gitignored for per-cycle artifacts. The old `.harness-github-review/` directory name is not used by Lifeline.
- `app_spec.md`, `feature_list.json`, `.feature_list_stamp.json`, and `claude-progress.txt` remain gitignored because Lifeline's loop can still generate project-root runtime files.
- New review knowledge-base entries from Lifeline cycles should use the source labels in `docs/reviews/CLAUDE.md`.

## Migration Notes

If a developer still has local `.harness-github-review/` artifacts from the old plugin, inspect any `cycle-*-aborted/` directories manually before deleting them. Lifeline will not recover those old artifact directories automatically.

If Lifeline slash commands are missing after install, rerun `/reload-plugins`. For autocomplete wrapper aliases, use the snippet in the root `CLAUDE.md` Lifeline setup section.
