# CHANGELOG + Reviews Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bilingual `CHANGELOG.md` / `CHANGELOG.zh-CN.md` at the repo root, paired with `docs/reviews/`, and wire all discovery touch-points (READMEs, CLAUDE.md index, roadmap, progress.yaml) before backfilling entries from `progress.yaml` + git log.

**Architecture:** Keep a Changelog 1.1.0, single `[Unreleased]` block sub-grouped by roadmap phase, entries cross-link review patterns. Expansion notes use indented nested bullets (no HTML). English + Simplified Chinese files mirror each other; PR URLs, commit SHAs, and pattern paths are identical across languages.

**Tech Stack:** Markdown + YAML only. No code. Backfill sourced from `docs/roadmap/progress.yaml` + `git log --oneline` + `gh pr view`.

**Spec:** `docs/superpowers/specs/2026-04-19-changelog-pairing-design.md`

**Worktree:** `.claude/worktrees/docs-changelog-pairing` on branch `docs/changelog-pairing` — all file paths in this plan are relative to the worktree root.

---

## File Structure

Files created / modified / deleted:

| Path                                              | Role                                                     |
| ------------------------------------------------- | -------------------------------------------------------- |
| `CHANGELOG.md` (new)                              | English timeline, phase-grouped, pattern-linked          |
| `CHANGELOG.zh-CN.md` (new)                        | Simplified Chinese mirror                                |
| `CHANGELOG.example.md` (deleted)                  | Pilot from prior iteration — superseded                  |
| `CLAUDE.md`                                       | Add navigation row: `Linear change timeline → CHANGELOG.md` |
| `docs/CLAUDE.md`                                  | Short blurb that CHANGELOG lives at repo root + pairing  |
| `docs/reviews/CLAUDE.md`                          | Note that CHANGELOG is the timeline companion            |
| `docs/roadmap/progress.yaml`                      | Add `changelog:` key + version bump                      |
| `docs/roadmap/tauri-migration-roadmap.md`         | One-line reference to CHANGELOG                          |
| `README.md`                                       | "Changelog" section pointing to `CHANGELOG.md`           |
| `README.zh-CN.md`                                 | "更新日志" section pointing to `CHANGELOG.zh-CN.md`       |

Tasks 1–5 (doc wiring) can be done serially. Task 6 (README updates) dispatches **two parallel subagents**. Task 7 (EN backfill) and Task 8 (zh-CN mirror) are serial because translation needs the finished English prose. Tasks 9–10 (cleanup, commit) are serial.

---

## Task 1: Add CHANGELOG row to root `CLAUDE.md` nav table

**Files:**
- Modify: `CLAUDE.md` (the navigation table under "Structure: Index-Only by Design", second occurrence)

- [ ] **Step 1: Locate the Progress tracking row**

Run: `grep -n "Progress tracking" CLAUDE.md`
Expected: one line number pointing at the table row `| Progress tracking (roadmap status) | \`docs/roadmap/progress.yaml\` |`.

- [ ] **Step 2: Insert new row directly after "Progress tracking"**

Using Edit, replace the Progress tracking row with itself + a new row beneath:

```markdown
| Progress tracking (roadmap status)                       | `docs/roadmap/progress.yaml`                                                                                               |
| Linear change timeline (paired with reviews)             | `CHANGELOG.md` / `CHANGELOG.zh-CN.md`                                                                                      |
```

- [ ] **Step 3: Verify rendering**

Run: `grep -n "CHANGELOG" CLAUDE.md`
Expected: exactly one line in the navigation table mentioning both files.

---

## Task 2: Update `docs/CLAUDE.md`

**Files:**
- Modify: `docs/CLAUDE.md` (append a short subsection at EOF)

- [ ] **Step 1: Append the CHANGELOG subsection**

Append at EOF:

```markdown

### `../CHANGELOG.md` and `../CHANGELOG.zh-CN.md` (at repo root)

Linear timeline of notable changes, bilingual. Paired with `reviews/` —
each entry may cross-link the review patterns it applied, updated, or
created. The two files mirror each other; update both on every merge.
```

- [ ] **Step 2: Verify**

Run: `tail -8 docs/CLAUDE.md`
Expected: the new subsection is the final block.

---

## Task 3: Update `docs/reviews/CLAUDE.md`

**Files:**
- Modify: `docs/reviews/CLAUDE.md`

- [ ] **Step 1: Add a note after the intro paragraph**

Insert between the intro paragraph and the `**For agents:**` line (currently around line 5):

```markdown

**Timeline companion.** The repo-root `CHANGELOG.md` (and its zh-CN mirror
`CHANGELOG.zh-CN.md`) is the linear timeline; entries there may
cross-link patterns defined here. Record new patterns here; append the
matching CHANGELOG bullet on merge.
```

- [ ] **Step 2: Verify**

Run: `grep -n "Timeline companion" docs/reviews/CLAUDE.md`
Expected: one match, located between the intro and the `**For agents:**` line.

---

## Task 4: Update `docs/roadmap/progress.yaml`

**Files:**
- Modify: `docs/roadmap/progress.yaml:1-12` (header block)

- [ ] **Step 1: Bump version and add `changelog` key**

Change lines 6–11 from:

```yaml
# Revised: 2026-04-16 — Phase 3 marked done; new Phase 4 (Agent Status Sidebar) inserted; old Phases 4-9 renumbered to 5-10

version: 5
updated: '2026-04-16'
roadmap: docs/roadmap/tauri-migration-roadmap.md
notes: 'Phase 3 (Terminal Core) done — PTY ↔ xterm.js IPC wired via TauriTerminalService. Phase 4 (Agent Status Sidebar) in_progress — detection, statusline bridge, and transcript parser merged (PRs #49, #57, #60, #63). 1399 tests passing, ~91% coverage.'
```

To:

```yaml
# Revised: 2026-04-19 — Phase 4 E2E infra (#70) recorded; bilingual CHANGELOG added as timeline companion.

version: 6
updated: '2026-04-19'
roadmap: docs/roadmap/tauri-migration-roadmap.md
changelog:
  en: CHANGELOG.md
  zh-CN: CHANGELOG.zh-CN.md
notes: 'Phase 3 (Terminal Core) done. Phase 4 (Agent Status Sidebar) in_progress — detection, statusline bridge, transcript parser, and E2E infrastructure (WebdriverIO + tauri-driver, Linux) merged (PRs #49, #57, #60, #63, #70). Bilingual CHANGELOG.md / CHANGELOG.zh-CN.md added at repo root — linear timeline paired with docs/reviews/.'
```

- [ ] **Step 2: Validate YAML still parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('docs/roadmap/progress.yaml'))"`
Expected: no output, exit 0.

---

## Task 5: Update `docs/roadmap/tauri-migration-roadmap.md`

**Files:**
- Modify: `docs/roadmap/tauri-migration-roadmap.md:1-6` (header block)

- [ ] **Step 1: Add a CHANGELOG reference under the spec line**

After the line `> Design spec: docs/superpowers/specs/2026-04-06-cli-agent-workspace-design.md`, add:

```markdown
> Change log: CHANGELOG.md / CHANGELOG.zh-CN.md (linear timeline, paired with docs/reviews/)
```

- [ ] **Step 2: Verify**

Run: `head -8 docs/roadmap/tauri-migration-roadmap.md`
Expected: the new line appears in the header block.

---

## Task 6: Update both READMEs in parallel (subagent dispatch)

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

Dispatch two subagents (`general-purpose`) in a single message. Each edits one README; they don't touch the same file so there's no race.

- [ ] **Step 1: Dispatch English subagent**

Prompt to subagent:

> Edit `<WORKTREE>/README.md`. After the "What's Built" section's closing content and before the next top-level `##` heading, insert a new section:
>
> ```markdown
> ## Changelog
>
> See [`CHANGELOG.md`](./CHANGELOG.md) (English) or [`CHANGELOG.zh-CN.md`](./CHANGELOG.zh-CN.md) (简体中文) for the linear timeline of notable changes. Each entry may cross-link review patterns from [`docs/reviews/`](./docs/reviews/CLAUDE.md) that it applied, updated, or created — so the CHANGELOG is the *when* and `docs/reviews/` is the *why*.
> ```
>
> Report the line numbers where the section was inserted. Do not change any other content.

- [ ] **Step 2: Dispatch Chinese subagent (same message as Step 1)**

Prompt to subagent:

> Edit `<WORKTREE>/README.zh-CN.md`. After the "已实现功能" section's closing content and before the next top-level `##` heading, insert a new section:
>
> ```markdown
> ## 更新日志
>
> 参见 [`CHANGELOG.zh-CN.md`](./CHANGELOG.zh-CN.md)（中文）或 [`CHANGELOG.md`](./CHANGELOG.md)（English）— 记录所有重要变更的线性时间线。每条记录可交叉链接 [`docs/reviews/`](./docs/reviews/CLAUDE.md) 中该变更应用、更新或新增的复盘模式 — CHANGELOG 记录"何时"，`docs/reviews/` 记录"为何"。
> ```
>
> Report the line numbers where the section was inserted. Do not change any other content.

- [ ] **Step 3: Verify both insertions**

Run:
```bash
grep -n "^## Changelog\|^## 更新日志" README.md README.zh-CN.md
```
Expected: one match per file.

---

## Task 7: Create `CHANGELOG.md` with backfill (English)

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Gather raw source data**

Run:
```bash
git log --oneline -n 40
gh pr list --state merged --limit 20 --json number,title,url,mergedAt
gh repo view --json url
```

Cross-reference against `docs/roadmap/progress.yaml` so phase grouping matches `done` / `in_progress` status.

- [ ] **Step 2: Write `CHANGELOG.md`**

Exact content (adjust the `https://github.com/winoooops/vimeflow` prefix only if `gh repo view` reports a different owner):

````markdown
# Changelog

🇺🇸 English | [🇨🇳 简体中文](./CHANGELOG.zh-CN.md)

All notable changes to Vimeflow are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-1.0 so everything sits under `[Unreleased]` and is grouped by roadmap
phase (see `docs/roadmap/progress.yaml`).

**Pairing with reviews.** Each entry may cite patterns from
[`docs/reviews/patterns/`](docs/reviews/CLAUDE.md) that were applied,
updated, or created by the change — giving a linear timeline alongside
the thematic retrospective index.

**Updating.** On merge, append one bullet under the active phase in both
this file and `CHANGELOG.zh-CN.md`. Entry shape:
`- <change> ([#PR](url), <short-sha>) — patterns: [Name](docs/reviews/patterns/x.md)`.
Supplementary notes (scope, deferred items, spec paths) use indented
nested bullets (`    - …`). Security and Fixed entries should link a
pattern when one exists; bump its `ref_count` per `docs/reviews/CLAUDE.md`.

---

## [Unreleased]

### Phase 4 — Agent Status Sidebar (in progress)

#### Added

- WebdriverIO + tauri-driver E2E infrastructure with native Linux CI: 10 spec
  files (11 tests green locally on Fedora/Nobara) covering app launch, IPC
  round-trip, navigation, PTY spawn, terminal I/O, session lifecycle, multi-tab
  isolation, terminal resize, file→editor flow, and fake-claude agent
  detection. Frontend E2E bridge (`window.__VIMEFLOW_E2E__`) and Cargo
  `e2e-test` feature added.
  ([#70](https://github.com/winoooops/vimeflow/pull/70), `e97c1e8`) —
  patterns: [E2E Testing](docs/reviews/patterns/e2e-testing.md),
  [Cross-Platform Paths](docs/reviews/patterns/cross-platform-paths.md)
    - WSL2 scope (#65) deferred — "local env unsupported; use native Linux or CI".
    - Deferred follow-ups: REPL, structured logging (#61), transcript parsing
      in E2E, HMR orphan-PTY harness (#55), Phase 3 CI.
    - Spec: `docs/superpowers/specs/2026-04-14-e2e-testing-design.md`.
- UNIFIED design spec and canonical tokens (`docs/design/UNIFIED.md`,
  `tokens.css`, `tokens.ts`) — 5-zone layout contract, agent-state
  machine, component APIs.
  ([#68](https://github.com/winoooops/vimeflow/pull/68), `3d6bc9a`)
- Per-session statusline shell bridge + CWD storage in `PtyState` for
  watcher path derivation.
  ([#57](https://github.com/winoooops/vimeflow/pull/57),
  [#60](https://github.com/winoooops/vimeflow/pull/60),
  `de43dfc`, `e8d243c`) —
  patterns: [PTY Session Management](docs/reviews/patterns/pty-session-management.md)
- Transcript JSONL parser emitting `agent-tool-call` events.
  ([#63](https://github.com/winoooops/vimeflow/pull/63), `ca50df6`)
- `ts-rs` type codegen → `src/bindings/` for type-safe Rust ↔ TS boundary.
  ([#49](https://github.com/winoooops/vimeflow/pull/49), `53789f5`)

#### Changed

- README (English + zh-CN) refreshed with Phase 3/4 scope; progress
  tracker rebaselined.
  ([#67](https://github.com/winoooops/vimeflow/pull/67), `f590c18`) —
  patterns: [Documentation Accuracy](docs/reviews/patterns/documentation-accuracy.md)

#### Fixed

- `agent-status` `ContextBucket` test compared against hard-coded English
  instead of runtime locale.
  ([#69](https://github.com/winoooops/vimeflow/pull/69), `a656daf`) —
  patterns: [Testing Gaps](docs/reviews/patterns/testing-gaps.md)
- `tauri:dev` on Linux/Wayland failed to launch the WebKitGTK renderer
  under DMA-BUF; disabled DMA-BUF renderer in the dev script.
  ([#66](https://github.com/winoooops/vimeflow/pull/66), `07b5c6f`) —
  patterns: [Cross-Platform Paths](docs/reviews/patterns/cross-platform-paths.md)

### Phase 3 — Terminal Core

#### Added

- `portable-pty` + xterm.js terminal pane with Catppuccin Mocha theme,
  session caching, FitAddon, WebglAddon, and multi-tab support.
  ([#31](https://github.com/winoooops/vimeflow/pull/31), `ba395c7`) —
  patterns: [PTY Session Management](docs/reviews/patterns/pty-session-management.md),
  [Terminal Input Handling](docs/reviews/patterns/terminal-input-handling.md)
- `TauriTerminalService` IPC bridge: PTY stdout → Tauri events → xterm.js,
  xterm `onData` → `invoke(write_pty)` → PTY stdin. Resize wired via
  `ResizeObserver` + `FitAddon` + `resize_pty`. Cleanup kills session on
  unmount.
  ([#34](https://github.com/winoooops/vimeflow/pull/34), `2fc3fa2`,
  `1ecee29`) —
  patterns: [Resource Cleanup](docs/reviews/patterns/resource-cleanup.md),
  [Async Race Conditions](docs/reviews/patterns/async-race-conditions.md)

### Phase 2 — Workspace Layout Shell

#### Added

- 4-zone workspace grid: Icon Rail, Sidebar, Terminal Zone, Agent Activity
  panel. Context switcher tabs (Files / Editor / Diff) wired into the
  sidebar. All components use Obsidian Lens semantic tokens.
  (commits `f6a8b3f` … `74dbb74`, pre-PR era) —
  patterns: [React Lifecycle](docs/reviews/patterns/react-lifecycle.md),
  [Accessibility](docs/reviews/patterns/accessibility.md)

#### Removed

- Chat-first UI: `ChatView`, `features/chat/`, chat domain types, mock
  messages. Project pivoted from chat manager to CLI agent workspace.
  (commit `f6a8b3f`)

### Phase 1 — Tauri Scaffold + CI Green

#### Added

- Tauri v2 scaffold (`src-tauri/`), `tauri:dev` / `tauri:build` npm
  scripts, `src/lib/environment.ts` (`isTauri()` detection), CI pipeline
  across macOS/Windows/Linux with Rust caching.
  ([#27](https://github.com/winoooops/vimeflow/pull/27), `9ce4d61`)

---

## Legend

- **Added** — new capability, file, command, or dependency.
- **Changed** — behavioral/API update that is not a bug fix.
- **Fixed** — bug fix (link a review pattern if one informed it).
- **Removed** — deleted capability, file, or dependency.
- **Security** — security-relevant fix (pattern link **required**).
````

- [ ] **Step 3: Verify prettier passes**

Run: `npx prettier --check CHANGELOG.md`
Expected: PASS (or fix with `npx prettier --write CHANGELOG.md`).

---

## Task 8: Create `CHANGELOG.zh-CN.md` (Simplified Chinese mirror)

**Files:**
- Create: `CHANGELOG.zh-CN.md`

The zh-CN file mirrors Task 7's structure. PR URLs, commit SHAs, pattern file paths, and category headings (`#### Added` etc.) remain in English for stable anchors and shared grep-ability across languages. Only the prose is translated.

- [ ] **Step 1: Write `CHANGELOG.zh-CN.md`**

Exact content:

````markdown
# 更新日志

[🇺🇸 English](./CHANGELOG.md) | 🇨🇳 简体中文

Vimeflow 的所有重要变更记录在此。格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；项目尚处于 1.0
之前，因此所有条目都归入 `[Unreleased]`，并按路线图阶段分组
（参见 `docs/roadmap/progress.yaml`）。

**与 reviews 的配对。** 每条记录都可以引用
[`docs/reviews/patterns/`](docs/reviews/CLAUDE.md) 中在此次变更里被应用、
更新或新增的模式 — 从而让线性时间线与按主题归档的复盘索引相互印证。

**如何更新。** 合并后，在 `[Unreleased]` 对应阶段下为本文件和
`CHANGELOG.md` 各追加一条。条目结构：
`- <变更描述> ([#PR](url), <short-sha>) — patterns: [Name](docs/reviews/patterns/x.md)`。
附加说明（范围、遗留项、规格路径）使用缩进的嵌套列表（`    - …`）。
Security 和 Fixed 条目若存在对应模式应加以链接；按 `docs/reviews/CLAUDE.md`
约定递增 `ref_count`。

---

## [Unreleased]

### 第 4 阶段 — 代理状态侧边栏（进行中）

#### Added

- 基于 WebdriverIO + tauri-driver 的端到端测试基础设施，并在原生 Linux CI
  中运行：10 个 spec 文件（Fedora/Nobara 本地 11 个测试全部通过），
  覆盖应用启动、IPC 往返、导航、PTY 启动、终端读写、会话生命周期、多标签
  页隔离、终端尺寸变化、文件→编辑器流程，以及 fake-claude 代理检测。新增
  前端 E2E 桥（`window.__VIMEFLOW_E2E__`）和 Cargo `e2e-test` 特性。
  ([#70](https://github.com/winoooops/vimeflow/pull/70), `e97c1e8`) —
  patterns: [E2E Testing](docs/reviews/patterns/e2e-testing.md),
  [Cross-Platform Paths](docs/reviews/patterns/cross-platform-paths.md)
    - WSL2 范围（#65）延后 — "本地环境不支持；请使用原生 Linux 或 CI"。
    - 延后跟进项：REPL、结构化日志（#61）、E2E 中的 transcript 解析、
      HMR 孤儿 PTY 测试夹具（#55）、第 3 阶段 CI。
    - 规格：`docs/superpowers/specs/2026-04-14-e2e-testing-design.md`。
- UNIFIED 设计规格与规范 tokens（`docs/design/UNIFIED.md`、`tokens.css`、
  `tokens.ts`）— 5 区布局契约、代理状态机、组件 API。
  ([#68](https://github.com/winoooops/vimeflow/pull/68), `3d6bc9a`)
- 每会话 statusline shell 桥，以及在 `PtyState` 中存储 CWD 供监听器派生路径。
  ([#57](https://github.com/winoooops/vimeflow/pull/57),
  [#60](https://github.com/winoooops/vimeflow/pull/60),
  `de43dfc`, `e8d243c`) —
  patterns: [PTY Session Management](docs/reviews/patterns/pty-session-management.md)
- Transcript JSONL 解析器，对外发出 `agent-tool-call` 事件。
  ([#63](https://github.com/winoooops/vimeflow/pull/63), `ca50df6`)
- `ts-rs` 类型代码生成 → `src/bindings/`，实现类型安全的 Rust ↔ TS 边界。
  ([#49](https://github.com/winoooops/vimeflow/pull/49), `53789f5`)

#### Changed

- 刷新 README（英文 + 中文），对齐第 3/4 阶段范围；重设进度跟踪器基线。
  ([#67](https://github.com/winoooops/vimeflow/pull/67), `f590c18`) —
  patterns: [Documentation Accuracy](docs/reviews/patterns/documentation-accuracy.md)

#### Fixed

- `agent-status` 的 `ContextBucket` 测试对照的是硬编码英文字串，而非运行
  时 locale。
  ([#69](https://github.com/winoooops/vimeflow/pull/69), `a656daf`) —
  patterns: [Testing Gaps](docs/reviews/patterns/testing-gaps.md)
- Linux/Wayland 下 `tauri:dev` 无法在 DMA-BUF 渲染器中启动 WebKitGTK；
  在开发脚本中关闭 DMA-BUF 渲染器。
  ([#66](https://github.com/winoooops/vimeflow/pull/66), `07b5c6f`) —
  patterns: [Cross-Platform Paths](docs/reviews/patterns/cross-platform-paths.md)

### 第 3 阶段 — 终端核心

#### Added

- 基于 `portable-pty` + xterm.js 的终端面板，采用 Catppuccin Mocha 主题，
  按标签页缓存会话，集成 FitAddon、WebglAddon，支持多标签终端。
  ([#31](https://github.com/winoooops/vimeflow/pull/31), `ba395c7`) —
  patterns: [PTY Session Management](docs/reviews/patterns/pty-session-management.md),
  [Terminal Input Handling](docs/reviews/patterns/terminal-input-handling.md)
- `TauriTerminalService` IPC 桥：PTY stdout → Tauri 事件 → xterm.js，
  xterm `onData` → `invoke(write_pty)` → PTY stdin。通过
  `ResizeObserver` + `FitAddon` + `resize_pty` 实现尺寸同步；卸载时清理
  并终止会话。
  ([#34](https://github.com/winoooops/vimeflow/pull/34), `2fc3fa2`,
  `1ecee29`) —
  patterns: [Resource Cleanup](docs/reviews/patterns/resource-cleanup.md),
  [Async Race Conditions](docs/reviews/patterns/async-race-conditions.md)

### 第 2 阶段 — 工作区布局外壳

#### Added

- 4 区工作区网格：图标栏、侧边栏、终端区、代理活动面板。上下文切换标签
  （文件 / 编辑器 / Diff）接入侧边栏。所有组件采用 Obsidian Lens 语义
  tokens。
  （提交 `f6a8b3f` … `74dbb74`，早于 PR 流程） —
  patterns: [React Lifecycle](docs/reviews/patterns/react-lifecycle.md),
  [Accessibility](docs/reviews/patterns/accessibility.md)

#### Removed

- 基于聊天的 UI：`ChatView`、`features/chat/`、聊天领域类型、mock 消息。
  项目从聊天管理器转型为 CLI 代理工作区。
  （提交 `f6a8b3f`）

### 第 1 阶段 — Tauri 脚手架 + CI 通过

#### Added

- Tauri v2 脚手架（`src-tauri/`）、`tauri:dev` / `tauri:build` npm 脚本、
  `src/lib/environment.ts`（`isTauri()` 检测）、跨 macOS/Windows/Linux
  的 CI 流水线及 Rust 缓存。
  ([#27](https://github.com/winoooops/vimeflow/pull/27), `9ce4d61`)

---

## 图例

- **Added** — 新增能力、文件、命令或依赖。
- **Changed** — 行为/API 更新，非 bug 修复。
- **Fixed** — bug 修复（若有相应复盘模式，请加链接）。
- **Removed** — 删除的能力、文件或依赖。
- **Security** — 安全相关修复（**必须**链接模式）。
````

- [ ] **Step 2: Verify prettier passes**

Run: `npx prettier --check CHANGELOG.zh-CN.md`
Expected: PASS (or fix with `npx prettier --write CHANGELOG.zh-CN.md`).

- [ ] **Step 3: Spot-check structural parity with English**

Run:
```bash
grep -cE "^#### (Added|Changed|Fixed|Removed|Security)" CHANGELOG.md
grep -cE "^#### (Added|Changed|Fixed|Removed|Security)" CHANGELOG.zh-CN.md
```
Expected: identical counts.

Run:
```bash
grep -oE "#[0-9]+" CHANGELOG.md | sort -u
grep -oE "#[0-9]+" CHANGELOG.zh-CN.md | sort -u
```
Expected: identical PR-number sets.

---

## Task 9: Remove `CHANGELOG.example.md`

**Files:**
- Delete: `CHANGELOG.example.md`

- [ ] **Step 1: Confirm the pilot is superseded**

Run: `diff <(head -30 CHANGELOG.md) <(head -30 CHANGELOG.example.md) | head -40`
Expected: structural overlap (same format). The pilot is obsolete.

- [ ] **Step 2: Delete the pilot**

Run: `rm CHANGELOG.example.md`

- [ ] **Step 3: Confirm repo has exactly two CHANGELOG files**

Run: `ls CHANGELOG*`
Expected: `CHANGELOG.md` and `CHANGELOG.zh-CN.md` only.

---

## Task 10: Link check, lint, pattern ref_count, commit

- [ ] **Step 1: Confirm every referenced path exists**

Run:
```bash
for p in docs/reviews/patterns/e2e-testing.md \
         docs/reviews/patterns/cross-platform-paths.md \
         docs/reviews/patterns/pty-session-management.md \
         docs/reviews/patterns/terminal-input-handling.md \
         docs/reviews/patterns/resource-cleanup.md \
         docs/reviews/patterns/async-race-conditions.md \
         docs/reviews/patterns/react-lifecycle.md \
         docs/reviews/patterns/accessibility.md \
         docs/reviews/patterns/documentation-accuracy.md \
         docs/reviews/patterns/testing-gaps.md \
         docs/reviews/CLAUDE.md \
         docs/superpowers/specs/2026-04-14-e2e-testing-design.md; do
  test -f "$p" || echo "MISSING: $p"
done
```
Expected: no output.

- [ ] **Step 2: Run repo formatter on touched files**

Run:
```bash
npx prettier --write CHANGELOG.md CHANGELOG.zh-CN.md \
  README.md README.zh-CN.md CLAUDE.md \
  docs/CLAUDE.md docs/reviews/CLAUDE.md \
  docs/roadmap/tauri-migration-roadmap.md
```
Expected: each file printed once.

- [ ] **Step 3: Bump `ref_count` for cited patterns**

For each pattern cited in CHANGELOG.md, open the pattern file under
`docs/reviews/patterns/` and increment `ref_count` in its YAML frontmatter
by **1** (not 2 — the zh-CN mirror is the same reference). Update the
"Refs" column in `docs/reviews/CLAUDE.md` to match.

Patterns to bump: `e2e-testing`, `cross-platform-paths`,
`pty-session-management`, `terminal-input-handling`, `resource-cleanup`,
`async-race-conditions`, `react-lifecycle`, `accessibility`,
`documentation-accuracy`, `testing-gaps`.

- [ ] **Step 4: Stage and commit**

Run:
```bash
git status
git add CHANGELOG.md CHANGELOG.zh-CN.md \
        CLAUDE.md docs/CLAUDE.md docs/reviews/CLAUDE.md \
        docs/reviews/patterns/ \
        docs/roadmap/progress.yaml docs/roadmap/tauri-migration-roadmap.md \
        README.md README.zh-CN.md \
        docs/superpowers/specs/2026-04-19-changelog-pairing-design.md \
        docs/superpowers/plans/2026-04-19-changelog-pairing.md
git rm CHANGELOG.example.md
git commit -m "docs(changelog): add bilingual CHANGELOG paired with docs/reviews

Introduces a linear change timeline at the repo root in English and
Simplified Chinese (CHANGELOG.md / CHANGELOG.zh-CN.md), following Keep a
Changelog, grouped by roadmap phase. Cross-links review patterns
(docs/reviews/patterns/*.md) so timeline and retrospective archive read
together.

Wires discovery through READMEs (en + zh-CN), CLAUDE.md nav,
docs/CLAUDE.md, docs/reviews/CLAUDE.md, and the roadmap. Backfills
entries for Phases 1-4 from docs/roadmap/progress.yaml + git log. Bumps
ref_count for patterns cited in the backfill.

Spec:  docs/superpowers/specs/2026-04-19-changelog-pairing-design.md
Plan:  docs/superpowers/plans/2026-04-19-changelog-pairing.md"
```

- [ ] **Step 5: Confirm pre-commit hooks pass**

Expected: `lint-staged` + `commitlint` both green. `pre-push` will run
vitest on push; no code changed so every test should still pass.

---

## Self-Review Checklist (run before handoff)

- [ ] Every spec decision has a task: location, format, entry shape,
  expansion style (indented bullets), bilingual pair, backfill source,
  pattern-linking rules, discovery touch-points.
- [ ] No `TODO` / `TBD` / placeholder text in any step.
- [ ] Every file path in the plan is relative-from-worktree-root and
  exists (or is explicitly being created/deleted).
- [ ] PR numbers (#27, #31, #34, #49, #57, #60, #63, #66, #67, #68, #69,
  #70) all reconciled against `progress.yaml` and/or `git log`.
- [ ] Patterns cross-linked in CHANGELOG.md / CHANGELOG.zh-CN.md exist
  under `docs/reviews/patterns/` (confirmed in Task 10 Step 1).
- [ ] English and Chinese files have matching section counts and identical
  PR-number sets (Task 8 Step 3).
- [ ] `CHANGELOG.example.md` is deleted by Task 9.
