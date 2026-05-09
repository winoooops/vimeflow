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

### UI Handoff 迁移

#### Added

- Handoff 设计 tokens 与 `src/agents/registry.ts` 作为第一步增量 UI 迁移
  落地。
  ([#171](https://github.com/winoooops/vimeflow/pull/171), `38af7ab`)
- Handoff 应用外壳比例、状态栏、会话标签条已落地，同时保留现有 Tauri
  终端集成。
  ([#173](https://github.com/winoooops/vimeflow/pull/173), `266b3a0`)
- 侧边栏会话行与浏览器风格会话标签已完成视觉迁移，并接入
  `useSessionManager`；路线图现在将第 4 步 Single TerminalPane 标记为下一
  个 handoff 步骤。
  ([#174](https://github.com/winoooops/vimeflow/pull/174), `ab1b888`) —
  patterns: [Documentation Accuracy](docs/reviews/patterns/documentation-accuracy.md)

### 第 4 阶段 — 代理状态侧边栏

#### Added

- Codex 适配器 Stage 2 —— `CodexAdapter` 接入现有 `AgentAdapter` trait，使运行 `codex` 的 PTY 与 Claude 会话共用同一状态面板：模型、上下文窗口（以 `last_token_usage` 为来源，而非累计 token）、5 小时 / 7 天速率限额、累计耗时。SQLite 优先的会话定位器（基于 schema 探测 `logs` / `threads` 表，使用命名占位符 + `(ts, ts_nanos) >= pty_start` 的元组比较），并辅以 FS 扫描回退。新增 `rusqlite`（bundled）依赖。`cost.total_cost_usd` 改为 `Option<f64>`（Rust 端 → 线上 `null` → 前端 override 为 `number | null` → `BudgetMetrics` 的 `ApiKeyVariant` 在 null 时渲染 `'—'`）。新增 `ManagedSession.started_at` 与 `PtyState::get_started_at`，使定位器能按 PTY 启动时间过滤查询。`agent/adapter/types.rs` 新增 `BindContext { session_id, cwd, pid, pty_start }` 与 `BindError { Pending, Fatal }`；`AgentAdapter::status_source` 变为可失败；`base::start_for` 对 `Pending` 进行有界重试（5 × 100ms = 500ms，低于 `DETECTION_POLL_MS=2000`）。设计文档：[`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`](docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md)；实施计划：[`docs/superpowers/plans/2026-05-04-codex-adapter-stage-2.md`](docs/superpowers/plans/2026-05-04-codex-adapter-stage-2.md)。
  - **作用域扩展记录在 [`docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`](docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md) 中：** 设计文档原本锁定的三条规则（v1 不实现 codex transcript tailer；`/proc` 仅作 verifier；`BindContext.pid` = shell PID）在实施中全部被放宽。Transcript tailer 在 v1 已落地，复用 `claude_code/test_runners/*` 发出 `AgentToolCallEvent` / `AgentTurnEvent` / 测试运行信号；当 SQLite logs 查询返回零行时，`/proc/<pid>/fd/*` 与 `/proc/<pid>/cmdline` 提供 Linux 快速路径（所有 fd 候选都会与 `threads.rollout_path` 交叉校验，避免多 fd 误绑定）；`BindContext.pid` 现在是 `detect_agent` 检测出的代理 PID，而非 shell PID，因为 Codex 的 `logs.process_uuid` 索引的是 codex 子进程 PID。
  - `src-tauri/tests/fixtures/codex/` 下的 6 个 rollout JSONL 夹具固定了 spec 中锁定的解析规则（last_token_usage 来源、info-null 部分更新、不完整末行静默丢弃、中间畸形行 warn）。
- README 首屏 GIF（`docs/media/hero-init.gif`）以及 `docs/media/` 中的 4
  张静态截图：工作空间总览、代理状态侧边栏特写、Git Diff 查看器、Vim 模式
  编辑器。首屏录屏（启动 `claude` → 运行 `/init` → 工具调用实时流入）同
  时作为 `p4-d6`（真实 Claude Code 会话，端到端）的人工验证证据。抓取流
  程（Kooha WebM → ffmpeg 1.5×/15 fps/1280px 宽/80 色调色板）记录于
  `docs/media/CLAUDE.md`。
  - 中文 README（`README.zh-CN.md`）同步更新。
  - 路线图（`docs/roadmap/progress.yaml`）升级到 v7：第 4 阶段状态 →
    `done`，并在顶部 `notes` 中列出第 4 阶段期间跨阶段交付的项目
    （#80、#83、#86、#107、#109、#115、#120）。
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

- 采用专用的 Lifeline Claude Code 插件工作流来承载自主代理循环与 review
  流程，并移除仓库内 harness、本地 `harness-plugin` marketplace 与旧 review
  辅助脚本。根文档现在在 `README.md`、`README.zh-CN.md` 与 `CLAUDE.md`
  保留项目本地 Lifeline 安装说明；不再在 `docs/` 下随仓库提供单独 Lifeline 文档。
  ([#188](https://github.com/winoooops/vimeflow/pull/188), `68a5501`) —
  patterns: [Documentation Accuracy](docs/reviews/patterns/documentation-accuracy.md)。
- 重写 `/harness-plugin:github-review`，同时消费 `chatgpt-codex-connector`
  行内评审、Claude Code Review 聚合评论与人类评审者评论（第三类输入）。
  状态持久化改为 git commit-message trailers（不再使用 JSON 状态文件），
  Step 1 通过实时 GraphQL 比对做惰性回收。React+resolve 链由 codex 验证
  把关：本地 `codex exec` 确认补丁确实修复了上游 finding 之后，才会触发
  reply + `resolveReviewThread`。
  ([#112](https://github.com/winoooops/vimeflow/pull/112),
  [`e9b6bdc`](https://github.com/winoooops/vimeflow/commit/e9b6bdc),
  closes [#111](https://github.com/winoooops/vimeflow/issues/111)) —
  patterns: [Error Surfacing](docs/reviews/patterns/error-surfacing.md),
  [Documentation Accuracy](docs/reviews/patterns/documentation-accuracy.md),
  [Git Operations](docs/reviews/patterns/git-operations.md)。
  - 禁用 `.github/workflows/codex-review.yml`（重命名为 `.disabled`）。
    连续两个 PR 中，聚合式 Codex Action 每次推送都触达 OpenAI 配额上限
    （[PR #109 复盘](docs/reviews/retrospectives/2026-04-29-tests-panel-bridge-session.md)）；
    日后若配额恢复，可一行 commit 还原。
  - 7 轮自身 dogfood 循环端到端处理约 30 个 findings；其中 16 个是
    spec/plan 未预见、由 dogfood 循环本身发现的回归。0 个遗留 issue。
  - Skill 结构：thin orchestrator（`SKILL.md`，约 700 行）+
    7 个 references（`parsing.md`、`empty-state-classification.md`、
    `verify-prompt.md`、`pattern-kb.md`、`commit-trailers.md`、
    `cleanup-recovery.md`、`input-resolution.md`）+ 2 个脚本
    （`scripts/helpers.sh`、`scripts/verify.sh`）。
  - 复盘：[`docs/reviews/retrospectives/2026-04-30-harness-github-review-rewrite-session.md`](docs/reviews/retrospectives/2026-04-30-harness-github-review-rewrite-session.md)
  - 规格：`docs/superpowers/specs/2026-04-29-harness-github-review-connector-design.md`
  - 计划：`docs/superpowers/plans/2026-04-29-harness-github-review-connector.md`
- Harness 默认后端从 `claude_code_sdk` 改为按角色启动 `claude -p` 子进程。
  直接继承用户本地 `~/.claude` 的 CLI 登录凭证；默认路径不再需要
  `ANTHROPIC_API_KEY` 或 `ANTHROPIC_BASE_URL`。SDK 被保留为通过
  `--client sdk` 显式开启的备用后端（使用时仍需 API key）。
  ([#73](https://github.com/winoooops/vimeflow/pull/73), `93a5338`) —
  patterns: [Policy Judge Hygiene](docs/reviews/patterns/policy-judge-hygiene.md),
  [Fail-Closed Hooks](docs/reviews/patterns/fail-closed-hooks.md),
  [Async Race Conditions](docs/reviews/patterns/async-race-conditions.md),
  [Command Injection](docs/reviews/patterns/command-injection.md),
  [Preflight Checks](docs/reviews/patterns/preflight-checks.md)
  - 新增模块：`cli_client.py`（stream-JSON 解析器 + `ClaudeCliSession`
    会话续传 / stderr 并发排空 / 基于单调时钟的超时预算），
    `hook_runner.py`（CLI → Python 钩子桥，在导入期和运行期都
    fail-closed），`policy_judge.py`（默认拒绝，可通过
    `HARNESS_POLICY_JUDGE=ask` / `=explain` 显式启用 LLM 判定，
    或在 gitignore 的 `.policy_allow.local` 中列出基础命令作为
    确定性放行），`sdk_client.py`（懒加载的备用后端 —— 唯一引入
    `claude_code_sdk` 的模块）。
  - `client.py` 提供共享帮助器：`build_base_settings`、
    `write_settings_file`、`create_client`（CLI 工厂，
    `sdk_client.create_client` 使用同形签名）。
  - 删除了会隐藏 CLI 登录态的 `CLAUDE_CONFIG_DIR` 覆盖。CLI 调用
    使用 `--tools`（排他）替代 `--allowed-tools`（仅允许），与 SDK
    的工具面保持一致。
  - 12 轮云端评审硬化：`shlex.quote` 对钩子命令路径做 shell 转义、
    stderr 并发排空避免管道缓冲区死锁、`fcntl.flock` + 原子写
    保护缓存、用户私有缓存路径 `~/.claude/harness_policy_cache.json`、
    异步化 `_query_claude` 让 SDK 路径的钩子不阻塞事件循环、
    Python 3.9+ 兼容的 `asyncio.wait_for` 超时、
    `ResultEvent(is_error=True)` 升级为 `"error"` 状态、
    并发 ask 模式下的先到先得缓存语义。
  - 规格：`docs/superpowers/plans/2026-04-20-harness-claude-cli-subprocess.md`。
- 刷新 README（英文 + 中文），对齐第 3/4 阶段范围；重设进度跟踪器基线。
  ([#67](https://github.com/winoooops/vimeflow/pull/67), `f590c18`) —
  patterns: [Documentation Accuracy](docs/reviews/patterns/documentation-accuracy.md)

#### Security

- Harness policy judge 改为默认拒绝，不再是 LLM 盖章放行。未在白名单
  中的 bash 命令默认被拒；操作者必须通过 `harness/.policy_allow.local`
  （gitignored，本地手动维护）列出基础命令，或显式设置
  `HARNESS_POLICY_JUDGE=ask`（让 LLM 判定）/ `=explain`（让 LLM 说明
  理由但始终拒绝）。`hook_runner.py` 在全部错误路径都 fail-closed：
  导入期异常、运行期异常，以及一个 45 秒的外层截止期 — 以防 Claude
  CLI 自身的钩子超时先于我们 SIGKILL 进程，导致静默放行。Policy judge
  子进程以 `--tools ""` 启动，无法调用任何工具，也不会触发用户级钩子。
  ([#73](https://github.com/winoooops/vimeflow/pull/73), `93a5338`) —
  patterns: [Policy Judge Hygiene](docs/reviews/patterns/policy-judge-hygiene.md),
  [Fail-Closed Hooks](docs/reviews/patterns/fail-closed-hooks.md)

#### Fixed

- Vite HMR 全量刷新（如在工作区里 `vim :w`、手动刷新、错误边界重置）会摧
  毁 PTY 会话。把会话状态搬进 Rust 文件系统缓存（单一事实源），并引入基于
  游标的回放协议（`offset_start` + `byte_len` + 每个面板的 `cursorRef`）配
  合「先订阅后快照」次序，使任意 remount 都能透明重连到存活 PTY，既不丢字
  节也不重复回放。
  ([#99](https://github.com/winoooops/vimeflow/pull/99), `cb0ffa6`) —
  patterns: [Async Race Conditions](docs/reviews/patterns/async-race-conditions.md),
  [PTY Session Management](docs/reviews/patterns/pty-session-management.md),
  [React Lifecycle](docs/reviews/patterns/react-lifecycle.md),
  [Resource Cleanup](docs/reviews/patterns/resource-cleanup.md)
  - 15 轮 Codex / Claude 评审循环；最终判定 ✅ APPROVE。
  - 复盘：[`docs/reviews/retrospectives/2026-04-27-pty-reattach-review-cycle.md`](docs/reviews/retrospectives/2026-04-27-pty-reattach-review-cycle.md)
  - 设计：[`docs/superpowers/specs/2026-04-25-pty-reattach-on-reload-design.md`](docs/superpowers/specs/2026-04-25-pty-reattach-on-reload-design.md)
  - 未在本 PR 解决、已分别建 issue 的后续：#100（read 循环全局锁性能）、
    #101（`kill_pty` 与 `removeSession` 的活动 tab 旋转策略不一致）、
    #102（`spawn_pty` 在达到上限时遗留 bridge 目录）、
    #103（`RingBuffer` 改用 drain）、#104（清理 `ManagedSession.cwd` 死字
    段）、#105（`TerminalPane` 多余依赖）、#106（收紧 `inner_sessions` 可
    见性）。
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
