# 更新日志

[English](./CHANGELOG.md) | 简体中文

本文件记录 Vimeflow 当前受支持的用户可见状态。更详细的实现时间线请查看 [docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml)、[docs/superpowers/](./docs/superpowers/) 以及 [docs/reviews/](./docs/reviews/CLAUDE.md) 中的 review 知识库。

## [Unreleased]

### Changed

- 将英文和中文 README 缩短为当前 `0.1.0` 版本线的源码构建指南，并把更深入的实现细节改为通过引用文档进入。
- 在中英文 README 中补充 Lifeline Claude Code 扩展，以及本仓库作为 harness engineering 实践项目的定位。

## [0.1.0] - 当前源码支持版本线

### Supported

- Vimeflow 目前仅支持从源码构建和使用 `0.1.0`。
- Linux AppImage 是当前唯一受支持的打包目标，需要在本地通过 `npm run electron:build` 构建。
- 暂不支持托管二进制发布、签名安装包、自动更新、macOS / Windows 打包。

### Added

- Electron 42 桌面外壳与 Rust `vimeflow-backend` 旁路进程，通过 LSP 帧 JSON IPC 通信，并取代历史 Tauri runtime。参见 Electron 迁移复盘：[docs/superpowers/retros/2026-05-16-electron-migration.md](./docs/superpowers/retros/2026-05-16-electron-migration.md)。
- 终端优先工作空间：会话标签、多 pane `SplitView` 布局、可停靠编辑器和 Diff 面板、文件浏览器、Git Diff、命令面板和状态栏。
- 通过共享后端 adapter 模型和前端 agent-status 面板支持 Claude Code 与 Codex 可观测性。
- 支持来自 Codex transcript 事件和终端 OSC 7 的 cwd 跟踪，并在 pane header 中显示 linked-worktree 名称。
- 代理状态 UI 打磨，包括折叠 rail 的 bucket meters 和 activity 详情 tooltip。

### Changed

- Rust 后端移动到 `crates/backend/`，并纳入仓库根目录 Cargo workspace。当前唯一发布的 Rust 二进制是 `vimeflow-backend`。
- E2E 覆盖切换到 WebdriverIO 与 `@wdio/electron-service`；旧 Tauri driver 路径已经移除。
- UI handoff 仍在进行中。已完成和剩余项目记录在 [docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml)。

### Fixed

- Tooltip floating anchor 引用在 anchor 更新后仍能保持正确。
- 修复近期 workspace 打磨中出现的终端 pane 焦点和边框重置问题。

### Removed

- Tauri runtime 文件、Tauri npm 脚本、Tauri 依赖，以及旧 Tauri build workflow。

### References

- 构建与安装：[SETUP.md](./SETUP.md)
- 开发命令：[DEVELOPMENT.md](./DEVELOPMENT.md)
- 架构：[ARCHITECT.md](./ARCHITECT.md)
- 当前路线图状态：[docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml)
