# Session Runtime：单一执行内核与三运行角色

状态：**current with explicit residual boundaries**。三角色与 BFF owner、shared `RuntimeTurn`、journal/lease/Sandbox finalizer 已实现；Cloud 已分开 logical Turn/physical attempt，并实施 waiting continuation、attempt-fenced step/effect/lease/Sandbox、immutable resume envelope、generation validation 和安全 model-boundary auto-resume。Desktop restart auto-resume、未知外部 effect reconciliation 与生产隔离环境验收仍未完成。下文分别标记当前事实与残余边界，不以旧 ADR、目录迁移或 mock 测试冒充完成。不保留旧执行服务或旧数据库模型的长期兼容层。

决策键：如何让交互式 Agent loop、消息、Sandbox 与 detached durable Job 具有一个 owner，同时保持执行恢复与高权限计算的进程隔离？

本文按源码重新建模，不把此前 ADR 或当前 PostgreSQL 表形状当成前置约束。事实先看 Codex/Pi/AI SDK 当前实现与本仓库运行代码；下文标为 target 的能力允许绿地替换现有 API、schema 和状态机，标为 current 的能力必须能指向真实实现。

## 决定

`runtime` 是唯一云端 Agent 执行 app。它拥有 Session、messages、Turn/run journal、云端工具/workspace、Sandbox 会话和 durable Job；实际 Turn/context kernel 复用 `@repo/agent-runtime`，与 Desktop host 共用同一个 AI SDK loop adapter。`chat` 是 Web 产品 BFF，只拥有产品 conversation 元数据及 `conversation_id -> runtime_session_id` 映射。

Runtime 使用一个镜像、三个显式 command 入口。结构参照 Canvas 的 `cmd` 装配方式：入口负责选择进程角色和该角色配置，业务模块仍统一位于 Runtime 顶层 `api/application/domain/infrastructure`，不存在嵌套的 worker 子项目，也不通过 `RUNTIME_ROLE` 在运行时分支：

| 角色 | 端口 | 核心职责 | 隔离原因 |
| --- | ---: | --- | --- |
| `runtime-server` | 8015 | Hono API、Session/messages、shared `RuntimeTurn` host、inline tools、stream/continuation | 交互主路径；loop 在 server 进程内，不存在独立 `runtime-agent` |
| `runtime-worker` | 8011 | Nitro + Workflow，执行 detached durable Job、等待、重试和恢复 | 独立扩缩、部署恢复和长任务资源预算 |
| `runtime-sandbox` | 8014 | 创建、限制、查询与回收 Docker/Kubernetes guest | 单独 ServiceAccount/容器权限；不持有业务或 provider 凭据 |

三个角色复用 `runtime` image 和版本，但不共享进程内状态。生产分别部署 Pod/容器；本地分别启动三个命令。Sandbox guest 是 controller 创建的第四类临时 workload，不是 Runtime 服务角色。

配置同样按入口装配：server 使用 `getServerSettings()`，worker 使用 `getWorkerSettings()`，sandbox 使用 `getSandboxSettings()`；server/worker 只共享 PostgreSQL 基础解析。进程配置在启动时校验并缓存，业务层不得反向依赖 `bootstrap/`。不能为了“同一镜像”把三个角色的凭据、端口或启动校验合成一份全局配置。

```mermaid
flowchart LR
  Web[Web Chat] --> Chat[chat BFF]
  Chat --> Server[runtime-server\nHono + RuntimeTurn host]
  Server --> DB[(runtime DB)]
  Server --> Worker[runtime-worker\nNitro + Workflow]
  Worker --> DB
  Worker --> World[(workflow DB)]
  Server --> Sandbox[runtime-sandbox]
  Sandbox --> Guest[isolated guest]
```

## 交互 loop 与 Workflow 边界

每个 Turn 是一个 shared `RuntimeTurn`，内部只创建一个 AI SDK `ToolLoopAgent`，不是 Workflow run。模型 step、普通 Bash、artifact、workspace 保存、搜索、普通工具调用和 Agent 审批都在 `runtime-server` 进程内执行。Session/lease/journal finalizer 由 Runtime host 拥有；input queue、context projection/compaction、tool admission 和 loop adapter 由 shared kernel 拥有，边界见 [Agent runtime](agent-runtime.md)。浏览器断线只影响订阅，不改变已经受理的 Turn。

Workflow 只用于必须跨进程、重启、部署或长等待继续的 durable operation；它不承载整个 Agent loop。durable operation 可以被 detached Job 消费，也可以由当前 tool call 持续附着直到终态。图片和视频生成采用后者：`generate_images` / `generate_video` 用稳定 owner identity 提交一次任务，断流后读取同一任务并重新订阅，直到生成结果发布为普通 Session file 才向模型返回。模型在调用前用 `ask_user` 补齐缺失选择；Runtime 不再维护 storyboard、production projection、审批工作台或“提交后先跳过工具结果”的特殊路径。不得为了“可能耗时”把普通工具或整个 Agent loop 包进 Workflow，也不引入 `WorkflowAgent`。

Server 通过内部 role transport 调用 worker。Worker 先把幂等 task admission 写入 Runtime 业务库，再启动 Workflow；`owner_service=runtime` 与稳定 `owner_ref` 防止同一 tool call 重复创建任务。Workflow World 是引擎恢复数据，不是 messages 或 Job 业务真源，Runtime 代码不得查询 World 表来回答产品 API。

Worker 不可用时，普通 Turn 和 inline tools 仍可运行。确定未受理的提交可以失败；请求超时或响应丢失则必须按原幂等键查询，不能假定未受理，也不能换键重提。已有 admission 可以是 queued，不能伪装成执行中。Workflow step 的 at-least-once 语义不等于外部副作用 exactly-once；付费或不可逆操作必须使用稳定 operation ID、远端幂等键或可查询关联 ID。

Job admission 与 dispatch intent 必须在同一 Runtime 事务提交；worker 用持久派发记录恢复启动。`start()` 异常可能表示结果未知，不能直接记为确定失败。run 绑定在等待期间持续有效；重复 run 的唯一 claim 不能代替同一 run 内每次副作用的取消、冻结 execution capability 与幂等检查。完成/失败通过幂等 settlement 写入业务状态，reconciler 修复引擎终态与业务未收口的窗口，不能仅依赖内存 completion watcher。

审批和外部结果先写持久状态及待唤醒记录，再恢复 Hook；早到决策、重复 resume、丢响应都需对账。Workflow replay 不会重新执行已成功的 execution-capability 检查 step，因此敏感副作用实际执行前必须重新验证已冻结 capability 的 operation/resource binding 与取消状态。产品用户授权由上层 App 在签发 capability 前完成，Runtime 不在 replay 中反查 tenant、workspace 或用户。未知付费结果无法查询时进入 reconciliation，不能由默认 step retry 再次收费。

## Session 与 Chat 边界

Runtime 内部 API 以 `/v1/sessions` 为根，由受信上层 App 的 workload identity 调用。Session 只保存 messages、run/stream 状态、工具结果、文件/Artifact 引用与执行关系；用户 memory、租户配额和产品领域状态不属于 Runtime Session。

一个宿主对象可以映射一个 Runtime Session；对 Web Chat 而言，该宿主对象是 product conversation。Runtime 不保存或理解 conversation 聚合，Session 才是全部执行事实的聚合根。messages、Turn、工具、审批、Job 与 workspace 都归属于 Session；独立状态机、分表或局部版本控制不改变归属。Chat 的 product conversation 是产品入口与展示投影，不是第二份执行会话。上层 App 根据自己的 tenant/workspace/user 模型校验映射与 membership；Runtime 只校验 workload caller、Session 关联和宿主签发的细粒度 capability，不接收或持久化这些业务 scope。

Chat 继续向浏览器提供 `/conversations` 产品 API：

- 创建 product conversation 时先创建 Runtime Session，再保存本地映射；
- 查询和所有 conversation 子资源按映射转发；Chat 在边界把 Session 标识、资源 URL 和上下文分类投影为 conversation-facing wire contract，不能把 `runtime_session_id` 暴露给浏览器；
- 列表、标题、项目/Canvas 绑定等产品投影留在 Chat；
- fork 先让 Runtime 复制 Session 历史与文件快照，再为新 Session 建立 product conversation 映射；对浏览器只返回新的 conversation ID；
- Chat 不持久化 messages、run journal、tool execution、Sandbox 或 Job；
- Chat 或其他产品宿主负责解析 Admin/Knowledge/Storage/Canvas 的业务授权，并向 Runtime 投影短期 capability；Runtime worker/sandbox 只消费 tenant-neutral 的 Session/资源能力。

Chat 与 Runtime 使用独立 PostgreSQL database，并明确禁止通过 XA/2PC、共享数据库或跨库事务把两个服务重新耦合。创建是一段最终一致的业务流程：Chat 使用稳定 `request_id` 调用 Runtime 创建/返回同一 Session，再幂等写入本地映射；响应丢失按原键重试。进程若在 Runtime 成功后、本地映射提交前崩溃，当前实现仍需要识别并回收孤立 Session；它尚未持久化 create/delete saga。未来增强方向是 Chat 本地持久化 intent/outbox、补偿和 reconciliation，不是追求跨库 ACID。删除先请求 Runtime，再删除本地映射，未知结果必须沿原身份对账，不能先删映射而失去 Runtime 清理责任。

产品标题、项目/Canvas 绑定以 Chat/Canvas 为权威，不进入 Runtime Session 表。产品宿主在每次
Agent run 前解析业务资源、模型、skills 与 plugins，把结果投影为 tenant-neutral 的
`TurnCapabilities = { provider, media, plugins, skills, memories }`；其中 `memories` 只是上层已授权内容的
冻结投影，不携带用户身份。Runtime 只冻结并消费这份执行 capability，不把
`project_id`、`canvas_id` 或其他业务 binding 升级为 Session 元数据。产品 conversation 的
创建/删除/查询始终经上层已授权映射，禁止直接信任客户端传入的 `runtime_session_id`。

本次 Runtime 绿地重构已明确授权丢弃并重建现有 Runtime 1.0.0 数据，因此直接重写 fresh baseline，不提供旧 Runtime Session schema 的迁移或兼容读取。数据删除只由部署时的显式 reset 执行，运行时代码不自行 drop 数据；外部资产和未决副作用仍必须由各自 owner 对账，不能因 Runtime 重建而假定已经撤销。

## Messages 查询与交互恢复

Runtime 必须提供按 Session 查询持久化 messages 的能力，包含稳定 message ID、顺序、Turn 关联和官方 AI SDK parts。当前详情响应携带 messages 不等于已具备长历史分页：分页接口应固定分支与读取边界，避免并发追加或切换历史导致重复/漏读；相关字段在 schema 中定义。Job、审批、文件详情按关联查询，不要求一次加载会话内所有资源。

持久化历史在没有在线 worker、没有活跃流或 replay buffer 已过期时仍可查询。UIMessage/工具结果是语义事实，实时 delta 是传输；Item 具有稳定身份，delta 不成为新消息。复用官方消息协议，遵守 [stream 契约](../../schemas/streaming/chat-uimessage-stream.md)。当前 Redis 活跃流恢复与长期消息保留分别管理，不能把恢复订阅描述成恢复 Agent 进程。

snapshot、分支 revision 与流恢复位置必须能够一致衔接，订阅/查询竞争通过补读或协议重放覆盖；cursor 失效明确要求重新加载。Session revision 保护历史结构，不能让每个 token/Job 进度推进用户命令的共同前置条件。幂等查询先于新操作的版本检查，同键异参拒绝。

同一 Session 最多一个 active Turn。steer 进入明确目标 Turn 的 inbox，queue 等待后续 Turn，二者不自动互换；accepted 不等于 delivered。待答工具/审批恢复同一 Turn，客户端不能替 server tool 提交执行结果。进程失联后旧 owner 的迟到写入必须被租约/执行代际拒绝，不能假定租约过期就已杀死旧进程。

Cloud 已将一个用户任务保持为唯一 `turns.id`；client-tool/approval continuation 把前 attempt 结算为 `waiting`、追加新 `turn_attempts.attempt_epoch`，而不是新建 Turn。`turn_steps`、`tool_effects`、`turn_leases`、Sandbox execution 和 workspace writer 都绑定精确 attempt；一个 Session 的 `waiting/running/cancel_requested` Turn 受同一 one-active-Turn 约束，只有匹配的 continuation 能把 waiting Turn 重新置为 running。

每个 Cloud attempt 在模型请求或 host effect 前写入不可变、无 secret 的 `turn_resume_envelopes`。它绑定 Session、history item/revision/digest、instruction/tool catalog/workspace digest、compactor version、remote binding，以及冻结的 provider/model binding、operation、reasoning、skills/plugin activation、approval/permission 和 assistant item identity。tenant/workspace/user 或产品 auth scope 不进入 envelope；secret-bearing `TurnCapabilities` 由上层宿主在恢复前重新签发。

Cloud tool effect 的稳定身份是 `(turn_id, tool_call_id)`；execute wrapper 在进入 host code 前原子 claim，完整 canonical input digest 负责身份判等，截断/redacted `input_json` 只用于观察。completed effect 可跨 attempt 返回已持久化结果，tool/digest 改变直接冲突，任何已存在的 `running` claim 都视为 unconfirmed：同 attempt 的重复进入也不能执行第二次，跨 attempt 则必须 reconciliation。

`reconcileOrphanedRuns()` 对失去 lease 的 Turn 先在一个事务中锁定 journal owner、Turn、latest attempt、lease、resume envelope 和 effect 状态，再调用 shared `classifyTurnRecovery()`：

1. `resume-waiting` 保持稳定等待，不创建 recovery invocation；周期 orphan scan 本身不把 waiting Turn 当成失主执行；
2. `resume-next-step` 从已提交 assistant journal item 继续下一 model boundary；`regenerate-model` 从冻结的 input/history boundary 发起一次明确的新采样；
3. 只有这两个 replay-safe 分支会原子结束旧 attempt、递增 epoch、复制 immutable envelope 并领取新 lease；
4. 取消、缺失/漂移 envelope、unconfirmed effect，以及 committed effect 没有 journaled SDK step 都转为 `interrupted`，绝不猜测或重放；
5. 旧 attempt Sandbox 的 finalization/release 先于新 recovery runner 启动，新 attempt 不继承旧 PID、终端、stream 或未确认工作区写入。

`resumeClaimedAgentRun()` 只接受已经事务 claim 的 attempt。它要求上层宿主为该 attempt 续期 `TurnCapabilities`，核对 provider、plugin 与 skill binding，并在 context projection 前验证 instruction、tool catalog、workspace、compactor 和 remote generation 与 envelope 完全一致；Runtime 不从业务 identity 反查 Admin，缺少续期 capability 或任一 drift 都 fail closed 并收口新 attempt。验证通过后构造新的 `RuntimeTurn`，重新进入唯一 AI SDK `ToolLoopAgent`，并主动消费 response 直到完成或失败。该语义是“同一 logical Turn 从已提交 model boundary 自动恢复”，不是透明续接 JavaScript、旧 provider stream 或 shell。

Desktop 启动时仍把残留 `running` Turn 标记为 `interrupted`；它尚无等价 physical-attempt envelope、generation validation 和 restart claim。这是当前 cross-host 缺口，不允许用 SQLite 双轨或第二套 loop 绕过。浏览器断线仍只释放订阅；持久取消先阻止新执行，再传播 AbortSignal 和清理责任。

## Sandbox 边界

`runtime-sandbox` 可以与另外两个角色使用同一 Node 镜像，但必须独立容器/Pod、Service 和 ServiceAccount。它只接受 `runtime` workload token；guest 不获得 Runtime DB、Workflow DB、Storage、模型或 provider 凭据。

controller 通过 Docker 或 Kubernetes adapter 管理 guest。生产 K8s 使用 gVisor、独立执行 namespace、网络策略、配额和 egress proxy；缺失隔离条件时启动/执行失败，不回退宿主机。未来若需要预热池、跨节点调度、快照迁移或高密度编排，可在同一 role contract 后替换 Go control plane；Go 组件仍是计算 adapter，不成为 Session 或 Agent owner。

workspace 是 Session 的持久文件状态，guest 是临时计算资源。命令以稳定 operation ID 创建/查询，响应丢失先查原命令；checkpoint 必须协调活跃写入。Job 如需文件计算，使用不可变输入与独立输出区，发布时按路径/revision CAS，冲突保留候选结果，不能覆盖用户或前台的新修改。

清理责任必须持久化，server/controller 重启后仍能回收资源。保存失败不得标记成功；达到计算硬期限仍需回收并报告未保存范围。关闭 Session 拒绝新输入与 Job，取消未完成执行，保留历史和资产；删除是独立操作。fork 只复制完整历史切点及对应文件快照，不复制 live Job、审批授权或副作用执行权。

## 数据与部署

### Runtime server 数据库采用绿地建模

Runtime PostgreSQL 的 logical Turn/physical attempt/tool effect/recovery generation 模型已直接进入 fresh-install `v1.0.0.0` baseline，不是基于旧表的增量迁移。baseline 从建库起就由 `turn_attempts` 持有 request/operation/history binding，step/effect/lease/Sandbox 绑定精确 epoch，副作用 ledger 命名为 `tool_effects`，attempt-scoped `turn_resume_envelopes` 与 generation-bound `context_checkpoints` 同时建立。旧混合模型、`tool_executions` 和中间 migration 都不保留。

聚合保持小而明确，不建设通用 event store。下表描述逻辑 owner 及当前实现度；物理表名可随 owner 语义收口，但不得重新混淆 identity、generation 和终态不变量：

| 逻辑对象 | 状态 | 持久语义 |
| --- | --- | --- |
| Session / item graph (`threads`, `thread_items`) | current | Session metadata、selected item、history revision、append-only UIMessage graph；attempt envelope/checkpoint 持久化所选 history binding 与 digest，不保存 tenant/workspace/user |
| `turns` | current | 逻辑用户任务及终态；`waiting/running/cancel_requested` 共用 one-active-Turn guard，不再存 request/operation/attempt 字段 |
| `turn_attempts` | current | 每次物理 owner 的单调 epoch、request/fingerprint、operation、history binding、waiting/终态 |
| `turn_resume_envelopes` | current | 每 attempt 不可变、无 secret 的 reconstruction snapshot；绑定 execution/capability digest 与 history/instruction/catalog/workspace/compactor/remote generation，不保存产品 auth scope |
| `turn_steps` | observability projection | step 记录受 attempt fencing，但不能单独成为 crash resume point；恢复 boundary 以 canonical journal item + envelope/effect facts 为准 |
| `turn_inputs` | current | `follow-up/next-turn` admission 与 delivered/not-delivered/unconfirmed 结算 |
| `tool_effects` | current with limits | `(turn_id, tool_call_id)` 身份、attempt owner、canonical `input_digest`、redacted `input_json`、running/completed/failed 与 result；effect class、外部 operation ID 和对账引用仍按工具补齐 |
| `context_checkpoints` | current | coverage/revision、source history revision/digest、instruction/catalog/workspace digest、compactor version、remote binding 与 estimated usage；不单独证明 effect 可恢复 |
| `turn_leases` | current | 精确绑定当前 attempt 的 fencing token；过期只表示 owner 可替换，不表示副作用安全重放 |
| Workspace file / operation | current with limits | `thread_files` 和 `thread_file_save_operations` 拥有 stable path、content/path generation、etag、tombstone/save identity；resume envelope 绑定当前 live workspace digest，跨 Storage 未决写回仍由 reconciliation 收敛 |
| Sandbox attempt (`turn_sandbox_executions`) | current | 精确所属 `(turn_id, attempt_epoch)`、restoring/active/finalizing/releasing 与持久 cleanup responsibility |

当前由数据库约束/事务承担的不变量包括：每个 Session 至多一个 `waiting/running/cancel_requested` logical Turn；每个 Turn 的 attempt epoch 唯一且递增；lease、step 和 Sandbox 精确绑定 attempt；tool-call identity 只在 logical Turn 内稳定且输入不可变；live workspace path 在 Session 内唯一，旧 writer/attempt 不能推进当前文件；只有持有完整 immutable envelope 且 generation 未漂移的 replay-safe boundary 才能 claim recovery。跨 Storage/Sandbox/Workflow 的结果继续通过 intent + reconciliation 收敛，不伪造跨服务事务。

`resume envelope` 是以上权威行在 attempt admission 时冻结的 reconstruction snapshot，不复制 UIMessage transcript 或第二份可变状态机。恢复时仍在事务中交叉核对 Turn/attempt/journal/effect 与 envelope，并在进入模型前重新计算 context generation；stream chunk、Redis replay、provider response id、PID 与 Sandbox session id 都不能成为恢复真源。UIMessage 正文留在 `thread_items`，tool/step 表只保存执行控制事实，避免把同一 transcript 再编码一遍。

当前一个用户任务只有一个 `turns.id`，continuation 只追加 `turn_attempts`；recovery 也必须沿用这一身份，不得退回新建 Turn。`turn_steps` 与 `tool_effects` 不允许恢复时把 terminal row 重置为 running；相同 identity 的异参写入直接冲突，unconfirmed effect 只有对账或显式新操作可以推进。

绿地表示**模型和 API 无兼容包袱**。当前 local/VPS Runtime 业务数据被明确列为可重建，因此该 release 只保留重写后的 `v1.0.0.0`，不提供从旧 Runtime schema 的 upgrade/down 路径。部署时由显式 reset 动作重建 Runtime 数据库；运行时代码不自行 drop 数据。该 baseline 被真正作为不可重建的发布投产后，后续结构变更再恢复版本化 migration 规则。

Chat 只保留产品映射 schema。Workflow 使用自管理 PostgreSQL World 和官方 schema setup；Runtime 业务迁移与 World migration 分开执行、备份和恢复。

同一 Runtime image 必须同时包含：

- server TypeScript source 与共享 runtime libraries；
- Nitro 编译的顶层 `.output`；
- sandbox controller 所需的 Docker/kubectl client；
- worker durable Job 与其冻结 capability。

角色启动命令分别为：

- server：`node --import tsx src/cmd/server/main.ts`
- worker：`node --import tsx src/cmd/worker/production.ts`
- sandbox：`node --import tsx src/cmd/sandbox/main.ts`

源码入口分别位于 `src/cmd/server`、`src/cmd/worker`、`src/cmd/sandbox`。worker 的开发入口负责加载 Workflow 开发产物；Nitro production build 生成 `.output/server/index.mjs` server，由 `production.ts` 在加载前固定 application-managed shutdown 模式。HTTP listener 与 Runtime bootstrap 各有一个明确 owner，但共享同一进程和 bundle lifecycle；不得从 bundle 外再次导入一份 bootstrap。`src/index.ts` role dispatcher、`RUNTIME_ROLE` 环境分支和 `/runtime/worker` 子包都属于禁止恢复的旧结构。

部署使用同一个 `runtime:<immutable-tag>`，但分别配置 readiness、资源和凭据。Sandbox controller 不挂 Runtime/Workflow DB secret。Server、worker、sandbox 可以独立扩缩；发布必须同时验证三角色构建，不能只验证 server。

独立 database 不等于独立故障域：同 PostgreSQL 集群仍共享容量和故障。World retention 覆盖活跃 Job、Hook 等待及恢复窗口；业务结果先持久化，不能靠仍未清理的引擎日志提供历史。备份恢复必须核对业务/引擎时间点和外部 operation，缺失 run 不自动触发重做。

Postgres World 是自托管 reference implementation。flow route 必须只接受受保护的内部 delivery，Gateway 不公开转发，业务 middleware 不得消费其请求体；不假定引擎自带鉴权或端到端加密。shutdown 保持 flow handler/数据库可用直到 `world.close()` 收口，再关闭依赖。并发、队列积压、补偿 backlog、未知结果与资源回收均需可观测。

durable Job 必须能跨正常部署继续：绑定 definition/release，兼容变更验证 replay；不兼容变更保留旧代码及其 delivery 路由直到旧 Job 收口。reference World 不自动提供版本路由；未验证该能力前采用兼容发布或停收 drain，不能用同一镜像标签掩盖恢复代码已经消失。

## 被否决方案

| 方案 | 结论 |
| --- | --- |
| 单独 `runtime-agent` | 本阶段不采用。server 内运行 loop 简化交接；未来若有资源/扩缩证据可拆进程，Session ownership 与协议保持不变 |
| 每个 Turn 使用 Workflow/WorkflowAgent | 否决。增加 replay、版本与 World 耦合，且普通 artifact/Bash 没有 durable Job 需求 |
| 保留独立 Executor/Sandbox 服务，Runtime 只做 facade | 否决。继续存在多执行 owner、独立数据库和跨服务胶水 |
| 三角色放在一个进程 | 否决。worker 的恢复/扩缩与 sandbox 的权限边界需要进程隔离 |
| Runtime server 同时用 Node 和 Go | 否决。单进程不混合语言；未来 Go 只作为独立 sandbox control-plane adapter |

## 实现与验证边界

事实入口：

- Runtime server 与 ToolLoop：[server entry](../../apps/backend/services/runtime/src/cmd/server/main.ts)、[agent application](../../apps/backend/services/runtime/src/application/agent)
- Runtime worker：[production wrapper](../../apps/backend/services/runtime/src/cmd/worker/production.ts)、[Nitro app and lifecycle owner](../../apps/backend/services/runtime/src/cmd/worker/app.ts)、[task application](../../apps/backend/services/runtime/src/application/tasks)、[workflows](../../apps/backend/services/runtime/workflows)
- Sandbox controller：[sandbox app assembly](../../apps/backend/services/runtime/src/bootstrap/sandbox-app.ts)、[engine](../../apps/backend/services/runtime/src/sandbox/engine.ts)
- 启动装配：[bootstrap](../../apps/backend/services/runtime/src/bootstrap)
- 进程配置：[config](../../apps/backend/services/runtime/src/config)；配置解析不属于 bootstrap，底层模块不得导入启动装配层
- Chat BFF：[HTTP composition](../../apps/backend/services/chat/internal/api/http/router.go)、[conversation projection](../../apps/backend/services/chat/internal/application/projection.go)
- 服务图：[services.yaml](../../services.yaml)
- K8s 三角色：[runtime base](../../infra/k8s/base/runtime)

完成门槛包括 Runtime/Chat tests 与 builds、三份 OpenAPI contract、transport codegen、fresh migration integration、service graph、K8s render、Single-VPS Compose、同一 Linux image 启动三个角色。类型检查或 mock 单测不能替代 Workflow World、Docker/gVisor/Kubernetes 与多进程故障验证。

当前实现已要求 Chat 与 Runtime 复用稳定 `request_id`。Runtime 先按 workload caller 与请求键查询既有 Session：同键同 canonical fingerprint 返回原结果，同键异参明确冲突；该键不含 tenant/workspace/user，也不把 workspace 当进程锁、并发锁或请求唯一键。durable task 的 `(owner_service, owner_ref)` 同时绑定 type 与规范化 payload。业务 task row 也是持久 dispatch intent：`start()` 结果未知时保持 queued，周期恢复可启动候选 run，首个 `claimTaskStep` 原子绑定唯一 run，其他候选在副作用前失败。仍待补齐的 Session 边界是：Chat 尚未把创建/删除意图作为可恢复状态持久化，当前依靠稳定请求键重试和后续孤立 Session 回收收敛。该缺口应通过本地 saga 状态、reconciliation 和 cleanup 修复；跨数据库 ACID 不是目标，也不是完成标准。

当前本地证据覆盖 Runtime/Chat 单测、两者构建、三份 OpenAPI/codegen、全仓 lint/typecheck、migration checksum、service graph、Kubernetes render 与 Single-VPS Compose 解析。Runtime 测试中的 PostgreSQL/Redis integration case 在未启用集成环境时跳过；真实 Postgres World 恢复、Docker/gVisor/Kubernetes guest 生命周期和同一 Linux image 三入口启动仍是部署验收项，不能由本地类型检查替代。

最低故障验收覆盖：创建映射中途崩溃、同键异参、跨 Session 引用、分页与追加竞争、断线/过期 replay、steer 与终态竞争、旧 owner 迟到写入、start 丢响应、step 重投、早到审批、取消/成功竞争、文件 CAS 冲突、保存失败回收及跨版本恢复。文档检查不能替代这些实现测试。

## 公开实践与适用边界

- [Codex App Server](https://openai.com/index/unlocking-the-codex-harness/)：借鉴 Thread/Turn/Item、稳定 Item 生命周期与服务端会话历史；不推导跨进程透明恢复或固定进程数。
- [Anthropic Managed Agents](https://www.anthropic.com/research/managed-agents)：借鉴 Session、harness、Sandbox 的生命周期分离；会话聚合与计算隔离可以同时成立，不照搬托管内部保证。
- [AI SDK ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)：复用 SDK-owned loop 与原生消息/工具协议；Runtime 只持久化执行许可事实与冻结 capability binding，产品授权仍由上层 App 负责。
- [Workflow 幂等](https://workflow-sdk.dev/docs/foundations/idempotency)、[版本管理](https://workflow-sdk.dev/docs/foundations/versioning)：区分 run 去重与副作用幂等；接口必须核对安装版本，托管版本路由不能套用于自托管 World。
- [Postgres World](https://github.com/vercel/workflow/blob/main/packages/world-postgres/README.md)、[Hono integration](https://workflow-sdk.dev/docs/getting-started/hono)：验证自托管鉴权、shutdown、重投与官方构建路径。

三角色、Session 聚合、执行权限与上层业务状态的分界是本项目决策；公开实践用于验证边界，不替代代码和目标环境验收。
