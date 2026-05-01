# Vimeflow

<div align="center">

**终端优先时代的 CLI Agent 控制面板**

[English](./README.md) | 简体中文

</div>

<div align="center">

<img src="docs/media/hero-init.gif" alt="在 Vimeflow 中启动 Claude Code 会话并运行 /init — 代理面板自动识别并实时显示工具调用" width="900" />

<sub>启动 <code>claude</code>，运行 <code>/init</code>，观察代理面板自动识别并实时显示工具调用。</sub>

</div>

> 一个 Tauri 桌面应用，将终端会话、文件浏览器、代码编辑器和 Git Diff 统一到一个工作空间 — 专为 Claude Code 等 AI 编码代理打造。

Vimeflow 是一个 **CLI 编码代理控制面板**，基于 Tauri 2（Rust + React/TypeScript）构建。它在一个窗口内管理 AI 代理工作的终端会话、浏览文件、审查 Diff 和编辑代码 — 全部配备 Vim 风格快捷键和暗色氛围 UI。

但产品只是故事的一半。这个仓库也是**工程化 AI 原生开发**的试验场：自主代理循环从规格说明构建功能，由分层规则和专业代理管控。

## 已实现功能

![Vimeflow 工作空间 — 图标栏、侧边栏、运行中的 Claude Code 会话和代理状态面板](docs/media/workspace-overview.png)

### 终端核心（第 3 阶段）

完整的 xterm.js 终端，集成 Tauri Rust PTY 后端：

- **TauriTerminalService** — xterm.js 与 `portable-pty` 之间的单例 IPC 桥接
- Rust PTY 命令：spawn、write、resize、kill — stdout 通过 Tauri 事件流式传输
- 按标签页缓存会话，支持多标签终端
- ResizeObserver + FitAddon 实现响应式终端尺寸
- WebGL 渲染器 + Catppuccin Mocha 主题

### 工作空间布局（第 2 阶段）

借鉴 IDE + 终端复用器模式的 4 区网格布局：

- **图标栏** — 项目头像和导航
- **侧边栏** — 会话列表和状态指示器
- **终端区** — 主工作区域（xterm.js 终端）
- **代理活动面板** — 状态、指标、可折叠区域
- **上下文切换器** — 文件 / 编辑器 / Diff 标签页

### 代理状态侧边栏（第 4 阶段 — 最新）

实时代理可观察性面板，自动检测终端会话中运行的 AI 编码代理：

- **Rust 后端** — `src-tauri/src/agent/` 模块包含代理检测器（进程树轮询）、statusline 文件监听器（`notify` crate）和 JSONL transcript 解析器用于工具调用跟踪
- **Statusline 桥接** — 每会话 shell 脚本将 Claude Code 的 statusline JSON 输出到被监听文件；Rust 解析并通过 Tauri 事件发送（`agent-detected`、`agent-status`、`agent-tool-call`、`agent-disconnected`）
- **前端面板** — `src/features/agent-status/` 包含订阅 Tauri 事件的 `useAgentStatus` hook，以及组件：StatusCard（身份 + 模型徽章）、BudgetMetrics（自适应 API Key / 订阅者布局）、ContextBucket（填充仪表 + 进度条）、ToolCallSummary（聚合芯片）、RecentToolCalls、FilesChanged、TestResults 和 ActivityFooter
- **自动折叠** — 未检测到代理时面板为 0px，检测到时动画展开到 280px，断开后保留最终状态 5 秒
- **ts-rs 类型代码生成** — Rust 类型自动导出到 `src/bindings/`，前端可类型安全消费

设计规格：[`docs/superpowers/specs/2026-04-12-agent-status-sidebar/`](docs/superpowers/specs/2026-04-12-agent-status-sidebar/CLAUDE.md)

<p align="center">
  <img src="docs/media/agent-status-sidebar.png" alt="代理状态侧边栏 — 上下文计量器、Token 缓存、活动事件流、变更文件、测试面板" width="280" />
</p>

<sub align="center">右侧面板特写 — 上下文计量器、Token 缓存、活动事件流、变更文件和测试面板，由实时 Claude Code 会话填充。</sub>

### 功能模块

| 模块                | 描述                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- |
| **terminal**        | xterm.js + Tauri PTY IPC 桥接，会话管理                                               |
| **editor**          | IDE 风格标签编辑器 — CodeMirror 6、Vim 模式、语言扩展、Vim 状态栏                     |
| **diff**            | Lazygit 风格 Git Diff 查看器（并排 + 统一视图，hunk 导航，暂存/丢弃）                 |
| **files**           | 文件浏览树，面包屑导航，Git 状态徽章（M/A/D/U），拖放支持                             |
| **command-palette** | Vim 风格 `:` 命令面板（全局快捷键、模糊匹配、命名空间下钻）— 内置命令注册表陆续交付中 |
| **agent-status**    | 实时代理可观察性面板（statusline 桥接 + transcript 解析）                             |
| **workspace**       | 组合以上所有区域的布局外壳                                                            |

![编辑器与 Vim 模式 — 输入 `:w`，状态栏显示 -- NORMAL --](docs/media/editor-vim.png)

![Diff 查看器 — 变更文件列表和带绿色新增行的差异块](docs/media/git-diff.png)

### 质量保障

- **1399 测试**通过（另有 3 个跳过，共 1402）、**~91% 覆盖率**
- 无障碍优先的测试查询（`getByRole` 优于 `getByText`）
- Pre-commit 钩子：对暂存文件运行 ESLint + Prettier
- Commit-msg 钩子：commitlint 约定式提交
- Pre-push 钩子：完整 Vitest 运行

## 更新日志

参见 [`CHANGELOG.zh-CN.md`](./CHANGELOG.zh-CN.md)（中文）或 [`CHANGELOG.md`](./CHANGELOG.md)（English）— 记录所有重要变更的线性时间线。每条记录可交叉链接 [`docs/reviews/`](./docs/reviews/CLAUDE.md) 中该变更应用、更新或新增的复盘模式 — CHANGELOG 记录"何时"，`docs/reviews/` 记录"为何"。

## 技术栈

| 层级       | 技术                                                   |
| ---------- | ------------------------------------------------------ |
| **桌面**   | Tauri 2、Rust、portable-pty、tokio                     |
| **前端**   | React 19、TypeScript 5（严格模式）、Vite               |
| **样式**   | Tailwind CSS v4、Catppuccin Mocha 语义化 Token         |
| **终端**   | xterm.js 6、WebGL addon、FitAddon                      |
| **编辑器** | CodeMirror 6、@replit/codemirror-vim（Vim 模式）       |
| **动画**   | Framer Motion 12                                       |
| **测试**   | Vitest 3、Testing Library                              |
| **质量**   | ESLint 9（flat config）、Prettier 3、Husky、commitlint |
| **Git**    | simple-git 3、diff2html 3                              |

## 设计系统："黑曜石之眼"

基于 Catppuccin Mocha 调色板的暗色氛围 UI — 将 UI 视为深邃虚空中的发光半透明层。

- **无可见边框** — 使用色调深度和表面层级（8 级）
- **玻璃态射** 用于浮动元素（60-80% 透明度，12-20px 模糊）
- **字体**：Manrope（标题）、Inter（正文/标签）、JetBrains Mono（代码）
- **语义化 Token**：`bg-surface-container`、`text-on-surface`、`text-primary` 等

完整规格：[`docs/design/DESIGN.md`](docs/design/DESIGN.md)

## 快速开始

```bash
# 前置条件：Node >= 24，Rust 工具链
nvm use                          # 使用 .nvmrc

# 仅前端（无 Tauri 后端）
npm install
npm run dev                      # Vite 开发服务器，localhost:1420

# 完整桌面应用（需要 Rust）
npm run tauri:dev                # Tauri + Rust 后端

# 测试
npm test                         # 1399 测试（另有 3 个跳过）
npx vitest run src/path/file.test.tsx  # 单文件测试

# 质量检查
npm run lint                     # ESLint（类型检查）
npm run format:check             # Prettier 检查
npm run type-check               # tsc -b
```

### Harness 插件安装

自主开发引擎以本地 Claude Code 插件形式提供三个技能：`/harness-plugin:loop`（代理循环）、`/harness-plugin:review`（本地 Codex 审查）、`/harness-plugin:github-review`（PR 审查修复）。

```bash
# 1. 添加项目本地插件市场（一次性）
/plugin marketplace add .

# 2. 安装 harness 插件
/plugin install harness-plugin@harness

# 3. 重载激活
/reload-plugins
```

插件市场定义在 `.claude-plugin/marketplace.json`，插件源码位于 `plugins/harness/`。安装后，技能缓存在 `~/.claude/plugins/cache/harness/`，跨会话持久化。

> 由于[已知的 Claude Code 问题](https://github.com/anthropics/claude-code/issues/18949)，插件技能不会出现在 `/` 自动补全中。可选的自动补全变通方法见 [`CLAUDE.md`](CLAUDE.md#harness-plugin-setup)（在 `~/.claude/commands/` 中创建轻量命令包装器）。

## 仓库结构

```
CLAUDE.md                   # AI 导航中心（代理从这里开始）
ARCHITECT.md                # 架构决策、Tauri IPC 模式
docs/design/DESIGN.md       # UI 设计系统（唯一真实来源）

src/
├── features/
│   ├── terminal/           # xterm.js + TauriTerminalService IPC 桥接
│   ├── editor/             # CodeMirror 标签式代码编辑器
│   ├── diff/               # Lazygit 风格 Diff 查看器
│   ├── files/              # 文件浏览树
│   ├── command-palette/    # Vim 风格命令面板
│   ├── agent-status/       # 实时代理可观察性面板
│   └── workspace/          # 4 区布局外壳
├── components/layout/      # 共享布局（IconRail、Sidebar、TopTabBar、ContextPanel）
└── test/                   # Vitest 配置

src-tauri/
├── src/
│   ├── main.rs             # Tauri 入口
│   ├── lib.rs              # 库配置
│   ├── terminal/           # PTY 命令、状态、类型
│   ├── filesystem/         # 列表/读/写命令，含 scope 验证
│   ├── git/                # Git 状态、Diff、暂存/取消暂存
│   └── agent/              # 代理检测器、statusline 监听器、transcript 解析器
├── Cargo.toml              # Rust 依赖
└── tauri.conf.json         # Tauri 配置

agents/                     # 10 个专业 AI 代理定义
rules/                      # 分层开发标准（通用 + TS + Rust）
harness/                    # 自主开发循环（Python；默认按角色启动 `claude -p` 子进程，SDK 作为备用）
```

## AI 原生开发流程

传统项目由人类编写代码，AI 辅助。Vimeflow 反转了这一模式：

1. **人类编写规格说明** — 产品需求、设计系统、开发规则
2. **自主引擎构建功能** — 双代理循环（初始化器 + 编码器）将规格分解为功能列表并逐步实现
3. **专业代理审查工作** — 10 个 AI 代理分别负责规划、TDD、代码审查、安全和文档
4. **规则管控一切** — 分层规则系统（通用层 + 语言特定层）确保一致性，无需人工逐次提交干预

引擎（`harness/`）是一个 Python 循环，按角色启动 `claude -p` 子进程 — 默认路径直接继承用户本地的 Claude Code CLI 登录状态，无需 `ANTHROPIC_API_KEY`。SDK 路径被保留为可选的备用后端（`--client sdk`）。双语概览见 [`docs/harness/CLAUDE.md`](docs/harness/CLAUDE.md)，完整参考见 [`harness/CLAUDE.md`](harness/CLAUDE.md)。

## 路线图

| 阶段       | 状态   | 描述                                        |
| ---------- | ------ | ------------------------------------------- |
| 第 1 阶段  | 已完成 | Tauri 脚手架、Rust 编译、CI 通过            |
| 第 2 阶段  | 已完成 | 工作空间布局外壳（4 区网格，所有组件）      |
| 第 3 阶段  | 已完成 | 终端核心（xterm.js + Tauri PTY IPC）        |
| 第 4 阶段  | 已完成 | 代理状态侧边栏（检测、statusline 桥接、UI） |
| 第 5 阶段  | 下一步 | 会话管理 + Zustand 状态                     |
| 第 6+ 阶段 | 计划中 | 真实 Git 操作、AI 代理输出流、拖放功能      |

进度跟踪：[`docs/roadmap/progress.yaml`](docs/roadmap/progress.yaml)

## 许可证

MIT
