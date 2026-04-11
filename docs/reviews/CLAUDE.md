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

| Pattern                                                        | Category       | Findings | Refs | Last Updated |
| -------------------------------------------------------------- | -------------- | -------- | ---- | ------------ |
| [Filesystem Scope](patterns/filesystem-scope.md)               | security       | 14       | 0    | 2026-04-10   |
| [React Lifecycle](patterns/react-lifecycle.md)                 | react-patterns | 6        | 0    | 2026-04-10   |
| [Resource Cleanup](patterns/resource-cleanup.md)               | react-patterns | 1        | 0    | 2026-04-09   |
| [Cross-Platform Paths](patterns/cross-platform-paths.md)       | cross-platform | 2        | 0    | 2026-04-10   |
| [Debug Artifacts](patterns/debug-artifacts.md)                 | code-quality   | 3        | 0    | 2026-04-09   |
| [Testing Gaps](patterns/testing-gaps.md)                       | testing        | 8        | 0    | 2026-04-11   |
| [Terminal Input Handling](patterns/terminal-input-handling.md) | terminal       | 3        | 0    | 2026-04-09   |
| [Documentation Accuracy](patterns/documentation-accuracy.md)   | code-quality   | 9        | 0    | 2026-04-11   |
| [Accessibility](patterns/accessibility.md)                     | a11y           | 11       | 0    | 2026-04-10   |
| [Async Race Conditions](patterns/async-race-conditions.md)     | react-patterns | 9        | 0    | 2026-04-10   |
| [Command Injection](patterns/command-injection.md)             | security       | 4        | 0    | 2026-04-09   |
| [CSP Configuration](patterns/csp-configuration.md)             | security       | 2        | 0    | 2026-04-09   |
| [PTY Session Management](patterns/pty-session-management.md)   | backend        | 5        | 0    | 2026-04-09   |
| [Git Operations](patterns/git-operations.md)                   | correctness    | 5        | 0    | 2026-04-09   |
| [CodeMirror Integration](patterns/codemirror-integration.md)   | editor         | 12       | 0    | 2026-04-11   |
| [Error Surfacing](patterns/error-surfacing.md)                 | error-handling | 7        | 0    | 2026-04-10   |
| [File Tree Paths](patterns/file-tree-paths.md)                 | files          | 4        | 0    | 2026-04-10   |
