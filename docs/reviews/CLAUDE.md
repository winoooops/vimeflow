# Review Knowledge Base

Patterns learned from code reviews (local Codex and GitHub Codex). This is an
optional reference — agents may consult relevant patterns before implementing
to avoid repeating past mistakes.

**For agents:** When you read a pattern file during implementation, bump its
`ref_count` in frontmatter by 1 and update the Refs column below.

**After a review-fix cycle:** Record new findings by appending to an existing
pattern or creating a new file. See the spec at
`docs/superpowers/specs/2026-04-09-review-knowledge-base-design.md` for the
ingestion protocol.

| Pattern                                          | Category | Findings | Refs | Last Updated |
| ------------------------------------------------ | -------- | -------- | ---- | ------------ |
| [Filesystem Scope](patterns/filesystem-scope.md) | security | 3        | 0    | 2026-04-09   |
