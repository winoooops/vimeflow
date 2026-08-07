# Vimeflow

<div align="center">

<img src="build/icon.png" alt="Vimeflow 标志" width="128" />

**何必在终端和 GUI 之间二选一？我全都要 —— 提升效率，进入心流。**

代理 CLI 运行在真实的终端窗格中，GUI 围绕终端构建，而不是取而代之。

[English](./README.md) | 简体中文

<img src="docs/media/hero-workspace.gif" alt="在演示项目中创建会话、在原生 Ghostty 窗格中启动 Claude Code，并观察代理面板实时显示轨迹（traces）" width="900" />

</div>

Vimeflow 是一个基于 Electron 的桌面应用，由 Rust 编写的 `vimeflow-backend` sidecar 提供后端支持。一个窗口即可提供：代理终端（macOS 上为原生 Ghostty 窗格）、可通过键盘拆分和调整的多窗格布局、文件浏览器、支持 vim 模式的编辑器、hunk 级 Git 审查、vim 风格的命令面板、可自定义的主题，以及对 Claude Code、Codex CLI、Kimi Code 和 OpenCode 的实时状态观测。

## 目录

- [macOS 原生 Ghostty 终端](#macos-原生-ghostty-终端)
- [多代理，同一个工作区](#多代理同一个工作区)
- [从上次离开的地方继续](#从上次离开的地方继续)
- [逐 hunk 审查变更](#逐-hunk-审查变更)
- [Worktree 集成](#worktree-集成)
- [命令面板与设置](#命令面板与设置)
- [主题](#主题)
- [光标特效](#光标特效)
- [Linux](#linux)
- [当前支持范围](#当前支持范围)
- [从源码构建和运行](#从源码构建和运行)
- [项目参考](#项目参考)

## macOS 原生 Ghostty 终端

Vimeflow 不在浏览器中模拟终端。macOS arm64 的打包版本直接内嵌 Ghostty 引擎（`libghostty-spm`，挂载在原生 `NSView` 上），PTY 则由 Rust sidecar 管理。因此你可以在 Electron 中获得 Ghostty 的 GPU 加速渲染：输出实时绘制，调整窗格大小时内容平滑重排，不会出现网页终端常见的撕裂或卡顿。

<div align="center">
  <img src="docs/media/ghostty-resize.gif" alt="拖动 Vimeflow 的窗格分隔条时终端正在实时渲染 —— Ghostty 在整个调整过程中平滑、连贯地重排内容" width="900" />
</div>

**在同一个窗格中运行全屏 TUI** —— `nvim`、`lazygit` 等工具可以与代理会话并排运行，并在调整大小时正常重排。Linux 和开发环境的回退路径使用 xterm.js。

<div align="center">
  <img src="docs/media/ghostty-tui.png" alt="原生 Ghostty 终端窗格中全屏运行的 Neovim，旁边是一个代理会话" width="900" />
</div>

<sub><i>Try it:<br>1. 启动 macOS 打包版本，或从源码运行 `npm run electron:dev:ghostty`。<br> 2. 按 `⌘;` 执行 `:layout`，选择一个双窗格布局。<br> 3. 在一个窗格中启动代理，在另一个中运行 `nvim .` —— 两边都是真实的 PTY。</i></sub>

终端的工作目录同步依赖 OSC 7。`zsh` 和 `fish` 一般会自动发送；`bash` 用户可以运行：

```bash
./scripts/setup-shell-osc7.sh
```

## 多代理，同一个工作区

大多数编码代理 CLI 只用一行状态栏汇报状态。Vimeflow 为每个代理提供一块独立的面板 —— 显示模型、上下文窗口和实时的 traces（工具调用轨迹）；面板会自动识别正在运行的 CLI，无需任何包装命令。traces 保留最近 50 次已完成的工具调用，并按代理分别整理（Claude、Codex、Kimi、OpenCode 各有对应的配置）；凡是对工作区产生改动的 trace，都会附带 **Show diff** 入口，可以直接跳到该步产生的变更。

<div align="center">
  <img src="docs/media/multi-agent-grid.png" alt="Claude Code、Codex CLI、Kimi Code 和 OpenCode 各自运行在独立窗格中，代理状态面板展开" width="900" />
</div>

<sub><i>Try it:<br>1. 点击侧边栏的 **+**，在新建会话对话框中填写会话名称、工作目录，也可以顺便填上随会话启动的代理命令。<br> 2. 按 `⌘;` 执行 `:layout`，选择多窗格布局。<br> 3. 在任意窗格中运行 `claude`、`codex`、`kimi` 或 `opencode`，状态面板会在代理启动时自动识别。</i></sub>

### 状态侧栏说明

面板由一组实时仪表组成；收起侧栏时，它们会折叠成一条紧凑的竖条：

<table>
  <tr>
    <td width="28%" valign="top"><img src="docs/media/agent-context.png" alt="代理状态侧栏中的上下文余量仪表" width="100%" /></td>
    <td width="28%" valign="top"><img src="docs/media/agent-cache.png" alt="代理状态侧栏中的缓存命中率圆环" width="100%" /></td>
    <td width="28%" valign="top"><img src="docs/media/agent-traces.png" alt="代理状态侧栏中的轨迹（Traces）列表 —— 每条工具调用的参数与结果状态" width="100%" /></td>
    <td width="16%" valign="top" align="center"><img src="docs/media/agent-rail-collapsed.png" alt="收起后的侧栏竖条 —— 紧凑的竖向上下文余量在上，缓存圆环在下" width="52" /></td>
  </tr>
  <tr>
    <td valign="top"><b>上下文余量</b> —— 模型上下文窗口的剩余量。填充颜色会随用量变化，接近上限时一眼可见。</td>
    <td valign="top"><b>缓存命中率</b> —— 当前这一轮有多少内容来自缓存，以圆环表示。圆环越满，这一轮越快、越省。</td>
    <td valign="top"><b>轨迹（Traces）</b> —— 最近 50 次已完成的工具调用：工具名、参数与结果状态，最新的排在最前。</td>
    <td valign="top"><b>收起态</b> —— 上下文余量与缓存圆环折叠成一条紧凑竖条。</td>
  </tr>
</table>

### 套餐用量（取决于 API 支持）

对于提供用量接口的代理 —— 目前完整支持 Codex CLI 和 Claude Code —— 面板会在模型信息旁实时显示会话用量和每周用量。

<div align="center">
  <img src="docs/media/usage-bars.png" alt="代理状态卡片，显示模型、对话轮数，以及 5 小时会话与每周用量的套餐用量条，各自标注剩余百分比" width="520" />
</div>

Kimi Code 同样显示这些用量条，并提供一键关闭用量追踪的开关：

<div align="center">
  <img src="docs/media/kimi-usage.png" alt="Kimi Code 套餐用量卡片 —— kimi-code/k3，5 小时会话与每周用量条，以及 Turn off plan-usage tracking 控件" width="520" />
</div>

<sub><i>Kimi Code 的套餐用量需要显式开启 —— 获取用量时会把你配置的 Kimi 凭据发送到 Kimi API；除此之外的检测、transcript 跟踪与活动流完全在本地进行（`~/.kimi-code/`）。</i></sub>

<sub><i>OpenCode 没有提供用量配额 API，因此无法绘制用量条 —— 状态卡片改为链接到上游的相应请求（[sst/opencode#16017](https://github.com/sst/opencode/issues/16017)）。OpenCode 通过一个自动安装的小型桥接插件来识别，可读取模型、上下文窗口（基于 OpenCode 的 models.dev 缓存推算）与工具活动，全程不访问任何凭据。</i></sub>

## 从上次离开的地方继续

关掉 Vimeflow 并不会终结代理们的一天。工作区会记住每一个会话 —— 布局、窗格、以及每个窗格里正在进行的对话 —— 下次启动时全部原样回来：每个代理窗格自动重发各自的恢复命令（`claude --resume`、`codex resume` 等），精确接回原来那场对话。满工作区的半成品任务，重开后依然是满工作区的半成品任务，而不是一排空白提示符。

<div align="center">
  <img src="docs/media/session-resume.gif" alt="重新打开 Vimeflow：三个代理窗格各自重发恢复命令，回到之前所在的对话" width="900" />
</div>

<sub><i>会话连同布局一起恢复。每个已识别的代理按会话 id 接续；没有可恢复内容的窗格则以全新 shell 回来。</i></sub>

## 逐 hunk 审查变更

Vimeflow 在终端旁提供了一个停靠的完整内联审查界面，而不是简单地调用 `git diff`。diff 由 Pierre 的引擎（`@pierre/diffs`）渲染，配色与工作区主题一致，变更文件列表显示在旁边的窗格中。你可以直接对 hunk 进行操作：单独暂存或取消暂存某个 hunk，或者丢弃某个 hunk 乃至整个文件。

审查过程是双向的：在某一行留下评论后，正在该会话中工作的代理会在同一评论串中回复并修改代码，是否标记为已解决（Resolve）由你决定。如果需要第二意见，**Request review** 可以把这份 diff 交给另一位审查者 —— 派发给另一个代理，或者复制提示词到其他地方使用。无论哪种方式，你都可以逐个 hunk 检查代理的改动，在代码尚未写完时发现问题，全程无需离开窗口。

<div align="center">
  <img src="docs/media/hunk-review.png" alt="diff 面板中某处改动行上的审查评论串：一条要求改进无障碍性的评论，代理回复后由用户标记为已解决" width="900" />
</div>

<sub><i>Try it:<br>1. 在一个有未提交变更的仓库中打开会话。<br> 2. 按 `⌘G`（或 `⌘;` → `:open-diff`）在窗格旁打开 diff 面板。<br> 3. 在变更文件列表中选择一个文件，然后暂存、取消暂存或丢弃单个 hunk。<br> 4. 在 **Settings → Version Control → Hunk Appearance** 中调整 hunk 的渲染样式。</i></sub>

## Worktree 集成

同时使用多个代理通常意味着多个 git worktree，很容易分不清自己正在查看哪一个。Vimeflow 会监听每个代理的终端，自动检测它何时进入了某个 worktree —— 无论是一条 `Entering worktree(...)` 输出、一次 `cd`、一份 `EnterWorktree` skill 报告，还是 OSC 7 提示 —— 然后自动将窗格切换到对应的 worktree，无需重新加载。状态栏中的 git chip 始终显示当前位置（`worktree → branch`），单击即可复制 worktree 名称、路径或分支。

<div align="center">
  <img src="docs/media/worktree-chip.png" alt="git chip 的复制弹层 —— Copy worktree（readme-refresh）、Copy path、Copy branch（docs/readme-refresh），上方是显示 worktree → branch 的状态栏 chip" width="560" />
</div>

代理所在的 worktree 还决定了你看到的内容：文件浏览器会跟随进入该目录树，diff 审查也会把变更文件列表和 hunk 限定在该 worktree 内。因此你审查的始终是代理实际在修改的代码，而不是某个过时的检出。

## 命令面板与设置

命令面板结合了命令行的速度、Neovim 风格的别名和 Zed 风格的模糊匹配。按 `⌘;` 打开：`:new` 新建会话，`:layout` 切换窗格布局，此外还有 `:open-diff`、`:open-editor`、`:theme`、`:settings`、`:goto` 等命令，均支持模糊匹配和自定义快捷键。如果习惯 `:tabnew`、`:vsplit`、`:split`、`:only` 这类 Vim 风格的别名，可以在设置中选择 Vim 按键预设。其余选项都在设置对话框中：外观、按键映射、编码代理、编辑器、终端、版本控制等。

<div align="center">
  <img src="docs/media/command-palette.png" alt="工作区上方打开的 vim 风格命令面板，显示布局与 diff 命令" width="900" />
</div>

<sub><i>Try it:<br>1. 按 `⌘;` 后输入几个字母，命令会随输入模糊匹配。<br> 2. 执行 `:new` 新建会话，用 `:goto` 在会话之间切换。<br> 3. 打开侧边栏底部的 **Settings**，在 **Keymap** 中重新映射按键，或在 **Coding Agents** 中配置代理启动器。</i></sub>

## 主题

The Lens 主题系统内置了多套主题 —— **Catppuccin**（默认深色）、**Flexoki**（浅色）、**Gruvbox**（深色与浅色），以及 **Tokyo Night**、**Dracula** 等。应用中的所有颜色都是语义化 token，因此整个工作区（包括终端）可以即时换色，并在应用前实时预览。你也可以通过 JSON 导入、导出主题，制作自己的配色。

<div align="center">
  <img src="docs/media/theme-tour.gif" alt="通过命令面板实时预览并切换内置配色主题" width="900" />
</div>

<sub><i>Try it:<br>1. 按 `⌘;` 执行 `:theme`。<br> 2. 在列表中上下移动，工作区会实时预览每套主题。<br> 3. 按 `Enter` 应用，按 `Esc` 取消预览。</i></sub>

## 光标特效

五种光标拖尾动效，默认关闭。在 macOS 上它们是运行在 Ghostty 引擎内部的真实 GLSL 着色器；在 Linux 上由 xterm.js 插件绘制等效效果。每种特效都由光标移动触发，因此它们之间的差异，体现在对「跳跃」与「连续移动」的不同响应上。

<table>
  <tr>
    <td width="50%" valign="top"><div><sub><b>Warp</b> —— 跳转时在两点之间拉伸</sub></div><img src="docs/media/cursor-warp.gif" alt="Warp 光标特效 —— 光标在文件中跳转时被拉伸并回弹" width="100%" /></td>
    <td width="50%" valign="top"><div><sub><b>Sweep</b> —— 亮带沿移动路径扫过</sub></div><img src="docs/media/cursor-sweep.gif" alt="Sweep 光标特效 —— 一道亮带沿光标经过的路径扫过" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><div><sub><b>Tail</b> —— 拖出一道渐隐的尾迹</sub></div><img src="docs/media/cursor-tail.gif" alt="Tail 光标特效 —— 光标在缓冲区中移动时拖出一道渐隐的尾迹" width="100%" /></td>
    <td width="50%" valign="top"><div><sub><b>Ripple</b> —— 每个落点扩散出一圈涟漪</sub></div><img src="docs/media/cursor-ripple.gif" alt="Ripple 光标特效 —— 光标每次落点都向外扩散出一圈涟漪" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><div><sub><b>Sonic Boom</b> —— 快速长距离移动时迸发冲击波</sub></div><img src="docs/media/cursor-sonic-boom.gif" alt="Sonic Boom 光标特效 —— 快速长距离移动时从光标处迸发冲击波" width="100%" /></td>
    <td width="50%" valign="top"></td>
  </tr>
</table>

<sub><i>Try it:<br>1. 打开 **设置** → **终端**。<br> 2. 将 **Cursor Effect** 设为 Warp、Sweep、Tail、Ripple 或 Sonic Boom 之一 —— 实时生效，无需重启。<br> 3. 设回 **Off** 即可关闭。</i></sub>

<sub><i>macOS 上这些特效需要保留着色器编译器的 `libghostty`，而[上游](https://github.com/Lakr233/libghostty-spm)将其裁掉了 —— 打包版本链接的是保留它的[替代版本](https://github.com/winoooops/libghostty-spm-shaders)。Linux 不需要。着色器为 MIT 协议，作者 Sahaj Bhatt（[`sahaj-b/ghostty-cursor-shaders`](https://github.com/sahaj-b/ghostty-cursor-shaders)）。</i></sub>

## Linux

上述功能在 Linux 上同样可用，唯一的区别是终端使用 xterm.js 而非 libghostty（Linux 版本目前暂不支持 libghostty 内核渲染）。打包为 AppImage 后 `chmod +x` 即可运行。

<div align="center">
  <img src="docs/media/linux-workspace.png" alt="Vimeflow 在 Linux 上运行完整工作区，终端窗格由 xterm.js 承载" width="900" />
</div>

## 当前支持范围

Vimeflow 支持**从源码构建 0.1.0 版本**。Nightly 工作流已配置为从默认分支最新的成功提交构建未签名安装包。

- 支持的版本线：`0.1.0`
- 支持的打包目标：Linux x64 AppImage 和 macOS arm64 DMG，可在本地或 nightly CI 中构建
- 桌面运行时：Electron 42 + Rust sidecar，通过 LSP 帧格式的 JSON IPC 通信
- 终端运行时：macOS arm64 打包版本内嵌基于 `libghostty-spm` 的原生 Ghostty；Linux 与开发回退路径使用 xterm.js
- 代理可观测性：Claude Code、Codex CLI、Kimi Code 和 OpenCode
- Nightly 发布目标：滚动更新的 [`nightly` 预发布版](https://github.com/winoooops/vimeflow/releases/tag/nightly)，仅在两个平台和发布检查全部通过后发布
- 暂不支持：稳定版二进制发布、Windows 打包、生产签名/公证、自动更新

打包与主机平台绑定：Linux x64 AppImage 需要在 Linux x64 主机上构建，macOS arm64 DMG 需要在 Apple Silicon Mac 上构建。

## 安装 Nightly 版本

请从滚动更新的 [`nightly` 发布页](https://github.com/winoooops/vimeflow/releases/tag/nightly)
下载对应平台的安装包和 `SHA256SUMS`。Nightly 是实验性快照：尚未签名或公证、
不会自动更新，并会在下一次 nightly 成功后被替换。发布说明会列出准确的源码提交和工作流运行记录。

打开安装包前请先验证下载文件。SHA-256 可检测下载损坏或文件被修改；GitHub
attestation 还可验证文件确实由本仓库的 nightly 工作流构建：

```bash
# macOS（在下载目录中运行）
grep '\.dmg$' SHA256SUMS | shasum -a 256 -c -
gh attestation verify ./vimeflow-*.dmg \
  -R winoooops/vimeflow \
  --signer-workflow winoooops/vimeflow/.github/workflows/nightly-release.yml \
  --source-ref refs/heads/main

# Linux（在下载目录中运行）
grep '\.AppImage$' SHA256SUMS | sha256sum -c -
gh attestation verify ./vimeflow-*.AppImage \
  -R winoooops/vimeflow \
  --signer-workflow winoooops/vimeflow/.github/workflows/nightly-release.yml \
  --source-ref refs/heads/main
```

验证 attestation 需要安装 [GitHub CLI](https://cli.github.com/)。任一检查失败时，
请勿运行安装包。

### 在 macOS 上安装

打开 DMG，将 Vimeflow 拖入 **Applications（应用程序）**。由于应用尚未使用
Apple 证书签名或公证，首次启动时请在 Applications 中按住 Control 点击
**Vimeflow**，选择**打开**，然后再次确认**打开**。如果 Gatekeeper 仍阻止这个
已经验证过的副本，请只移除该应用的隔离属性，然后重新打开：

```bash
xattr -dr com.apple.quarantine /Applications/Vimeflow.app
```

### 在 Linux 上安装

为 AppImage 添加执行权限，然后运行：

```bash
chmod +x ./vimeflow-*.AppImage
./vimeflow-*.AppImage
```

如果系统缺少 `libfuse2`，请使用 `--appimage-extract-and-run`。仅当 Chromium
报告主机 sandbox 无法启动时才使用 `--no-sandbox`；该回退方式会禁用 Chromium
进程 sandbox。

## 从源码构建和运行

前置条件：

- Node.js >= 22；推荐使用 `.nvmrc` 中的 Node 24，与 CI 保持一致
- `nvm` 不是必需，但推荐用它来读取 `.nvmrc`；如果已经通过其他工具启用了 Node 24，可以跳过 `nvm use`
- Rust stable 工具链
- Git
- Linux x64 或 Apple Silicon macOS（对应受支持的打包目标）

```bash
git clone https://github.com/winoooops/vimeflow.git
cd vimeflow
nvm use # 可选：切换到 .nvmrc 中的 Node 24
npm ci
```

如果希望开发实例与已安装的 Vimeflow 完全隔离（独立的会话、设置和代理状态），可以把下面任意命令指向一个临时数据目录：

```bash
VIMEFLOW_USER_DATA_DIR=/tmp/vimeflow-demo npm run electron:dev
```

### macOS

使用**原生 Ghostty 运行时**启动（与打包版本相同的终端实现）：

```bash
npm run electron:dev:ghostty
```

或者使用 **xterm.js** 路径 —— 同一个应用，只是不带原生 Ghostty：

```bash
npm run electron:dev
```

构建 arm64 DMG：

```bash
npm run electron:build            # 或：npm run electron:build:mac:arm64
```

DMG 会输出到 `release/vimeflow-*-arm64.dmg`。它会打包原生 Ghostty parent runtime，尚未签名或公证。

### Linux

从源码运行 —— Linux 上终端使用 **xterm.js**（原生 Ghostty 目前仅限 macOS）：

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

然后运行：

```bash
chmod +x release/vimeflow-*.AppImage
./release/vimeflow-*.AppImage
```

如果主机缺少 `libfuse2`，使用 AppImage 的 extract-and-run 回退方式：

```bash
./release/vimeflow-*.AppImage --appimage-extract-and-run
```

仅当 Chromium 报告主机 sandbox 无法启动时才添加 `--no-sandbox`。

## 使用 Vimeflow

1. 用 `npm run electron:dev` 或本地构建的安装包启动 Vimeflow。
2. 点击 **+** 在你的项目中创建会话，可以选择随会话直接启动 `claude`、`codex`、`kimi` 或 `opencode`。
3. 拆分窗格、浏览文件、编辑代码、逐 hunk 审查 Git 变更，详见上方功能介绍。
4. 检测到受支持的代理后，代理状态面板会自动出现。

## Lifeline 与 Harness Engineering

这个仓库本身也是一次 harness engineering 的实践。Vimeflow 的开发流程使用 [Lifeline Claude Code 扩展](https://github.com/winoooops/lifeline)，覆盖规划、自主实现循环、代码审查、PR 提交、上游 review 处理和 PR 批准。

项目本地的安装说明见 [CLAUDE.md](./CLAUDE.md#lifeline-plugin-setup)。

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
- 架构与 Electron sidecar IPC：[ARCHITECT.md](./ARCHITECT.md)
- 设计系统：[DESIGN.md](./DESIGN.md) 和 [docs/design/UNIFIED.md](./docs/design/UNIFIED.md)
- 当前路线图状态：[docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml)
- 更新日志：[CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md) / [CHANGELOG.md](./CHANGELOG.md)
- 后端 crate 说明：[crates/backend/README.md](./crates/backend/README.md)

## 许可证

MIT
