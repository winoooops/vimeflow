# 更新日志

[English](./CHANGELOG.md) | 简体中文

本文件记录 Vimeflow 当前受支持的用户可见状态。更详细的实现时间线请查看 [docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml)、[docs/superpowers/](./docs/superpowers/) 以及 [docs/reviews/CLAUDE.md](./docs/reviews/CLAUDE.md) 中的 review 知识库。

## [Unreleased]

### Added

- Kimi 与 OpenCode 的代理回复捕获（VIM-293）：向 Kimi 或 OpenCode 会话派发评审意见或提问后，代理的结构化回复现在会像 Codex 和 Claude Code 一样渲染到 diff 线程中。Kimi 按轮次缓冲主 wire 上流式追加的 `content.part` 文本块，在 `step.end`/`end_turn` 时提取；OpenCode 的桥接插件（v3）在内存中聚合助手文本分片快照，并在 `session.idle` 时写入一条尾部截断的 `assistant.text` 记录 —— 用户文本永不落盘，且捕获范围仅限助手消息，避免派发提示词自带的示例哨兵块被误认为回复。
- 全变更集委托评审（VIM-327）：Diff 工具栏的 Request-review 弹层新增「当前文件 / 全部变更 (N)」作用域选择（`f`/`a` 快捷键）。「全部变更」会把文件列表中的每一项 —— 已暂存 + 未暂存 + 未跟踪，部分暂存的文件两个半区都会包含 —— 以一条仅含路径的请求发给评审代理，按 `git diff` / `git diff --cached` 分组，未跟踪文件带有「直接读取文件」标注。返回的评审发现基于同一 nonce 锚定到所有被评审文件；同一路径同时存在于两个半区时按行号范围匹配裁决，平局优先工作区。变更集快照在弹层打开时即预取（Copy 保持在剪贴板用户激活窗口内）；合并冲突文件不再解析出错误的 hunk 范围 —— 合并格式（`diff --cc`）的 diff 现在全局降级为文件级锚点。规格文档：[`docs/superpowers/specs/2026-07-13-vim-327-changelist-review-design.md`](./docs/superpowers/specs/2026-07-13-vim-327-changelist-review-design.md)。
- Diff 文件内搜索（VIM-252 的搜索部分）：悬浮在 diff 区域上方的玻璃质感放大镜按钮，可展开一个非阻塞的玻璃搜索弹层（复用 #645 未固定侧栏的玻璃配方），通过 CSS Custom Highlight API 在 Pierre 的 shadow DOM 内实现子串级精确高亮，并带有「当前/总数」计数器与 vim 风格的模态按键 —— `/` 打开搜索，`Esc` 关闭并清除，搜索打开时 `n`/`p` 在匹配间跳转、关闭后恢复为文件导航；新增 `r` 键从键盘刷新当前 diff（刷新按钮内亦显示该快捷键徽标）。匹配为大小写不敏感、作用域限定在当前选中文件，并且在代理持续改写文件导致的刷新中保持存活 —— 查询词、高亮与当前匹配位置在 Pierre 每次重建后都会保留并重绘。规格文档：[`docs/superpowers/specs/2026-07-02-diff-search-design.md`](./docs/superpowers/specs/2026-07-02-diff-search-design.md)。
- macOS arm64 打包版本内置原生 Ghostty 终端运行时。应用通过 SwiftPM bridge 打包 `libghostty-spm` 和 `ghostty_native_parent.node`，让 parented Ghostty `NSView` 成为 macOS 终端骨架；Rust 旁路仍拥有 PTY。Linux、开发回退和 native Ghostty 不可用时继续使用 xterm.js。
- 官方代理可观测性支持范围现包含 Claude Code、Codex CLI、Kimi Code 和 OpenCode。Kimi Code 检测会识别 `kimi` / `kimi-code`，读取 `~/.kimi-code/` 下的状态，实时流式展示持久化 `wire.jsonl` 活动，并把套餐用量的网络抓取放在显式同意之后。
- OpenCode 代理可观测性。检测会识别 `opencode`；一个随仓库内置、自动安装的桥接插件，会把每个会话的事件以「每会话一份 JSONL」的形式写入 Vimeflow 自有目录（采用 Kimi 式的纯文件系统方案，不与 SQLite/数据库耦合），Rust 适配器对其进行 tail，实时展示模型、上下文窗口与工具活动。上下文窗口用量基于 OpenCode 的 models.dev 缓存推算，并且会计入缓存命中的 prompt token（与 OpenCode 自身的用量条一致）；由于 OpenCode 的 TUI 不发出 OSC 7，会话改用 pid 绑定以确保正确接入，并支持 `/clear` 后的重新接入。桥接插件不访问任何凭据或账号 token。OpenCode 未提供用量配额 API，因此代理状态卡片以「OpenCode 暂未暴露用量上限」提示加上游请求链接（[sst/opencode#16017](https://github.com/sst/opencode/issues/16017)）替代套餐用量条。
- 运行时主题系统：Catppuccin（深色，默认）、Flexoki（浅色）、Gruvbox Dark、Gruvbox Light、Tokyo Night 和 Dracula 现可通过命令面板（`:theme <名称>`）即时切换，无需重启应用。终端（macOS 原生 Ghostty 与 xterm.js 回退）、代码编辑器（CodeMirror）以及 Diff 查看器（Pierre）均通过各自的桥接适配器实时换肤。所有原先硬编码的十六进制颜色已迁移为语义化 CSS 变量 token，统一定义于 `src/theme/themes/*.ts`，并由 `src/theme/service.ts` 在运行时应用。新增 ESLint 规则 `vimeflow/no-hardcoded-colors` 与 CSS 守卫测试，防止颜色回归。规格文档：[`docs/superpowers/specs/2026-06-11-theme-system-design.md`](./docs/superpowers/specs/2026-06-11-theme-system-design.md)。

### Changed

- 将英文和中文 README 缩短为当前 `0.1.0` 版本线的源码构建指南，并把更深入的实现细节改为通过引用文档进入。
- 在中英文 README 中补充 Lifeline Claude Code 扩展，以及本仓库作为 harness engineering 实践项目的定位。

### Fixed

- Diff 键盘快捷键不会再在点击刷新按钮后、或代理持续改写当前查看文件时失效。面板内的 pointerdown 事件现在会在到达 DockPanel 的 section 级焦点抢占之前被拦截；被静默卸载的聚焦元素（Chromium 在元素移除时不触发 blur）导致的焦点丢失会在下一次渲染时被找回；主动点击面板外部的行为永远不会被覆盖；关闭 diff 搜索的清理路径也不再从终端抢走焦点。
- 工作区内的滚动条（包括编辑器、Diff Viewer、侧栏文件浏览器以及 Agent 活动代码预览）现已统一为设计系统的 `thin-scrollbar` 样式（6px、透明 track、`#333344` 拇指，hover 时变亮到 `#4a444f`）。此前部分滚动条会显示 WebKit 默认样式。
- 应用内终端现在可以正常运行 `nvim`、`htop`、`less` 等全屏 TUI 应用程序。此前生产构建会在第一个 DECRQM 模式查询转义序列上卡住——原因是 esbuild 的压缩器破坏了 `@xterm/xterm` 中 `requestMode` 处理函数的 const-enum IIFE 片段。Vite 已切换到 `terser` 压缩器，该模式可被完整保留。(#249)

## [0.1.0] - 当前源码支持版本线

### Supported

- Vimeflow 目前仅支持从源码构建和使用 `0.1.0`。
- Linux x64 AppImage 和 macOS arm64 DMG 是当前受支持的打包目标，需要在本地通过 `npm run electron:build` 构建。
- 暂不支持托管二进制发布、签名安装包、自动更新、Windows 打包。

### Added

- Electron 42 桌面外壳与 Rust `vimeflow-backend` 旁路进程，通过 LSP 帧 JSON IPC 通信，并取代历史 Tauri runtime。参见 Electron 迁移复盘：[docs/superpowers/retros/2026-05-16-electron-migration.md](./docs/superpowers/retros/2026-05-16-electron-migration.md)。
- 终端优先工作空间：会话标签、多 pane `SplitView` 布局、可停靠编辑器和 Diff 面板、文件浏览器、Git Diff、命令面板和状态栏。
- 通过共享后端 adapter 模型和前端 agent-status 面板支持 Claude Code、Codex CLI 与 Kimi Code 可观测性。
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
