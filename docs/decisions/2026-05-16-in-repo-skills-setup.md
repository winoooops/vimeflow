# In-repo skill symlinks for /lifeline:planner and /lifeline:upsource-review

**Date:** 2026-05-16
**Status:** Accepted
**Scope:** Records the convention that `skills/<skill-name>` symlinks pointing into `~/.claude/plugins/cache/lifeline/lifeline/<version>/skills/<skill-name>/` must exist in every checkout that runs `/lifeline:planner` or `/lifeline:upsource-review`. The Electron migration was the first project to depend on this setup end-to-end (PR-D1 spec, PR-D2 spec, PR-D3 spec + plan); this ADR captures the why and the maintenance contract.

**Companion skill (no setup needed):** `native-feel-cross-platform-desktop` is a system-wide skill loaded from `~/.claude/skills/` (or equivalent). It does NOT need the symlink because its content lives in the skill definition itself rather than in helper bash scripts. The Electron migration's design phase used it before any spec was written; pairs naturally with `/lifeline:planner` for new desktop migrations. See the Electron migration retrospective (§ "Notes on the skill toolkit used for this migration") for how the two compose.

**Predecessors:**

- User memory entry `reference_lifeline_skill_dir_workaround.md` (2026-05-06) — the original capture.
- Lifeline plugin runbook: <https://github.com/winoooops/lifeline>

## Context

The `/lifeline:planner` and `/lifeline:upsource-review` skills ship as Claude plugins under `~/.claude/plugins/cache/lifeline/lifeline/<version>/skills/<skill-name>/`. Each skill's bash helpers (`scripts/codex-review.sh`, `scripts/update-footer.sh`, `scripts/resolve-skill-dir.sh`) resolve their own working directory via a lookup chain that hard-codes `skills/<skill-name>` as a project-relative path (with the repo-root fallback at `<repo-root>/skills/<skill-name>`). Neither path finds the actual install under the Claude plugins cache.

The result: out of the box, on a fresh checkout, `/lifeline:planner` fails with `no prompt template for hook 'spec-complete'` when `codex-review.sh` tries to load `references/codex-prompts/spec-complete.md`. The fix is a one-time symlink:

```bash
mkdir -p skills
ln -sfn ~/.claude/plugins/cache/lifeline/lifeline/<version>/skills/planner skills/planner
ln -sfn ~/.claude/plugins/cache/lifeline/lifeline/<version>/skills/upsource-review skills/upsource-review
grep -qxF "skills/" .git/info/exclude || echo "skills/" >> .git/info/exclude
```

After this, every helper script resolves cleanly. Codex review output lands in `.lifeline-planner/{spec,section,plan}-{complete,partial}-review.md`; both the planner artifacts and the symlinks are gitignored.

## Options Considered

1. **Status quo — leave the symlink as tribal knowledge.** Captured only in user memory; new contributors hit the failure mode and have to dig.
2. **Patch `codex-review.sh` upstream.** Submit a PR to <https://github.com/winoooops/lifeline> teaching `resolve-skill-dir.sh` to also probe the Claude plugin cache. Removes the workaround entirely.
3. **Symlink the skills into the repo (this ADR's choice) and capture the convention as a project decision.**

## Decision

Choose option 3 now, with option 2 as a deferred follow-up.

The repo includes (via `.git/info/exclude`) symlinks `skills/planner` and `skills/upsource-review` pointing at the plugin cache. New contributors run the bootstrap snippet in `CLAUDE.md`'s "Lifeline Plugin Setup" section before the first `/lifeline:*` invocation. The ADR captures the reasoning so the symlinks don't appear arbitrary when someone reads the repo from scratch.

## Justification

1. **Tractable in-repo, intractable upstream right now.** The lifeline plugin is in active development; the resolution-path question depends on whether `LIFELINE_SKILL_DIR` env var support is reliable across plugin versions. Upstream changes need a stable target before they're worth submitting.
2. **The skills are load-bearing for non-trivial PRs in this repo.** The Electron migration's 3 design specs + 1 plan all went through `/lifeline:planner`'s end-of-spec + plan-complete codex review hooks. Disabling that flow because of a symlink hiccup is bad ergonomics; the bootstrap-once-per-clone setup is the right cost.
3. **Symlinks-via-git-exclude is the lightest weight option.** No package.json changes, no postinstall hook, no bash helper to install. The symlinks are explicit (`ls -la skills/` shows the targets); they don't survive a `rm -rf skills && git clean -fd` so contributors who blow them away can re-create with a one-liner.
4. **Captures the dependency on the lifeline plugin version.** The symlink target embeds the version number (`lifeline/0.0.2/skills/planner`). When a new plugin version lands and breaks compatibility, the symlink is the place to swap.

## Alternatives Rejected

### Option 1 — Status quo (tribal knowledge)

Rejected. The Electron migration retro (`docs/superpowers/retros/2026-05-16-electron-migration.md`) explicitly calls out the in-repo skill setup as load-bearing. Anyone arriving to continue the work on a fresh clone hits the failure mode and wastes 10-30 minutes diagnosing it. Even the existing tribal-knowledge note in user memory only helps the current operator, not new contributors.

### Option 2 — Patch `codex-review.sh` upstream

Deferred. The lifeline plugin's resolution-path code already has a `LIFELINE_SKILL_DIR` env var override and a `resolve-skill-dir.sh` lookup chain; teaching it to also probe `~/.claude/plugins/cache/lifeline/lifeline/<version>/skills/<name>/` is mechanically simple. The hold-up is testing across plugin versions and across the symlinked-into-project vs cache-only deployment modes — that's its own debug session against the lifeline test harness. Plan to revisit when the plugin's resolution code stabilizes; if upstream lands the probe, this ADR can move to `Status: Superseded`.

## Known Risks & Mitigations

1. **Symlinks break on `git clean -fdx` or `rm -rf skills/`.** Mitigation: the bootstrap snippet in `CLAUDE.md` is short enough that anyone re-creating the workspace can re-run it. The bootstrap also lives in this ADR for offline reference.
2. **Plugin version bump invalidates the symlink target.** Mitigation: when the symlink target stops resolving, `ls -la skills/planner` shows a red dangling link and the failure is loud. Re-run the bootstrap with the new version. Could automate via a `prepare:skills` npm script if this becomes painful.
3. **Symlinks aren't committed, so the convention isn't enforced by git.** Mitigation: the `CLAUDE.md` Lifeline Plugin Setup section names this ADR as the source of truth. New contributors reading the project bootstrap docs see the requirement before running `/lifeline:planner`.
4. **Linux-only assumption.** The symlink approach works on macOS too (Apple Silicon Macs use the same `~/.claude/plugins/cache/...` path). Windows would need a junction (`mklink /J`) or WSL. The repo's CI is Linux-only post-PR-D3; Windows contributors are out of scope until a multi-platform CI matrix lands.

## References

- Lifeline plugin runbook: <https://github.com/winoooops/lifeline>
- The Electron migration retro that motivated this ADR: [`../superpowers/retros/2026-05-16-electron-migration.md`](../superpowers/retros/2026-05-16-electron-migration.md)
- Project CLAUDE.md → "Lifeline Plugin Setup" section (top-level setup instructions for new contributors)
- `resolve-skill-dir.sh` source (in plugin cache): `~/.claude/plugins/cache/lifeline/lifeline/<version>/skills/planner/scripts/resolve-skill-dir.sh`
