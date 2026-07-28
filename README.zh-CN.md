# Vimeflow

<div align="center">

<img src="build/icon.png" alt="Vimeflow 标志" width="128" />

**何必在终端和 GUI 之间二选一？我全都要。**

面向 AI 编码代理的终端优先工作空间：代理 CLI 就住在真正的终端 pane 里，GUI 围着它们转，而不是骑在它们头上。

[English](./README.md) | 简体中文

<img src="docs/media/hero-workspace.gif" alt="在演示项目中创建会话、在原生 Ghostty pane 中启动 Claude Code，并观察代理面板实时显示轨迹（traces）" width="900" />

</div>

Vimeflow 是一个跑在 Rust `vimeflow-backend` 旁路进程（sidecar）之上的 Electron 桌面应用。一个窗口，装下你的代理终端（macOS 上是原生 Ghostty pane）、可用键盘拆分和调整大小的多 pane 布局、文件浏览器、vim 模式编辑器、hunk 级 Git 审查、vim 风格命令面板、随心定制的主题，以及对 Claude Code、Codex CLI、Kimi Code、OpenCode 的实时可观测性。一个工作区装下所有代理，不用再在标签页之间来回横跳。

## macOS 原生 Ghostty 终端

Vimeflow 不是在浏览器里模拟终端。macOS arm64 打包版本把**真正的 Ghostty 引擎**（`libghostty-spm` + parented `NSView`）内置为终端骨架，PTY 仍由 Rust 旁路进程掌管 —— 于是你在 Electron 里直接就能用上 Ghostty 的 GPU 加速渲染。输出随到随画，拖动调整大小时 pane 依然平滑连贯，不会像网页终端那样撕裂、卡顿。

<div align="center">
  <img src="docs/media/ghostty-resize.gif" alt="拖动 Vimeflow 的 pane 分隔条时终端正在实时渲染 —— Ghostty 在整个调整过程中平滑、连贯地重排内容" width="900" />
</div>

**在同一个 pane 里跑你趁手的 TUI** —— `nvim`、`lazygit` 这类全屏工具可以和代理会话并排运行，调整大小时也能干净利落地重排。Linux 与开发回退路径继续使用 xterm.js。

<div align="center">
  <img src="docs/media/ghostty-tui.png" alt="原生 Ghostty 终端 pane 中全屏运行的 Neovim，旁边是一个代理会话" width="900" />
</div>

试一试：

1. 启动 macOS 打包版本，或从源码运行 `npm run electron:dev:ghostty`。
2. 按 `⌘;` 执行 `:layout`，选择一个双 pane 布局。
3. 一个 pane 里启动代理，另一个里跑 `nvim .` —— 两边都是货真价实的 PTY。

终端的工作目录同步依赖 OSC 7。`zsh` 和 `fish` 一般会自动发送；`bash` 用户可以跑一下：

```bash
./scripts/setup-shell-osc7.sh
```

## 多个代理在同一个工作区

每家编码代理 CLI 都爱刷一行自己的状态栏：各家长得不一样、字小得眯眼认半天，还白白吃掉一截终端屏幕。Vimeflow 则给每个代理一块清清爽爽的面板 —— 模型、上下文窗口，外加实时的**轨迹流（traces）**；自动识别，不需要任何包装命令，照常吃你熟悉的 CLI 就行。轨迹流保留**最近 50 次已完成的工具调用**，按代理整理成语义化轨迹（Claude、Codex、Kimi、OpenCode 各有一套 profile）；哪一步动了工作区，旁边就是一键 **Show diff**。于是你看到的不只是代理此刻在干什么，也能回看它刚刚留下的轨迹 —— 并直接跳到某一步留下的改动。

<div align="center">
  <img src="docs/media/multi-agent-grid.png" alt="Claude Code、Codex CLI、Kimi Code 和 OpenCode 各自运行在独立 pane 中，代理状态面板展开" width="900" />
</div>

试一试：

1. 点击侧边栏的 **+** —— 新建会话对话框里可以填会话名称、工作目录，也可以顺便填上随会话启动的代理命令。
2. 按 `⌘;` 执行 `:layout` 选择多 pane 布局。
3. 在任意 pane 中运行 `claude`、`codex`、`kimi` 或 `opencode` —— 状态面板会在它们启动时逐个认出它们。

### 读懂状态侧栏

这块面板不只是几个数字 —— 它是一组可以一眼信任的实时仪表（侧栏收起时，它们会折成一条紧凑竖条）：

<table>
  <tr>
    <td width="28%" valign="top"><img src="docs/media/agent-context.png" alt="代理状态侧栏中的上下文蓄水池仪表" width="100%" /></td>
    <td width="28%" valign="top"><img src="docs/media/agent-cache.png" alt="代理状态侧栏中的缓存命中率环" width="100%" /></td>
    <td width="28%" valign="top"><img src="docs/media/agent-traces.png" alt="代理状态侧栏中的轨迹（Traces）列表 —— 每条工具调用的参数与结果状态" width="100%" /></td>
    <td width="16%" valign="top" align="center"><img src="docs/media/agent-rail-collapsed.png" alt="收起后的侧栏竖条 —— 紧凑的竖向上下文蓄水池在上，小小的缓存环在下" width="52" /></td>
  </tr>
  <tr>
    <td valign="top"><b>上下文蓄水池</b> —— 模型的上下文窗口还剩多少，随着对话变长像水箱一样往下排；水位的颜色还会随用量变化，让你在撞到上限之前就先有感觉。</td>
    <td valign="top"><b>缓存命中率</b> —— 这一轮有多少来自缓存，画成一个环；环越满，这一轮就越便宜、越快。</td>
    <td valign="top"><b>轨迹（Traces）</b> —— 最近 50 次已完成的工具调用：工具名、参数与结果，最新的在最上面。</td>
    <td valign="top"><b>收起态</b> —— 蓄水池和缓存环合成的紧凑竖条。</td>
  </tr>
</table>

### 套餐用量（在 API 允许的范围内）

对于提供了用量接口的代理，面板会在模型旁边实时记录会话与每周用量，帮你把手里的 coding plan 用到极致。

<div align="center">
  <img src="docs/media/usage-bars.png" alt="代理状态卡片，显示模型、对话轮数，以及 5 小时会话与每周用量的套餐用量条，各自标注剩余百分比" width="520" />
</div>

Kimi Code 也会显示同样的用量条 —— 还带一个一键关掉整个追踪的开关：

<div align="center">
  <img src="docs/media/kimi-usage.png" alt="Kimi Code 套餐用量卡片 —— kimi-code/k3，5 小时会话与每周用量条，以及一个 Turn off plan-usage tracking 控件" width="520" />
</div>

<sub><i>Kimi Code 的套餐用量需要显式开启 —— 抓取时会把你配置的 Kimi 凭据发送到 Kimi API；除此之外的检测、transcript tailing 与活动流完全在本地进行（`~/.kimi-code/`）。</i></sub>

<sub><i>OpenCode 没有提供用量配额 API，没有数据也就画不出用量条 —— 状态卡片改为链接到上游请求（[sst/opencode#16017](https://github.com/sst/opencode/issues/16017)）。它通过一个自动安装的小型桥接插件来检测，读取模型、上下文窗口（基于 OpenCode 的 models.dev 缓存推算）与工具活动，全程不碰任何凭据。</i></sub>

## 逐 hunk 审查变更

一个停靠在终端旁边的完整**内联审查界面** —— 而不是把你甩给 `git diff`。diff 由 **Pierre** 的引擎（`@pierre/diffs`）渲染，并随你的工作区主题着色，变更文件列表就在旁边的 pane 里。你可以就地操作 hunk —— **单独暂存或取消暂存一个 hunk**、**丢弃一个 hunk 或整个文件** —— 而且这里的 review 是一场对话，不是独白：**在某一行留下评论，当前正在干活的代理会在同一个 thread 里回应你**、改好代码并标记为已解决。想听第二意见？**Request review** 会把这份 diff 交给一位第三方（tertiary）审查者 —— 派发给另一个代理，或者把提示词复制走，带去哪儿都行。无论哪种方式，你都能逐 hunk 走查代理的改动，趁坏改动还在写的时候就把它抓住，全程不用离开窗口。

<div align="center">
  <img src="docs/media/hunk-review.png" alt="Diff dock 中某处改动行上一条已解决的 review 评论串：一条要求改进无障碍性的评论，代理回复并标记为已解决" width="900" />
</div>

试一试：

1. 在一个有未提交变更的仓库中打开会话。
2. 按 `⌘G`（或 `⌘;` → `:open-diff`）在 pane 旁打开 diff dock。
3. 在变更文件列表里挑一个文件，然后暂存、取消暂存或丢弃单个 hunk。
4. 在 **Settings → Version Control → Hunk Appearance** 中调整 hunk 的渲染样式。

## 无缝的 Worktree 集成

多代理协作意味着多个 git worktree —— 也意味着很容易搞不清自己正在看哪一个。Vimeflow 不会让这种事发生。它会**盯着每个代理的终端，自动识别它何时进入了某个 worktree** —— 一句 `Entering worktree(...)`、一次 `cd`、一份 `EnterWorktree` skill 报告，或是一个 OSC 7 提示 —— 然后**热切换**当前 pane 与之对齐，无需重载，毫不费力。状态栏里的 **git chip** 始终显示你此刻的确切位置（`worktree → branch`），一键即可复制 worktree 名称、路径或分支。

<div align="center">
  <img src="docs/media/worktree-chip.png" alt="git chip 的复制弹层 —— Copy worktree（readme-refresh）、Copy path、Copy branch（docs/readme-refresh），上方是显示 worktree → branch 的状态栏 chip" width="560" />
</div>

更妙的是，代理所在的 worktree **决定了你看到什么**：**文件浏览器**跟随进入那棵目录树，**diff 审查**也把变更文件列表和 hunk 限定在那个 worktree —— 于是你审查的永远是代理真正在改的代码，而不是某个过时的检出。审查更干净，质量门更靠谱，再也不用问「等等，这是哪个分支来着？」

## 命令面板与设置

这个命令面板毫不客气地借鉴了前辈们的精华 —— 命令行速度、Neovim 的肌肉记忆，还有 Zed 的模糊启动器。`⌘;` 打开它：`:new` 新建会话，`:layout` 切换 pane 布局，还有 `:open-diff`、`:open-editor`、`:theme`、`:settings`、`:goto` 等命令 —— 支持模糊匹配，每条命令都能配自己的快捷键。想用 `:tabnew`、`:vsplit`、`:split`、`:only` 这些 Vim 风格别名的话，在设置里选择 Vim 按键预设即可。剩下的交给设置对话框：外观、按键映射、编码代理、编辑器、终端、版本控制等。

<div align="center">
  <img src="docs/media/command-palette.png" alt="工作空间上方打开的 vim 风格命令面板，显示布局与 diff 命令" width="900" />
</div>

试一试：

1. 按 `⌘;` 随便敲几个字母 —— 命令会随输入模糊匹配。
2. 执行 `:new` 新建会话，用 `:goto` 在会话之间跳来跳去。
3. 打开侧边栏底部的 **Settings**，在 **Keymap** 里重新映射按键，或在 **Coding Agents** 里配置代理启动器。

## 主题，随你定制

The Lens 主题系统内置了一批主题 —— **Catppuccin**（默认深色）、**Flexoki**（浅色）、**Gruvbox**（深色与浅色）、**Tokyo Night** 和 **Dracula** —— 应用里每个颜色都是语义化 token，所以整个工作区（连终端在内）都能即时换装，确认之前先实时预览。没有看对眼的那套？**以 JSON 导入导出主题**，自己动手做一套 —— 内置的这些只是起点。

<div align="center">
  <img src="docs/media/theme-tour.gif" alt="通过命令面板实时预览并循环切换内置配色主题" width="900" />
</div>

试一试：

1. 按 `⌘;` 执行 `:theme`。
2. 在列表里上下移动 —— 工作区会在你确认前实时预览每套主题。
3. 按 `Enter` 应用，按 `Esc` 当什么都没发生过。

## 在 Linux 上

上面这一切在 Linux 上照样跑 —— 一样的工作区、一样的 pane、一样的代理可观测性。唯一的区别：终端由 xterm.js 顶上，而不是原生 Ghostty（那个内置目前仅限 macOS）。打包成 AppImage，`chmod +x`，就能开跑。

<div align="center">
  <img src="docs/media/linux-workspace.png" alt="Vimeflow 在 Linux 上运行完整工作区，终端 pane 由 xterm.js 承载" width="900" />
</div>

## 当前支持范围

Vimeflow 目前**仅支持从源码构建和使用 0.1.0 版本**。

- 支持的版本线：`0.1.0`
- 支持的打包目标：在本地从源码构建 Linux x64 AppImage 和 macOS arm64 DMG
- 桌面运行时：Electron 42 + Rust 旁路，通过 LSP 帧 JSON IPC 通信
- 终端运行时：macOS arm64 打包版本内置基于 `libghostty-spm` 的原生 Ghostty；Linux、开发回退和 native 加载失败路径保留 xterm.js
- 代理可观测性：Claude Code、Codex CLI、Kimi Code 和 OpenCode
- 暂不支持：托管二进制发布、Windows 打包、生产签名/公证、自动更新

打包路径与主机绑定：Linux x64 AppImage 需要在 Linux x64 主机上构建，macOS arm64 DMG 需要在 Apple Silicon Mac 上构建。

## 从源码构建和运行

前置条件：

- Node.js >= 22；推荐使用 `.nvmrc` 中的 Node 24，与 CI 对齐
- `nvm` 不是必需，但推荐用它来读取 `.nvmrc`；如果已经通过其他工具启用了 Node 24，可以跳过 `nvm use`
- Rust stable 工具链
- Git
- Linux x64 或 Apple Silicon macOS（对应受支持的打包路径）

```bash
git clone https://github.com/winoooops/vimeflow.git
cd vimeflow
nvm use # 可选：切换到 .nvmrc 中的 Node 24
npm ci
```

想让任一开发实例与已安装的 Vimeflow 完全隔离（独立的会话、设置和代理状态）？把下面任意命令指向一个一次性数据目录即可：

```bash
VIMEFLOW_USER_DATA_DIR=/tmp/vimeflow-demo npm run electron:dev
```

### macOS

用**原生 Ghostty 运行时**启动（也就是打包版本用的终端骨架）：

```bash
npm run electron:dev:ghostty
```

或者走 **xterm.js** 路径 —— 同一个应用，只是不带原生 Ghostty：

```bash
npm run electron:dev
```

构建 arm64 DMG：

```bash
npm run electron:build            # 或：npm run electron:build:mac:arm64
```

DMG 会写入 `release/vimeflow-*-arm64.dmg`。它会打包原生 Ghostty parent runtime，面向本地源码构建，尚未公证。

### Linux

从源码运行 —— Linux 上终端由 **xterm.js** 顶上（原生 Ghostty 目前仅限 macOS）：

```bash
npm run electron:dev
```

如果主机上没有可用的 Chromium sandbox：

```bash
VIMEFLOW_NO_SANDBOX=1 npm run electron:dev
```

构建 x64 AppImage：

```bash
npm run electron:build            # 或：npm run electron:build:linux:x64
```

然后运行它：

```bash
chmod +x release/vimeflow-*.AppImage
./release/vimeflow-*.AppImage --no-sandbox
```

如果主机缺少 `libfuse2`，使用 AppImage 的 extract-and-run 回退方式：

```bash
./release/vimeflow-*.AppImage --appimage-extract-and-run --no-sandbox
```

## 使用 Vimeflow

1. 用 `npm run electron:dev` 或本地构建的安装包启动 Vimeflow。
2. 点击 **+** 在你的项目中创建会话，可以选择随会话直接启动 `claude`、`codex`、`kimi` 或 `opencode`。
3. 拆分 pane、浏览文件、编辑代码、逐 hunk 审查 Git 变更 —— 详见上方功能导览。
4. 检测到受支持的代理后，代理状态面板会自动出现。

## Lifeline 与 Harness Engineering

这个仓库本身也是一次 harness engineering 的实战。Vimeflow 的开发流程使用 [Lifeline Claude Code 扩展](https://github.com/winoooops/lifeline)，覆盖规划、自主实现循环、代码审查、PR 提交、上游 review 处理和 PR 批准。

项目本地安装说明见 [CLAUDE.md](./CLAUDE.md#lifeline-plugin-setup)。

## 验证源码检出

```bash
npm run lint
npm run format:check
npm run type-check
npm test
cargo test --manifest-path crates/backend/Cargo.toml
```

Rust 类型变更后，重新生成 TypeScript 绑定：

```bash
npm run generate:bindings
```

## 项目参考

- 安装与环境细节：[SETUP.md](./SETUP.md)
- 开发命令与代码风格：[DEVELOPMENT.md](./DEVELOPMENT.md)
- 架构与 Electron 旁路 IPC：[ARCHITECT.md](./ARCHITECT.md)
- 设计系统：[DESIGN.md](./DESIGN.md) 和 [docs/design/UNIFIED.md](./docs/design/UNIFIED.md)
- 当前路线图状态：[docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml)
- 更新日志：[CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md) / [CHANGELOG.md](./CHANGELOG.md)
- 后端 crate 说明：[crates/backend/README.md](./crates/backend/README.md)

## 许可证

MIT
