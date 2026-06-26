# opencode 适配器技术说明

生成日期：2026-06-20。基于本机运行中的 `/Users/winoooops/projects/rustgo` opencode 会话，以及当前 Vimeflow 后端适配器架构。

- **本机 opencode 版本:** 1.17.8

- **本机会话数据库:** `~/.local/share/opencode/opencode.db`

- **rustgo 会话 ID:** `ses_11c75e7adffeWYBkANUK1LMZ2P`

## 结论摘要

opencode 1.17.8 的实时状态和历史记录不再是项目目录里的 JSON 文件，而是 一个用户级 SQLite 数据库。适配器实现路线应更接近 Codex/Kimi：先定位 provider home 和 agent session，再从数据库折叠状态，并按事件序号 tail 活动流。

关键实现阻塞点是 Vimeflow 当前 watcher 的假设： `status_path` 是 UTF-8 文本文件，运行时会对它调用 `read_to_string` 。opencode 的事实来源是 SQLite，直接把 `opencode.db` 作为 `status_path` 会失败。因此需要先给 base runtime 增加一个 provider-neutral 的状态源读取抽象，或者让 opencode 适配器维护一个派生的 status mirror。前者更干净。

## 本机验证

运行中的进程信息：

```
PID: 23210
PPID: 73581
Started: 2026-06-19 22:38:45 -0700
Command: opencode
CWD: /Users/winoooops/projects/rustgo
Binary: /Users/winoooops/.opencode/bin/opencode
Version: 1.17.8
```

`opencode db path` 返回：

```
/Users/winoooops/.local/share/opencode/opencode.db
```

`lsof` 确认运行进程打开了这些关键文件：

```
/Users/winoooops/.local/share/opencode/opencode.db
/Users/winoooops/.local/share/opencode/opencode.db-wal
/Users/winoooops/.local/share/opencode/opencode.db-shm
/Users/winoooops/.local/share/opencode/log/opencode.log
```

rustgo 项目没有发现项目内的 opencode 状态目录；状态集中在用户级 data root。

## SQLite 存储模型

当前版本使用 WAL 模式。上游源码中数据库初始化包含：

```
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA busy_timeout = 5000
PRAGMA cache_size = -64000
PRAGMA foreign_keys = ON
```

### 适配器最需要的表

| 表                  | 用途                                                           |
| ------------------- | -------------------------------------------------------------- |
| `project`           | 把 worktree 路径映射到 opencode project id。                   |
| `project_directory` | 项目目录别名、root、git worktree 等补充映射。                  |
| `session`           | 当前/历史 session；包含 model、version、cost、tokens 总量。    |
| `message`           | 用户/助手消息 metadata，JSON 存在 `data` 列。                  |
| `part`              | 消息片段；包含 tool 状态、step usage、text、reasoning、patch。 |
| `event_sequence`    | 每个 session aggregate 的最新 durable event 序号。             |
| `event`             | 按 `aggregate_id` 和 `seq` 存储的 durable event 流。           |

数据库中也有 `account`、`control_account`、`credential`、`session_share` 等敏感表。适配器查询必须明确限定到 session/message/part/event/project 相关表，不能读取 token、credential 或 share secret。

## rustgo 会话结构

```
project.id: global
project.worktree: /Users/winoooops/projects/rustgo
session.id: ses_11c75e7adffeWYBkANUK1LMZ2P
session.version: 1.17.8
session.agent: build
session.model.providerID: opencode
session.model.id: big-pickle
tokens_input: 51590
tokens_output: 5612
tokens_reasoning: 4163
tokens_cache_read: 623872
tokens_cache_write: 0
event_sequence.seq: 452
```

进程启动时间是 `2026-06-19 22:38:45 -0700` ，session row 创建时间是 `2026-06-19 22:38:58 -0700` 。locator 需要允许进程已检测到但 session row 尚未落盘的短暂窗口，并使用 retry/backoff。

### 消息和 part 计数

```
message.role:
assistant|26
user|1

part.type:
patch|9
reasoning|24
step-finish|26
step-start|26
text|5
tool|54
```

### 工具调用类型

```
bash|completed|6
edit|completed|8
glob|completed|7
read|completed|29
todowrite|completed|3
write|completed|1
```

## 映射到 Vimeflow 五个适配器接口

### StatusSourceLocator

解析 `~/.local/share/opencode/opencode.db` ，通过 `project.worktree` / `project_directory.directory` 找到项目，再按 `session.project_id` 、 `session.directory` 、 `time_created` 、 `time_updated` 绑定最新未归档 session。

### StateDecoder

从 `session` row 生成 `StatusSnapshot` ： session id、model、version、token 总量、cost。latest `step-finish` part 可作为 current usage。

### TranscriptPathSource

opencode 没有 JSONL transcript path。 `static_hint` 返回 DB path， `dynamic_hint` 返回 `None` 。真正 session id 需要保存在 shared locator state 中。

### TranscriptPathValidator

校验路径必须是 data root 下的主 DB 文件；拒绝 NUL、相对路径、root 外路径，以及 `.db-wal` / `.db-shm` 作为 transcript path。

### TranscriptStreamer

streamer 应 read-only 打开 SQLite，以 resolved opencode session id 为 `aggregate_id` ，按 `event.seq` 增量轮询：

```
SELECT id, seq, type, data
FROM event
WHERE aggregate_id = ?
  AND seq > ?
ORDER BY seq ASC;
```

| opencode 事件                                   | Vimeflow 事件                          |
| ----------------------------------------------- | -------------------------------------- |
| `message.updated.1` 且 `info.role = "user"`     | `AgentTurnEvent`                       |
| `message.part.updated.1` + tool pending/running | tool-call start/running                |
| `message.part.updated.1` + tool completed       | tool-call done                         |
| `message.part.updated.1` + tool error           | tool-call failed                       |
| completed `bash` tool                           | 复用 Claude/Codex 已有 test-run parser |
| assistant message `path.cwd`                    | `AgentCwdEvent`                        |

## 实现清单

1. 在 base watcher 增加 DB-aware status source/read abstraction，保留现有文本文件 读取作为默认实现。

2. Rust 后端添加 `AgentType::OpenCode` ，更新 `AGENT_SPECS` 和 detector 覆盖测试。

3. 新增 `crates/backend/src/agent/adapter/opencode/` ，包含 locator/parser/transcript/types/fixtures。

4. 在 `AgentBindings::for_attach` 里按 Kimi 模式共享 `OpenCodeLocator` 。

5. 用 `rusqlite` read-only 查询 DB；避免 shelling out 到 `opencode stats` 或 `opencode export` 。

6. 生成 TypeScript bindings，并更新 frontend agent unions、registry、icon/theme token 和相关测试。

7. 加 SQL fixture，不复制真实用户 DB；fixture 只包含脱敏后的 project/session/message/part/event 最小集合。

## 风险与未决问题

- **状态源类型不匹配：** 当前 watcher 读取 UTF-8 status file，opencode 是 SQLite。

- **自定义 DB 路径：** 上游支持 `OPENCODE_DB` 。当前 macOS detector 不读取进程环境，v1 可以先支持默认路径。

- **同 cwd 多 session：** 需要用 agent process start time、session creation/update time、archived 状态共同 disambiguate。

- **schema drift：** opencode 迁移频繁，parser 必须容忍缺字段、未知 part/event type、 JSON 类型漂移。

- **rate limit/context window：** 本地 DB 未发现明确 rate limit reset 或 model context window 字段，v1 应输出安全默认值，而不是假造精度。

## 建议路线

先解决 base runtime 的状态源抽象，再实现 opencode adapter。这样 Claude Code、Codex、Kimi 的行为保持不变，opencode 也可以自然复用现有五接口模型。完成后，opencode 的用户体验可以达到 Codex/Kimi 级别：有实时 status、有 tool activity、有 turn count，也能从 bash tool 里提取测试运行结果。
