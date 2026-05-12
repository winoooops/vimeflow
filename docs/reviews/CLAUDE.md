# Review Knowledge Base

Patterns learned from code reviews (local Codex, GitHub Claude, and GitHub
Codex connector). This is an optional reference — agents may consult relevant patterns before implementing
to avoid repeating past mistakes.

**Timeline companion.** The repo-root `CHANGELOG.md` (and its zh-CN mirror
`CHANGELOG.zh-CN.md`) is the linear timeline; entries there may
cross-link patterns defined here. Record new patterns here; append the
matching CHANGELOG bullet on merge.

**For agents:** When you read a pattern file during implementation, bump its
`ref_count` in frontmatter by 1 and update the Refs column below.

**After a review-fix cycle:** Record new findings by appending to an existing
pattern or creating a new file. See the spec at
`docs/superpowers/specs/2026-04-09-review-knowledge-base-design.md` for the
ingestion protocol.

## Source labels

When appending findings to a pattern file, label the source so future readers can trace which reviewer caught it:

- `github-codex` — the old aggregated Codex GitHub Action (`.github/workflows/codex-review.yml`,
  disabled as of [#111](https://github.com/winoooops/vimeflow/issues/111)). Existing entries with
  this label remain as historical record; do **NOT** rewrite or relabel them.
- `github-codex-connector` — the `chatgpt-codex-connector[bot]` GitHub App integration. Posts
  inline review comments on PR diffs. New entries from `/lifeline:upsource-review` cycles use
  this label.
- `github-claude` — the Claude Code Review GitHub Action (`.github/workflows/claude-review.yml`).
  Posts an aggregated `## Claude Code Review` issue comment per push.
- `github-human` — a human reviewer (PR author, maintainer, contributor) commenting on a PR.
  Posted via `/issues/{pr}/comments` (top-level conversation) or `/pulls/{pr}/comments` (inline).
  New entries from `/lifeline:upsource-review` human-review processing use this label.
- `local-codex` — local `codex exec` runs (e.g. `/lifeline:review` or post-fix verify in
  `/lifeline:upsource-review`).

| Pattern                                                              | Category       | Findings | Refs | Last Updated |
| -------------------------------------------------------------------- | -------------- | -------- | ---- | ------------ |
| [Filesystem Scope](patterns/filesystem-scope.md)                     | security       | 21       | 3    | 2026-05-03   |
| [React Lifecycle](patterns/react-lifecycle.md)                       | react-patterns | 18       | 5    | 2026-05-12   |
| [Resource Cleanup](patterns/resource-cleanup.md)                     | react-patterns | 2        | 3    | 2026-04-14   |
| [Cross-Platform Paths](patterns/cross-platform-paths.md)             | cross-platform | 4        | 3    | 2026-05-07   |
| [Debug Artifacts](patterns/debug-artifacts.md)                       | code-quality   | 5        | 0    | 2026-05-09   |
| [Generated Artifacts](patterns/generated-artifacts.md)               | code-quality   | 2        | 0    | 2026-05-04   |
| [Testing Gaps](patterns/testing-gaps.md)                             | testing        | 47       | 21   | 2026-05-12   |
| [Terminal Input Handling](patterns/terminal-input-handling.md)       | terminal       | 3        | 1    | 2026-04-09   |
| [Documentation Accuracy](patterns/documentation-accuracy.md)         | code-quality   | 55       | 19   | 2026-05-09   |
| [Accessibility](patterns/accessibility.md)                           | a11y           | 25       | 6    | 2026-05-09   |
| [Async Race Conditions](patterns/async-race-conditions.md)           | react-patterns | 35       | 9    | 2026-05-07   |
| [Tokio Blocking On Async](patterns/tokio-blocking-on-async.md)       | backend        | 1        | 0    | 2026-05-04   |
| [Command Injection](patterns/command-injection.md)                   | security       | 7        | 3    | 2026-05-02   |
| [Policy Judge Hygiene](patterns/policy-judge-hygiene.md)             | security       | 15       | 2    | 2026-04-20   |
| [Fail-Closed Hooks](patterns/fail-closed-hooks.md)                   | security       | 3        | 1    | 2026-04-20   |
| [Preflight Checks](patterns/preflight-checks.md)                     | error-handling | 1        | 0    | 2026-04-20   |
| [CSP Configuration](patterns/csp-configuration.md)                   | security       | 2        | 1    | 2026-04-09   |
| [PTY Session Management](patterns/pty-session-management.md)         | backend        | 6        | 2    | 2026-05-02   |
| [Git Operations](patterns/git-operations.md)                         | correctness    | 15       | 5    | 2026-05-02   |
| [CodeMirror Integration](patterns/codemirror-integration.md)         | editor         | 12       | 0    | 2026-04-11   |
| [Error Surfacing](patterns/error-surfacing.md)                       | error-handling | 25       | 5    | 2026-05-09   |
| [File Tree Paths](patterns/file-tree-paths.md)                       | files          | 4        | 0    | 2026-04-10   |
| [Scope Boundary](patterns/scope-boundary.md)                         | review-process | 5        | 0    | 2026-04-12   |
| [E2E Testing](patterns/e2e-testing.md)                               | e2e-testing    | 11       | 3    | 2026-05-12   |
| [Module Boundaries](patterns/module-boundaries.md)                   | code-quality   | 3        | 1    | 2026-05-07   |
| [Diagnostic Instrumentation](patterns/diagnostic-instrumentation.md) | code-quality   | 7        | 2    | 2026-05-02   |
