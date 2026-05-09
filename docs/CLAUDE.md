# Docs — Project Documentation

## Subdirectories

### `design/`

Single source of truth for all frontend design. Contains the design system spec, screen mockups (screenshots + HTML), and component patterns. See `design/CLAUDE.md` for the full guide, or start from the root `DESIGN.md` for the overview.

Additional design material: https://aistudio.google.com/apps/71779b0a-a865-421d-9e16-8d224a1a26a8?showPreview=true&showAssistant=true

### `superpowers/specs/`

Architecture design documents and exploration notes. Contains dated spec files (e.g., `2026-03-29-cicd-infrastructure-design.md`) capturing design decisions made during planning phases.

Note: `.superpowers/` at the repo root is a separate working directory used by the superpowers plugin — it is not documentation.

### `reviews/`

Review knowledge base — patterns learned from local Codex and GitHub Codex code reviews. Each pattern file in `patterns/` collects related findings with their fixes and commit links. Agents may consult relevant patterns before implementing to avoid repeating past mistakes. See `reviews/CLAUDE.md` for the index.

### `decisions/`

Technical decision records — what we chose, what we rejected, and why. Each record is a dated, self-contained file (e.g. `2026-04-22-tooltip-library.md`). Read one when a topic touches a previously-decided trade-off so we don't re-litigate it. See `decisions/CLAUDE.md` for the index and format.

### `../CHANGELOG.md` and `../CHANGELOG.zh-CN.md` (at repo root)

Linear timeline of notable changes, bilingual. Paired with `reviews/` —
each entry may cross-link the review patterns it applied, updated, or
created. The two files mirror each other; update both on every merge.
