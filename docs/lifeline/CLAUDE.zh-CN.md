# Lifeline — 插件工作流说明

[English](./CLAUDE.md) | 简体中文

Lifeline 是已经抽离出来的 Claude Code 插件，现在负责 Vimeflow 的自主开发循环、本地 Codex 审查、PR 创建、PR review-fix 循环和 PR 收尾。权威来源：<https://github.com/winoooops/lifeline>。

旧的仓库内 `harness/` 脚本、`plugins/harness/` 插件、`.claude-plugin/` marketplace，以及 `scripts/review*.sh` 辅助脚本已从本仓库移除。不要在这里重新加入它们；共享工作流的改动应进入 Lifeline 仓库。

带日期的 specs、changelog 条目、review patterns 和 retrospectives 可能仍会以历史语境提到 `harness-plugin` 或 `harness/`。当前工作流契约以本页、根目录 `README.md`、根目录 `CLAUDE.md`、`AGENTS.md` 和 `rules/` 为准。

## 安装

```bash
/plugin marketplace add winoooops/lifeline
/plugin install lifeline@lifeline
/reload-plugins
```

如果要开发 Lifeline 本身，可以注册本地 clone：

```bash
/plugin marketplace add /absolute/path/to/lifeline
/plugin install lifeline@lifeline
/reload-plugins
```

## 技能

| 技能                        | 用途                                                                      |
| --------------------------- | ------------------------------------------------------------------------- |
| `/lifeline:planner`         | 头脑风暴并写设计规格，然后对规格运行 Codex 审查。                         |
| `/lifeline:loop`            | 启动自主实现循环。                                                        |
| `/lifeline:review`          | 对 staged diff 运行本地 Codex 审查。                                      |
| `/lifeline:request-pr`      | 从当前分支创建 PR。                                                       |
| `/lifeline:upsource-review` | 获取并修复 Claude Code Review、`chatgpt-codex-connector` 和人工评审意见。 |
| `/lifeline:approve-pr`      | 端到端收尾 PR：squash、删除分支、同步 main，并清理 worktree。             |

## Vimeflow 集成

- `AGENTS.md` 仍是 `/lifeline:review`、`/lifeline:upsource-review` 和 GitHub PR 审查的 Codex 上下文。
- `.github/workflows/claude-review.yml` 与 `.github/codex/codex-output-schema.json` 保留在本仓库，因为 Lifeline 的 upsource 循环会消费它们生成的 `## Claude Code Review` 评论。
- `.lifeline-upsource-review/` 已加入 gitignore，用于每轮临时产物。Lifeline 不再使用旧的 `.harness-github-review/` 目录名。
- `app_spec.md`、`feature_list.json`、`.feature_list_stamp.json` 和 `claude-progress.txt` 仍在 gitignore 中，因为 Lifeline 循环仍可能在项目根目录生成这些运行时文件。
- Lifeline 循环新增的 review 知识库条目应使用 `docs/reviews/CLAUDE.md` 中定义的来源标签。

## 迁移备注

如果开发者本地还保留旧插件产生的 `.harness-github-review/` 产物，请先人工检查其中的 `cycle-*-aborted/` 目录，再决定是否删除。Lifeline 不会自动恢复这些旧产物。

如果安装后看不到 Lifeline 斜杠命令，请重新运行 `/reload-plugins`。自动补全 wrapper 别名的创建方式见仓库根目录 `CLAUDE.md` 的 Lifeline setup 部分。
