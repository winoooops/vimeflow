# CHANGELOG + Reviews Pairing — Design Spec

**Date**: 2026-04-19
**Status**: Draft

## Problem

Vimeflow tracks *what changed* (commits, PRs, `progress.yaml`) and *why it
broke in review* (`docs/reviews/patterns/*.md`) in separate places. There is
no single linear timeline that answers "what shipped on date X, and which
review-learning did that change apply or create?" Roadmap progress is a
forward-looking plan, commit history is unbrowsable prose, and the reviews
knowledge base is thematic — none of them carry the retrospective narrative
of the project.

## Solution

A hand-curated `CHANGELOG.md` at the repo root, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with each entry
optionally cross-linking the review patterns it applied, updated, or
created. The CHANGELOG becomes the timeline; `docs/reviews/` remains the
thematic index. Together they form a retrospective archive.

## Decisions

| Decision         | Choice                                                                      | Rationale                                                              |
| ---------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Location         | `CHANGELOG.md` at repo root                                                 | Keep a Changelog convention; discoverable; GitHub renders on releases  |
| Format           | Keep a Changelog 1.1.0                                                      | Wide recognition, clean Added/Changed/Fixed/Removed/Security sections  |
| Scope prior to 1.0 | Single `[Unreleased]` block sub-grouped by roadmap phase                  | Project is pre-release; phase grouping maps entries to `progress.yaml` |
| Entry shape      | `- <prose> ([#PR](url), <short-sha>) — patterns: [Name](path), [Name](path)` | Two click-throughs: change provenance + learning context               |
| Expanded entries | Indented nested bullet (`    - …`) under the parent bullet                  | Plain markdown, grep-friendly, no HTML — renders consistently everywhere |
| Bilingual pair   | `CHANGELOG.md` (English) + `CHANGELOG.zh-CN.md` (Simplified Chinese)        | Mirrors README.md / README.zh-CN.md pairing already in the repo        |
| Authoring        | Hand-curated, appended on merge — both language files updated together      | ~5 min/merge buys the retrospective cross-links auto-tools cannot      |
| Backfill source  | `docs/roadmap/progress.yaml` + `git log`                                    | progress.yaml is the authoritative milestone map; commits fill detail  |
| Pattern linking  | Optional; required for Security and Fixed entries when a pattern exists    | Don't force noise on unrelated features; enforce the retrospective tie |
| Link style       | Relative for in-repo (patterns, specs); absolute GitHub URLs for PRs        | Relative links survive repo renames; PR URLs are externally clickable  |
| Discovery        | Linked from `README.md`, `README.zh-CN.md`, `docs/CLAUDE.md`, `docs/reviews/CLAUDE.md` | Agents and humans find it from any of the docs entry points            |

## CHANGELOG Structure

```markdown
# Changelog

🇺🇸 English | [🇨🇳 简体中文](./CHANGELOG.zh-CN.md)

All notable changes to Vimeflow are recorded here. …pairing note…
…update protocol…

---

## [Unreleased]

### Phase 4 — Agent Status Sidebar (in progress)

#### Added
- <change> ([#PR](url), <sha>) — patterns: [Name](docs/reviews/patterns/x.md)
    - Optional nested bullet for session-scope / deferred notes / spec links.
- <another change> ([#PR](url), <sha>)

#### Fixed
- <change> ([#PR](url), <sha>) — patterns: [Name](docs/reviews/patterns/x.md)

### Phase 3 — Terminal Core
…

---

## Legend
- **Added** / **Changed** / **Fixed** / **Removed** / **Security**
```

The zh-CN file (`CHANGELOG.zh-CN.md`) mirrors this structure with Simplified
Chinese prose; section anchors and pattern paths are shared between the two.

## Entry Categorization Rules

| Keep a Changelog section | When to use                                                 |
| ------------------------ | ----------------------------------------------------------- |
| Added                    | New user-visible capability, file, command, or dependency   |
| Changed                  | Behavioral/API update that is not a fix                     |
| Deprecated               | Capability marked for future removal (none yet)             |
| Removed                  | Deleted capability, file, or dependency                     |
| Fixed                    | Bug fix (link a pattern if one informed or was created)     |
| Security                 | Security-relevant fix — pattern link **required**           |

Phases come from `docs/roadmap/progress.yaml`. A change that spans phases is
filed under the phase it completes, with a cross-reference in the prose.

## Update Protocol

On every merge to `main`:

1. Identify which roadmap phase the change belongs to (`progress.yaml`).
2. Append one bullet under the correct `#### <Category>` heading of that
   phase in `[Unreleased]`.
3. Fill the entry shape: `- <prose> ([#PR](url), <short-sha>) — patterns: [Name](path)`.
4. For multi-change PRs, one bullet per user-visible change is preferred
   over one bullet per PR.
5. For last-session or otherwise noteworthy entries, add one or more
   indented nested bullets (`    - …`) beneath the parent bullet with scope
   notes, deferred follow-ups, or spec path.
5a. Mirror the entry into `CHANGELOG.zh-CN.md` with translated prose;
    PR URLs, commit SHAs, and pattern paths are identical across files.
6. Review the diff and confirm any new `docs/reviews/patterns/*.md` finding
   is linked; bump its `ref_count` per `docs/reviews/CLAUDE.md` protocol.

Releases (post-1.0) will cut `[Unreleased]` into a dated section and reset.

## Backfill Strategy

Walk `progress.yaml` top-down and materialize entries for every phase whose
status is `done` or `in_progress`. For each phase:

1. Read the step/dod rows with `commit`/`pr` fields — these become the raw
   events.
2. Collapse consecutive commits that belong to the same logical change
   (e.g. Phase 2's ten commits → one "Workspace layout shell (4-zone)"
   entry plus distinct follow-up entries for each PR).
3. Pull short commit messages via `git log --oneline <sha>` for prose, and
   PR titles via `gh pr view <n> --json title,url` for links.
4. Cross-link pattern files whose category matches the change (e.g. E2E
   infra → `e2e-testing.md`, WebKitGTK fix → `cross-platform-paths.md`,
   README refresh → `documentation-accuracy.md`). Err on the side of
   under-linking — better one accurate link than three tenuous ones.
5. For Phase 4 (in progress), the most recent entry is the **E2E session**
   (#70, `e97c1e8`) and receives indented nested bullets mirroring the
   `progress.yaml` p4-d6 note (10 spec files, 11 tests, WSL2 deferred,
   follow-ups, spec path).
6. After finishing the English file, translate each entry into
   `CHANGELOG.zh-CN.md` — same structure, same links, Chinese prose.

## Discovery Touch-Points

Every doc that currently describes "how the project is organized" needs a
CHANGELOG reference. These edits are in-scope for this work:

| File                              | Change                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `README.md`                       | Add short "Changelog" section pointing to `CHANGELOG.md` and explaining pairing         |
| `README.zh-CN.md`                 | Add "更新日志" section pointing to `CHANGELOG.zh-CN.md`                                  |
| `CHANGELOG.md`                    | New — English timeline                                                                   |
| `CHANGELOG.zh-CN.md`              | New — Simplified Chinese mirror                                                          |
| `CLAUDE.md` (root)                | Add one row to the navigation table: `Linear change timeline → CHANGELOG.md`            |
| `docs/CLAUDE.md`                  | Add a short blurb noting CHANGELOG lives at repo root and pairs with `reviews/`         |
| `docs/reviews/CLAUDE.md`          | Add a note that the CHANGELOG is the timeline companion; each merge appends a bullet    |
| `docs/roadmap/progress.yaml`      | Add a `changelog: CHANGELOG.md` top-level key and a version bump with a note            |
| `docs/roadmap/tauri-migration-roadmap.md` | Add one line referencing CHANGELOG for historical entries                      |

## Non-Goals

- No auto-generation (e.g. `git-cliff`, `semantic-release`) — lossy for the
  pattern-pairing narrative.
- No CI lint enforcing CHANGELOG updates on every PR — start as convention,
  revisit if drift appears.
- No changelog-driven releases yet — project is pre-1.0.
- No migration of prior review-fix commits into dedicated CHANGELOG entries
  beyond what progress.yaml tracks — patterns file is already the record.

## Resolved Questions

1. **Expansion style.** Use indented nested bullets (`    - …`) rather
   than `<sub>` or a `<details>` block — plain markdown, grep-friendly,
   no HTML, consistent rendering everywhere.
2. **Bilingual cadence.** Ship both `CHANGELOG.md` and
   `CHANGELOG.zh-CN.md` from day one, mirroring the existing
   `README.md` / `README.zh-CN.md` pairing. Each merge updates both.

## Success Criteria

- `CHANGELOG.md` and `CHANGELOG.zh-CN.md` exist at repo root with every
  `done` phase from `progress.yaml` represented under `[Unreleased]`.
- The most recent entry (E2E #70) uses indented nested bullets for the
  session-scope / deferred-items expansion.
- At least one pattern cross-link exists per phase that touched a pattern.
- Every discovery touch-point references the CHANGELOG pair.
- Language-switch links at the top of each CHANGELOG point to the other.
- `CHANGELOG.example.md` (pilot) is removed.
