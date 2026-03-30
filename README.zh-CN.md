# Vimeflow

<div align="center">

[English](./README.md) | 简体中文

</div>

> 一个关于**工程化 AI 原生开发**的实验 — 自主代理循环从规格说明到实现，全程由分层规则和专业代理管控，构建整个应用程序。

Vimeflow 是一个编码代理对话管理器，采用 Tauri 桌面应用（Rust + React/TypeScript）构建。但产品本身是次要的，真正的重点在于过程：这个仓库是一个试验场，探索当自主开发引擎拥有结构化规格说明、安全防护栏和渐进式文档时，能走多远。

## 为什么说这是 AI 原生

传统项目由人类编写代码，AI 辅助。Vimeflow 反转了这一模式：

1. **人类编写规格说明** — 产品需求、设计系统、开发规则
2. **自主引擎构建功能** — 双代理循环（初始化器 + 编码器）将规格分解为功能列表并逐步实现
3. **专业代理审查工作** — 10 个 AI 代理分别负责规划、TDD、代码审查、安全和文档
4. **规则管控一切** — 分层规则系统（通用层 + 语言特定层）确保一致性，无需人工逐次提交干预

本仓库中的 CI/CD 基础设施、Linter 配置和 Git 钩子，全部由引擎根据 `app_spec.md` 规格说明自动构建。

## 仓库结构

```
CLAUDE.md           <- AI 导航中心（代理从这里开始）
README.md           <- 你在这里（给人类阅读）
DEVELOPMENT.md      <- 命令、技术栈、代码风格
ARCHITECT.md        <- 架构决策、Tauri 模式
DESIGN.md           <- UI 设计系统（Obsidian Lens / Catppuccin Mocha）

agents/             <- 10 个专业 AI 代理定义
rules/              <- 分层开发标准（通用 + TypeScript + Rust）
harness/            <- 自主开发循环（Claude Code SDK，Python）
docs/design/        <- 屏幕原型、Stitch HTML/CSS、设计规格
```

## 自主引擎

Harness Enginnering（`harness/`）是本实验的核心。它是基于 Claude Code SDK 构建的 Python 循环：

- **初始化代理**读取 `app_spec.md`，将其分解为分阶段的 `feature_list.json`
- **编码代理**选取下一个待完成功能，实现它，标记完成，并自动继续
- **安全层**包括 Bash 命令白名单、沙盒执行和功能列表写保护

```bash
cd harness && pip install -r requirements.txt
python autonomous_agent_demo.py                    # 无限迭代, 手动终止
python autonomous_agent_demo.py --max-iterations 5 # 限制次数
```

详见 `harness/CLAUDE.md`。

## 当前状态

**阶段：基础 / 预实现**

- 开发规则、代理规格和 CI/CD 工具链已建立
- 设计系统（5 个屏幕）已通过 Google Stitch 指定
- 应用代码（Tauri 脚手架、`src/`、`src-tauri/`）尚未创建
- 下一步：引擎根据设计规格构建应用

## 技术栈

Tauri 2（Rust 后端 + Web 前端）| React 19 + TypeScript | Vitest + Playwright | ESLint + Prettier | Husky + commitlint | GitHub Actions CI/CD
