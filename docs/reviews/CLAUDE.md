# Review Knowledge Base

Patterns learned from code reviews (local Codex, GitHub Claude, and GitHub
Codex connector). This is an optional reference — agents may consult relevant patterns before implementing
to avoid repeating past mistakes.

**Timeline companion.** The repo-root `CHANGELOG.md` (and its zh-CN mirror
`CHANGELOG.zh-CN.md`) is the linear timeline; entries there may
cross-link patterns defined here. Record new patterns here; append the
matching CHANGELOG bullet on merge.

**Runtime migration note.** Many older findings intentionally preserve original
Tauri-era paths and wording (`src-tauri/`, `tauri-driver`, Tauri events). The
current implementation is Electron + the `crates/backend/` Rust sidecar. Apply
the reusable lesson, but translate active-code guidance to
`window.vimeflow`, `BackendState`, `EventSink`, and LSP-framed sidecar IPC.

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

| Pattern                                                                                              | Category           | Findings | Refs | Last Updated |
| ---------------------------------------------------------------------------------------------------- | ------------------ | -------- | ---- | ------------ |
| [Filesystem Scope](patterns/filesystem-scope.md)                                                     | security           | 28       | 7    | 2026-06-22   |
| [Native Surface Occlusion](patterns/native-surface-occlusion.md)                                     | correctness        | 3        | 0    | 2026-06-15   |
| [React Lifecycle](patterns/react-lifecycle.md)                                                       | react-patterns     | 60       | 62   | 2026-06-28   |
| [Imperative Animation Ownership](patterns/imperative-animation-ownership.md)                         | react-patterns     | 7        | 3    | 2026-06-17   |
| [Motion Layout Projection](patterns/motion-layout-projection.md)                                     | react-patterns     | 1        | 0    | 2026-06-10   |
| [Fixed-Position Portals](patterns/fixed-position-portals.md)                                         | react-patterns     | 2        | 1    | 2026-06-22   |
| [Resource Cleanup](patterns/resource-cleanup.md)                                                     | react-patterns     | 24       | 20   | 2026-06-28   |
| [Cross-Platform Paths](patterns/cross-platform-paths.md)                                             | cross-platform     | 13       | 12   | 2026-06-28   |
| [Debug Artifacts](patterns/debug-artifacts.md)                                                       | code-quality       | 7        | 0    | 2026-06-11   |
| [Derived State Consistency](patterns/derived-state-consistency.md)                                   | code-quality       | 15       | 12   | 2026-06-26   |
| [Generated Artifacts](patterns/generated-artifacts.md)                                               | code-quality       | 9        | 6    | 2026-06-12   |
| [Generated Shell Scripts](patterns/generated-shell-scripts.md)                                       | backend            | 8        | 2    | 2026-06-19   |
| [Hot-Path Caching](patterns/hot-path-caching.md)                                                     | backend            | 8        | 2    | 2026-06-28   |
| [Testing Gaps](patterns/testing-gaps.md)                                                             | testing            | 84       | 38   | 2026-06-25   |
| [Terminal Input Handling](patterns/terminal-input-handling.md)                                       | terminal           | 9        | 4    | 2026-06-28   |
| [Documentation Accuracy](patterns/documentation-accuracy.md)                                         | code-quality       | 94       | 91   | 2026-06-28   |
| [Accessibility](patterns/accessibility.md)                                                           | a11y               | 81       | 32   | 2026-06-22   |
| [Event Identity Guard](patterns/event-identity-guard.md)                                             | backend            | 1        | 0    | 2026-06-11   |
| [Async Race Conditions](patterns/async-race-conditions.md)                                           | react-patterns     | 75       | 72   | 2026-06-28   |
| [Canonical Path Dedupe](patterns/canonical-path-dedupe.md)                                           | correctness        | 2        | 0    | 2026-06-14   |
| [Tokio Blocking On Async](patterns/tokio-blocking-on-async.md)                                       | backend            | 4        | 2    | 2026-06-14   |
| [Command Injection](patterns/command-injection.md)                                                   | security           | 8        | 3    | 2026-06-16   |
| [Policy Judge Hygiene](patterns/policy-judge-hygiene.md)                                             | security           | 15       | 2    | 2026-04-20   |
| [Fail-Closed Hooks](patterns/fail-closed-hooks.md)                                                   | security           | 4        | 1    | 2026-06-17   |
| [Bridge Payload Minimization](patterns/bridge-payload-minimization.md)                               | security           | 4        | 2    | 2026-06-21   |
| [Preflight Checks](patterns/preflight-checks.md)                                                     | error-handling     | 3        | 0    | 2026-05-31   |
| [CSP Configuration](patterns/csp-configuration.md)                                                   | security           | 8        | 5    | 2026-05-16   |
| [Network Request Hardening](patterns/network-request-hardening.md)                                   | security           | 1        | 1    | 2026-06-08   |
| [PTY Session Management](patterns/pty-session-management.md)                                         | backend            | 10       | 4    | 2026-06-28   |
| [Git Operations](patterns/git-operations.md)                                                         | correctness        | 26       | 11   | 2026-06-13   |
| [CodeMirror Integration](patterns/codemirror-integration.md)                                         | editor             | 20       | 5    | 2026-06-17   |
| [Editor File Existence Probe](patterns/editor-file-existence-probe.md)                               | files              | 3        | 0    | 2026-06-18   |
| [Error Surfacing](patterns/error-surfacing.md)                                                       | error-handling     | 47       | 46   | 2026-06-28   |
| [File Tree Paths](patterns/file-tree-paths.md)                                                       | files              | 4        | 0    | 2026-04-10   |
| [Scope Boundary](patterns/scope-boundary.md)                                                         | review-process     | 8        | 3    | 2026-06-01   |
| [E2E Testing](patterns/e2e-testing.md)                                                               | e2e-testing        | 24       | 10   | 2026-06-19   |
| [Module Boundaries](patterns/module-boundaries.md)                                                   | code-quality       | 18       | 6    | 2026-06-28   |
| [Diagnostic Instrumentation](patterns/diagnostic-instrumentation.md)                                 | code-quality       | 13       | 3    | 2026-06-15   |
| [Keyboard Shortcut Guards](patterns/keyboard-shortcut-guards.md)                                     | keyboard-shortcuts | 24       | 3    | 2026-06-26   |
| [Verify Render Target](patterns/verify-render-target.md)                                             | code-quality       | 2        | 0    | 2026-05-24   |
| [UI Visual Regression](patterns/ui-visual-regression.md)                                             | code-quality       | 17       | 10   | 2026-06-28   |
| [Status Indicator Display](patterns/status-indicator-display.md)                                     | code-quality       | 3        | 0    | 2026-05-26   |
| [Parser Resilience](patterns/parser-resilience.md)                                                   | code-quality       | 15       | 8    | 2026-06-28   |
| [Persisted State Invariants](patterns/persisted-state-invariants.md)                                 | correctness        | 14       | 7    | 2026-06-23   |
| [macOS Window Chrome](patterns/macos-window-chrome.md)                                               | cross-platform     | 9        | 2    | 2026-06-15   |
| [Guard Branch Correctness](patterns/guard-branch-correctness.md)                                     | correctness        | 2        | 0    | 2026-06-19   |
| [Identifier Prefix Matching](patterns/identifier-prefix-matching.md)                                 | correctness        | 4        | 2    | 2026-06-17   |
| [Prototype Handoff Artifacts](patterns/prototype-handoff-artifacts.md)                               | review-process     | 2        | 1    | 2026-06-12   |
| [CloudFormation Environment Prefix Coupling](patterns/cloudformation-environment-prefix-coupling.md) | infrastructure     | 1        | 0    | 2026-06-12   |
| [CloudFormation Stale References](patterns/cloudformation-stale-references.md)                       | infrastructure     | 2        | 1    | 2026-06-12   |
| [Dead Code](patterns/dead-code.md)                                                                   | code-quality       | 7        | 7    | 2026-06-22   |
| [Unsafe Block Safety Comments](patterns/unsafe-block-safety-comments.md)                             | security           | 1        | 0    | 2026-06-14   |
| [Type Contract Safety](patterns/type-contract-safety.md)                                             | code-quality       | 12       | 6    | 2026-06-28   |
| [String Construction Hygiene](patterns/string-construction-hygiene.md)                               | code-quality       | 2        | 1    | 2026-06-19   |
| [Agent-State Guards](patterns/agent-state-guards.md)                                                 | correctness        | 13       | 8    | 2026-06-28   |
| [React Prop Contracts](patterns/react-prop-contracts.md)                                             | react-patterns     | 8        | 6    | 2026-06-22   |
| [Stale Retained Interactions](patterns/stale-retained-interactions.md)                               | react-patterns     | 2        | 1    | 2026-06-15   |
| [Retained State Identity](patterns/retained-state-identity.md)                                       | react-patterns     | 1        | 1    | 2026-06-15   |
| [Authoritative Completion Guard](patterns/authoritative-completion-guard.md)                         | correctness        | 6        | 2    | 2026-06-27   |
| [Equality Guard Completeness](patterns/equality-guard-completeness.md)                               | correctness        | 2        | 0    | 2026-06-17   |
| [Resizable Layout Bounds](patterns/resizable-layout-bounds.md)                                       | correctness        | 3        | 1    | 2026-06-18   |
| [Schema Version Decoupling](patterns/schema-version-decoupling.md)                                   | correctness        | 1        | 0    | 2026-06-19   |
| [Shared Controller Segmentation](patterns/shared-controller-segmentation.md)                         | react-patterns     | 2        | 0    | 2026-06-18   |
| [Vite HMR Static Dependencies](patterns/vite-hmr-static-deps.md)                                     | code-quality       | 3        | 2    | 2026-06-18   |
| [Custom Pane Layout Preservation](patterns/custom-pane-layout-preservation.md)                       | correctness        | 13       | 5    | 2026-06-22   |
| [Pane Slot Identity](patterns/pane-slot-identity.md)                                                 | correctness        | 3        | 1    | 2026-06-22   |
| [Transient UI Side Effects](patterns/transient-ui-side-effects.md)                                   | react-patterns     | 8        | 3    | 2026-06-26   |
| [Async Global State Mutation](patterns/async-global-state-mutation.md)                               | backend            | 1        | 0    | 2026-06-19   |
| [Boolean Sentinel Consistency](patterns/boolean-sentinel-consistency.md)                             | code-quality       | 4        | 1    | 2026-06-28   |
