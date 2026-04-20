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
  ([#31](https://github.com/winoooops/vimeflow/pull/31), `ba395c7`) —
  patterns: [React Lifecycle](docs/reviews/patterns/react-lifecycle.md),
  [Accessibility](docs/reviews/patterns/accessibility.md)

#### Removed

- 基于聊天的 UI：`ChatView`、`features/chat/`、聊天领域类型、mock 消息。
  项目从聊天管理器转型为 CLI 代理工作区。
  ([#31](https://github.com/winoooops/vimeflow/pull/31), `ba395c7`)

### 第 1 阶段 — Tauri 脚手架 + CI 通过

#### Added

- Tauri v2 脚手架（`src-tauri/`）、`tauri:dev` / `tauri:build` npm 脚本、
  `src/lib/environment.ts`（`isTauri()` 检测）、跨 macOS/Windows/Linux
  的 CI 流水线及 Rust 缓存。
  ([#27](https://github.com/winoooops/vimeflow/pull/27), `9ce4d61`) —
  patterns: [CSP Configuration](docs/reviews/patterns/csp-configuration.md)

---

## 图例

- **Added** — 新增能力、文件、命令或依赖。
- **Changed** — 行为/API 更新，非 bug 修复。
- **Fixed** — bug 修复（若有相应复盘模式，请加链接）。
- **Removed** — 删除的能力、文件或依赖。
- **Security** — 安全相关修复（**必须**链接模式）。
