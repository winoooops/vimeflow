# opencode 状态持久化流：深度研究技术说明

生成日期：2026-06-20。本说明是 `opencode-adapter-technical-note.zh.md` 的配套研究结论，专门回答一个问题：能否把 opencode 的 SQLite 内部状态变成一个 **可持久化、可重放** 的扁平文件流，从而复用 Kimi / Codex 适配器既有的“文件监听”技术。结论基于一次多源、对抗式验证的 deep-research（5 角度 / 22 来源 / 108 条声明 → 25 条验证）。

- **研究规模:** 5 角度 · 22 来源 · 108 声明 → 25 验证（19 确认 / 6 否决）

- **核查版本:** opencode 1.17.8 · 本机 SQLite 3.43.2

- **推荐方案（两个平面）:** 观测：opencode 本地插件 → JSONL（已实测）；交互： `serve` HTTP API；历史回填： `rusqlite` 只读

## 结论摘要

**opencode 1.17.8 没有任何原生配置、环境变量、命令或开关** 能把会话事件 **持续** 持久化到一个扁平文件。用户首选的“找个 opencode 配置”这条路在当前版本不存在。

但也 **不需要** 写 SQL 解析器或引入 CDC 工具。本次已 **实测验证** （装一个临时插件、跑一次真实 opencode 会话、抓到 189 条事件）：opencode 的 **插件钩子系统** 能以干净的语义事件覆盖侧边栏 / 状态卡 / 工具活动所需的一切，且插件可用 Bun 的 `$` 把事件 append 成 JSONL——这是最贴合“原生 + 持久化”的 **实时观测主路径** （详见 [第七节](#plugin) ）。opencode 自己的 `event` 表（仅追加、单调有序）作为 **历史回填 / 零侵入回退** ；而 **交互** （发 prompt、批准权限、中断）走 `opencode serve` 的 HTTP API。三者构成两个平面： **观测（读）** 与 **交互（写）** 。

## 架构总览：观测面（读） vs 交互面（写）

实测后最重要的结论：opencode 适配应拆成 **两个平面** ，二者用 **不同机制** ，权限要求也不同。

- **观测面（只读）** ——侧边栏、状态卡、工具活动。数据来自事件： **优先插件钩子** （实时、语义干净、可 append JSONL），DB 的 `event` 表用于历史回填。 **不需要任何 opencode 权限** ，也不写回。

- **交互面（写）** ——发 prompt、运行 slash 命令、中断、批准 / 拒绝工具权限。只能走 `opencode serve` 的 **HTTP API** ；DB 与插件钩子都 **不能** 写回。 **这是唯一触及 opencode 权限系统的平面。**

| UI 表面          | 读（观测）：插件事件 / 表                                                                                               | 写（交互）：server API                                                                               | 权限维度                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent 状态侧边栏 | `session.created/updated/idle/status/error/diff` 、 `todo.updated`                                                      | —（只读）                                                                                            | 无需 opencode 权限；仅守住“别读密钥表”红线                                                                                                               |
| Agent 状态卡     | `session.*` 的 `info` （model / version / agent / cost / tokens\_\* / title / directory）； `step-finish` part 单步用量 | —                                                                                                    | 同上                                                                                                                                                     |
| 工具活动流       | `tool.execute.before/after` （带 exit / output）、 `message.part.updated` （tool 状态）                                 | —                                                                                                    | 展示 opencode 的权限判定结果                                                                                                                             |
| 终端交互 / 审批  | `permission.updated` （待批）、 `permission.replied` （已批）； `message.part.delta` （流式文本）                       | `POST /session/:id/message` · `/prompt_async` · `/command` · `/abort` · `/permissions/:permissionID` | **权限平面** ：opencode 配置 allow/ask/deny（按工具名 + glob）；批准经 `permissions` 端点（ `{response, remember?}` ），“记住”落到项目级 `permission` 表 |

一句话记住：**侧边栏与状态卡是纯读、零权限**；只有**终端交互 + 审批**触及 opencode 权限系统。结构化交互（程序化发 prompt、批准某条权限、中断）走 **server API**；原始键入仍走既有 PTY；两者都**不是**写 DB。

## 一、为什么“原生持久化文件”这条路走不通

所有原生入口都对照官方文档与本机 v1.17.8 二进制逐一核查（高置信度）：

| 原生手段                                      | 核查结论                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export [id] --sanitize`                      | 一次性 JSON 快照，不是持续追加。                                                                                                                                                                        |
| `serve` → `/event` 、 `/global/event` （SSE） | 仅实时 ：无重放、无 `Last-Event-ID` 、不落盘。源码 `server/routes/.../event.ts` 把无界队列直接实时推流，SSE `id` 字段为 `undefined` ；提出环形缓冲 + 重放的 PR #25658 已于 **2026-06-04 关闭未合并** 。 |
| `run --format json`                           | 仅 stdout 、仅非交互 `run` 模式（不覆盖 TUI 会话），且有丢失末尾 `step_finish` 事件的已知 bug（issue 26855）。                                                                                          |
| 环境变量 / `opencode.json` 配置键             | 无 任何键可开启“持久化事件日志”。                                                                                                                                                                       |

可信度提示：来自 DeepWiki 的若干架构细节（`Effect.PubSub`、`GlobalBus`、`server.connected`）在对抗式验证中被 **3:0 否决**（与上游 TypeScript 源码不符）。该二级 wiki 不可作为 opencode 内部实现的依据，本说明的结论均改以一级源码 + 本机复现为准。

## 二、真正的真相源： `event` 表

opencode 的持久化事件日志就在它自己的 SQLite 里，且 **现在就能只读打开** （高置信度，源码 + 本机复现）：

- `event(id, aggregate_id, seq, type, data)` + `event_sequence(aggregate_id, seq, owner_id)` ：按 `aggregate_id` （即会话 id）分区、 `seq` 单调递增的仅追加日志。

- 写入用 `db.transaction` 的 `immediate` 行为，projector 与 insert 在同一事务内； `seq = 上一条 + 1` ，遇到空洞直接抛 `InvalidSyncEventError（Sequence mismatch）` ——即 **序号稠密、无空洞** 。

- 本机复现：只读打开成功，事件直方图 `message.part.updated.1=317 / message.updated.1=106 / session.updated.1=29 / session.created.1=1` ； `event_sequence` 顶行为 `ses_11c75e7adffe…` ， `seq=452` ，可按 `seq` 降序读取（452, 451, 450…）。

安全红线：同一个 db 文件里还有 `account`、`account_state`、`control_account`、`credential`、`session_share` 等敏感表（本机已确认存在）。只读查询**必须白名单限定到 `event` / `event_sequence`**，绝不触碰这些表。注意 `--sanitize` 只作用于 export 路径，**对直接读 DB 无效**，任何脱敏都是适配器自己的责任。

## 三、WAL 下的只读轮询是安全的

以下均为 SQLite 一级文档，对抗式验证 3:0 确认：

- 读者与写者互不阻塞——opencode 持续写入时 Vimeflow 可同时轮询。

- 每个读事务看到的是事务开始时刻固定的一致性快照，因此 `SELECT … WHERE seq > ?` 返回的是一段连贯、完整的批次。

- 只读打开 WAL 需要 SQLite ≥ 3.22.0、且 `-wal` / `-shm` 旁文件存在或可创建——本机 3.43.2、旁文件齐全，均满足。

低影响注意点：`FULL/RESTART/TRUNCATE` checkpoint 与崩溃恢复会短暂加排他锁；长读事务可能饿死 checkpointer 并撑大 WAL。缓解办法只有一条——**每次轮询的读事务尽量短**（打开 → SELECT 一批 → 关闭）。

## 四、现成 CDC / 复制工具为何全部不适用

逐一验证（多数 3:0），结论是没有一个能产出可被 watcher 解析的持久 JSONL：

| 工具                                  | 不适用原因                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Litestream                            | 把不透明的 **二进制 WAL 页** 复制到对象存储 / SFTP / 本地路径，是备份工具， **不产生 JSONL** ； `-json` 仅一次性状态输出。                    |
| cr-sqlite                             | 多主 CRDT，需要 `crsql_as_crr` 把源表改成 CRR（ **修改 schema** ），只读第三方库无法做到；变更只经 `crsql_changes` 虚表暴露，仍需自己序列化。 |
| sqlite-cdc                            | **安装触发器** 写入内部 `__cdc_log` 表——即向 opencode.db 写入，对只读消费者是 **致命缺陷** ；且无内建持久化 / 重试 / JSONL。                  |
| `sqlite3_update_hook` / rusqlite hook | 按 **连接** 注册，只对同一连接的写入触发， **无法观察其它进程（opencode）的写入** ——所以跨进程捕获只能用轮询。                                |
| sqlite-change-stream                  | Rust crate，但只输出到 **stdout** 、无持久化 / 重放，且仍需挂一个连接。                                                                       |

## 五、历史回填 / 回退路径：适配器内只读轮询 → JSONL 镜像

定位调整：实测后，**实时观测的主路径是插件（第七节）**。本节的 SQLite 只读轮询降级为两种用途：（1）**历史回填**——插件只能捕获“安装之后”的事件，已存在会话的历史仍需一次性从 `event` 表读出；（2）**零侵入回退**——不希望在 opencode 端装插件时仍可用。两条路产出相同的 JSONL，可平滑切换。

零新增依赖（ `rusqlite 0.32 (bundled)` 已在 `crates/backend/Cargo.toml:36` ）。三步：

1. 以只读模式打开： `OpenFlags::SQLITE_OPEN_READ_ONLY` （file URI `mode=ro` ）， `PRAGMA busy_timeout = 5000` 与 opencode 对齐。

2. 每 ~500ms 在一个 **短** 读事务里取增量： **只查 `event` / `event_sequence`** ，绝不碰敏感表。

   ```
   SELECT id, aggregate_id, seq, type, data
   FROM event
   WHERE seq > ?cursor
   ORDER BY seq ASC;
   ```

3. 把每行作为一条紧凑 JSON 追加到 Vimeflow 自有的 `.jsonl` 镜像文件，并把内存游标推进到本批最大 `seq` 。

相对既有《适配器技术说明》的关键改进：那份说明指出阻塞点是 watcher 假设 `status_path` 是 UTF-8 文本、会 `read_to_string`，并建议给 base runtime 加一层 “DB-aware 状态源抽象”。**用镜像方案则完全不用改 watcher**：`status_path` 指向 JSONL 镜像即可——因为镜像本身就是 UTF-8 JSONL，既有 `TranscriptTailService`（`transcript_tail_service.rs`，500ms 轮询、字节偏移游标、先重放后实时）像 tail 一个 Codex transcript 一样 tail 它。所有 opencode 专属逻辑都收敛在适配器内。

为什么轮询而不是事件钩子：rusqlite 的 update hook 只在自己连接上触发，看不到 opencode 进程的写入（见上表），所以 **跨进程捕获的正确机制就是轮询** 。 独立 sidecar 是可接受的备选，但要多担进程生命周期与 IPC 成本，而稳健性并无提升（两者都得轮询）——故首选 **适配器内** 实现。

## 六、重启重放的正确性（几乎免费）

opencode 在写入侧就强制 `seq = 上一条 + 1` 并拒绝空洞，所以每个 `aggregate_id` 的序号 **稠密且严格递增** ，这正是稳健游标的前提：

- **无空洞：** 缺一个 `seq` 就意味着写入侧已拒绝它，因此连贯的镜像 = 完整历史。

- **重启不重复：** 冷启动时读镜像尾部恢复各 `aggregate_id` 的最大 `seq` ，之后只取 `seq > 该值` ，已镜像的事件不会被重复追加。

- **游标无需单独存储：** JSONL 镜像 **本身既是重放日志、也是持久化游标** 。既有引擎在 attach 时就会从文件头重放全部事件（ `transcript_state.rs:~384` ），先恢复上次会话状态，再转入实时 tail。

崩溃原子性：整行写入，靠基于 `seq` 的去重在下次启动时丢弃任何半截尾行——而引擎本就容忍截断 / 半写的行。

<a id="plugin"></a>

## 七、插件钩子方案（已实测验证，推荐作为实时观测主路径）

验证方式：在 `~/.config/opencode/plugins/` 放一个临时探针插件，跑一次真实 `opencode run`（big-pickle 模型 + 一个 bash 工具调用），抓到 **189 条事件**，覆盖会话 / 消息 / 工具 / 状态全生命周期。下述形状均为实测所得（权限事件形状取自 SDK 类型，见末尾）。探针已清理。

### 插件 API 与注册

- 签名： `(input, options?) => Promise<Hooks>` 。 `input` 实测含 `client` （SDK 客户端）、 `serverUrl` （实测 `http://localhost:4096/` —— **run 模式也会起本地 server** ）、 `$` （Bun shell，可直接写文件）、 `project` / `directory` / `worktree` 。 **插件本身即可经 `client` 调 HTTP API** ，故观测与交互可同源。

- 注册：放 `~/.config/opencode/plugins/*.ts` （全局）或 `.opencode/plugins/` （项目），或 `opencode.json` 的 `plugin` 键。 **本地目录形态无需发 npm** 。

### 关键 Hooks（实测）

| Hook                  | 形状 / 用途                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `event`               | 万能总线订阅 `{ event:{ id, type, properties } }` ，收 **全部** 事件类型。观测主力。                                                          |
| `tool.execute.before` | 入 `{ tool, sessionID, callID }` ，出 `{ args }` 。工具开始 + 参数。                                                                          |
| `tool.execute.after`  | 入 `{ tool, sessionID, callID, args }` ，出 `{ title, output, metadata:{ exit, truncated, output } }` 。 **带退出码，正好喂测试运行解析器。** |
| `permission.ask`      | 入 `Permission` ，出 `{ status:"ask"\|"deny"\|"allow" }` —— **决策钩子** ，插件可自动放行 / 拒绝。                                            |

### 实测事件直方图（节选，189 条）

```
message.part.delta      52   ← 流式 token（高频噪声，仅用于“正在输入”指示）
catalog.updated         46   ← 启动期模型目录刷新（噪声，忽略）
plugin.added            43   ← 启动期插件注册（噪声，忽略）
message.part.updated    16   ← 消息片段（text / tool / reasoning / step-*）
message.updated          9   ← 消息元数据（role / model）
session.status           6   ← busy | idle | retry   ← 状态卡“忙 / 闲”指示
session.updated          3   ← 会话信息刷新（token / cost 总量）
session.diff 2 · session.created 1 · session.idle 1 · tool.execute.before/after 各 1
```

必须过滤：`message.part.delta` / `catalog.updated` / `plugin.added` 占了绝大多数音量。适配器要**白名单订阅约 10 个相关类型**，而不是把每条都落盘。事件目录比静态类型表更广也更吵（实测还见到 `session.next.agent.switched`、`session.next.model.switched`、`integration.updated`、`reference.updated` 等）。

### 关键 payload 样本（实测，已截断）

```
// session.created —— 一条事件即可填满状态卡
properties.info = {
  id, slug, version:"1.17.8", projectID, directory, path, title,
  agent, model:{ id:"big-pickle", providerID:"opencode", variant:"default" },
  cost:0, tokens:{ input, output, reasoning, cache:{ read, write } },
  permission:[ { permission:"question", pattern:"*", action:"deny" }, … ],  // 会话权限策略内联于此
  time:{ created, updated } }

// session.status —— 忙 / 闲 / 重试
properties = { sessionID, status:{ type:"busy" } }   // 或 {type:"idle"} / {type:"retry", attempt, message, next}

// tool.execute.after —— 带退出码，喂 test-runner
hookOutput = { title, output:"vimeflow-probe-ok\n",
  metadata:{ output:"…", exit:0, truncated:false } }

// message.part.updated —— 片段
properties.part = { type:"text"|"tool"|"reasoning"|"step-start"|"step-finish"|"patch", … }
```

### 权限事件形状（取自 SDK 类型）

```
Permission = { id, type, pattern?, sessionID, messageID, callID?, title, metadata, time:{created} }
event "permission.updated".properties = Permission                      // 一个工具正在请求权限
event "permission.replied".properties = { sessionID, permissionID, response }
```

本次因 `--dangerously-skip-permissions` 自动放行，未触发 permission 事件，故形状取自 SDK 类型；下一步会用一个 `ask` 工具实测一遍。注意：会话权限 **策略** 已内联在 `session.created/updated` 的 `info.permission` 里（实测可见默认 deny），而 **实时请求** 走 `permission.updated` 事件——两者都可观测。

### 探针插件（throwaway，已删除）

```
// ~/.config/opencode/plugins/vimeflow-probe.ts —— 用完即删
import { appendFileSync } from "node:fs"
export const VimeflowProbe = async (input) => ({
  event: async ({ event }) => append({ type: event?.type, event }),
  "tool.execute.before": async (i, o) => append({ hook:"before", i, o }),
  "tool.execute.after":  async (i, o) => append({ hook:"after",  i, o }),
  "permission.ask":      async (i, o) => append({ hook:"ask",    i, o }),
})
```

结论：插件 = 最贴合“原生 + 持久化”的实时观测源，形状干净、带退出码、不碰密钥表、不耦合 DB schema。**唯一短板**是它只捕获“安装之后”的事件——已存在会话的历史靠**第五节**的 DB 一次性回填。二者产出同一份 JSONL，互补。

## 八、硬约束与未决问题

- **安全：** 查询白名单仅 `event` / `event_sequence` ；镜像前 **抽样真实 `data` 列** ，确认未内嵌 token / 凭据再原样落盘。

- **schema 漂移：** `event` 表是未文档化的内部实现，无稳定性保证；opencode 存储已漂移过一次（JSON 目录 → SQLite）。每次升级都要重新核对 schema 与 `opencode db path` 。 JSONL 间接层把影响面限制在轮询器一个模块。

- **保留策略未知：** opencode 对 `event` 表的裁剪 / vacuum 策略尚不明确；若它会截断旧事件，则“历史完整回溯到会话起点”的假设会被打破，需确认。

- **多会话：** Kimi / Codex 每会话 tail 一个 transcript，而 opencode 把所有内容按 `aggregate_id` 放在同一张表。需决定：每个 `aggregate_id` 一个镜像文件，还是合并成一条流。

- **WAL 边界：** 若 opencode 完全停止并 checkpoint 后删除了 `-wal` ，只读打开可能因无写权限而无法创建 `-shm` ——本机实测 opencode 会保留旁文件，但适配器仍应对瞬时打开失败做重试。

## 九、建议下一步

1. **✅ 已完成 · 探针验证：** 临时插件已跑通，抓到 189 条事件，确认插件钩子 **足以** 充当实时观测真相源（见第七节）。探针已清理。

2. **补测权限事件：** 去掉 `--dangerously-skip-permissions` 、配一个 `ask` 工具，实测 `permission.updated` / `permission.replied` 的真实 payload，并打通 `POST /session/:id/permissions/:permissionID` 的批准回写。

3. **决定文件分片：** 每个 `aggregate_id` （会话）一个 JSONL，还是合并流由适配器按 `sessionID` 解复用——Kimi / Codex 是每会话一文件。

4. **起实现规格：** 用 `/lifeline:planner` 起草“插件观测（主） + DB 回填 + server API 交互”三件套适配器规格，复用既有五接口模型与 `TranscriptTailService` 。

**主要引用（一级 / 已验证）**

- opencode CLI / Server 文档： [opencode.ai/docs/cli](https://opencode.ai/docs/cli/) · [/server](https://opencode.ai/docs/server/) · [/plugins](https://opencode.ai/docs/plugins/)

- 上游源码： `packages/opencode/src/server/routes/.../event.ts` 、 `packages/core/src/event.ts` 与 `event/sql.ts` （github.com/anomalyco/opencode，亦即 sst/opencode）；环形缓冲重放提案 PR #25658（已关闭）。

- SQLite 一级文档： [wal.html](https://sqlite.org/wal.html) · [isolation.html](https://sqlite.org/isolation.html) · [update_hook](https://sqlite.org/c3ref/update_hook.html) · [3.22.0 releaselog](https://sqlite.org/releaselog/3_22_0.html)

- CDC / 复制工具： [litestream.io/how-it-works](https://litestream.io/how-it-works/) · [vlcn-io/cr-sqlite](https://github.com/vlcn-io/cr-sqlite) · [kevinconway/sqlite-cdc](https://github.com/kevinconway/sqlite-cdc) · [sqlite-change-stream](https://lib.rs/crates/sqlite-change-stream)

- 本机交叉验证：opencode 1.17.8、SQLite 3.43.2、 `~/.local/share/opencode/opencode.db` 只读查询；插件钩子经临时探针实测（189 条事件），类型取自本机 `@opencode-ai/plugin` / `@opencode-ai/sdk` 1.17.8 的 `.d.ts` 。

置信度：SQLite WAL / 隔离性与 opencode CLI/serve 事实为高置信度（一级文档 + 活体二进制 + 本机复现）； `event` 表 schema 经源码 3:0 确认并本机复现。所有 opencode 事实锚定在 v1.17.8，升级后须复核。
