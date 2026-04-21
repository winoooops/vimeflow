# Harness — 概览与索引

[🇺🇸 English](./CLAUDE.md) | 🇨🇳 简体中文

一份简洁的双语索引页，帮助人类开发者和 AI 代理快速找到对应任务的权威文档。运行手册在 [`harness/CLAUDE.md`](../../harness/CLAUDE.md)；本文只是索引，不复制被链接文档中的内容。

## Harness 是什么

`harness/` 是本项目的自主开发循环。一个 Python 协调器启动 Claude Code 会话，按三阶段流程驱动（初始化器 → 编码器 + 审查器 → 云端中继），并将产生的提交推送到功能分支。本项目的 CI/CD、设计系统和布局外壳都是这套循环搭出来的。

**默认后端**：按角色启动 `claude -p` 子进程。Harness 直接继承本地 `claude` CLI 的登录态 —— **默认路径不需要 `ANTHROPIC_API_KEY`**。

**备用后端**：通过 `--client sdk` 使用 `claude_code_sdk` Python 包。需要 `ANTHROPIC_API_KEY`。仅在 CLI 不可用时使用。

## 快速开始

```bash
# 一次性安装 Claude Code CLI 并登录
npm install -g @anthropic-ai/claude-code
claude /login

# 创建 worktree（强制要求 —— harness 永远不在 main 上运行）
git worktree add .claude/worktrees/feat-<name> -b feat/<name>
cd .claude/worktrees/feat-<name>
npm install

# 先跑一次单迭代 dry-run
cd harness && python3 autonomous_agent_demo.py --max-iterations 1 --skip-review --skip-relay
```

## 按任务查找文档

| 你想做的事                            | 去读                                                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行/配置 harness，理解安全分层       | [`harness/CLAUDE.md`](../../harness/CLAUDE.md) — 权威                                                                                                                                    |
| 安装插件（`/harness-plugin:loop` 等） | [`README.md`](../../README.md#harness-plugin-setup)                                                                                                                                      |
| 理解安全模型的设计动机                | [`docs/reviews/patterns/policy-judge-hygiene.md`](../reviews/patterns/policy-judge-hygiene.md)、[`docs/reviews/patterns/fail-closed-hooks.md`](../reviews/patterns/fail-closed-hooks.md) |
| 查看当前架构的设计规格                | [`docs/superpowers/plans/2026-04-20-harness-claude-cli-subprocess.md`](../superpowers/plans/2026-04-20-harness-claude-cli-subprocess.md)                                                 |
| 查看变更时间线                        | [`CHANGELOG.zh-CN.md`](../../CHANGELOG.zh-CN.md)                                                                                                                                         |
| 浏览与 harness 有关的 review pattern  | [`docs/reviews/CLAUDE.md`](../reviews/CLAUDE.md)                                                                                                                                         |
| 编辑安全钩子或白名单                  | [`harness/security.py`](../../harness/security.py)、[`harness/hooks.py`](../../harness/hooks.py)、[`harness/policy_judge.py`](../../harness/policy_judge.py)                             |
| 不改代码就扩展本地白名单              | 复制 [`harness/.policy_allow.local.sample`](../../harness/.policy_allow.local.sample) 为 `.policy_allow.local`                                                                           |

## 给编辑 harness 的代理

修改 `harness/` 下任何文件之前，先读相关的 review pattern —— 这些模式凝结了 PR #73 上 12 轮云端代码评审的教训：

| 你在改…                               | 先读                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `policy_judge.py`、`security.py`      | [`policy-judge-hygiene.md`](../reviews/patterns/policy-judge-hygiene.md)   |
| `hook_runner.py` 或任何 PreToolUse 桥 | [`fail-closed-hooks.md`](../reviews/patterns/fail-closed-hooks.md)         |
| `cli_client.py`、子进程 I/O           | [`async-race-conditions.md`](../reviews/patterns/async-race-conditions.md) |
| `client.py` 钩子命令拼装              | [`command-injection.md`](../reviews/patterns/command-injection.md)         |
| `autonomous_agent_demo.py` 启动期检查 | [`preflight-checks.md`](../reviews/patterns/preflight-checks.md)           |

每完成一轮 review-fix 循环，如有新的教训，请将其追加到对应的模式文件（或新建一个），并按 [`docs/reviews/CLAUDE.md`](../reviews/CLAUDE.md) 的约定递增其 `ref_count`。

## 目录结构（截至 PR #73）

```
harness/
├── autonomous_agent_demo.py    # CLI 入口 — argparse、asyncio、阶段编排
├── agent.py                    # 核心循环 — 编码器 + 审查器迭代、云端中继
├── cli_client.py               # 默认后端：claude -p 子进程 + stream-JSON 解析
├── client.py                   # 共享设置帮助器 + CLI 工厂（create_client）
├── sdk_client.py               # 可选 SDK 备用后端（create_client 对等实现）
├── hook_runner.py              # 桥：CLI settings.json 钩子 → Python 安全层
├── security.py                 # Bash 白名单 + pkill/chmod/rm/gh 校验器
├── hooks.py                    # feature_list.json 完整性保护
├── policy_judge.py             # 默认拒绝的 LLM 备用裁决（ask/explain 可选）
├── review.py                   # 本地 + 云端 Codex 评审集成
├── prompts.py、progress.py     # prompt 装载 + feature-list 进度渲染
├── prompts/                    # 代理系统 prompt（initializer/coding/reviewer）
├── fixtures/                   # 捕获的 stream-JSON（解析器测试用）
├── scripts/dry_run_smoke.py    # 在一次性 git 仓库里跑的端到端冒烟测试
└── test_*.py                   # 77 个 pytest 用例覆盖解析、钩子、策略裁决等
```
