# AgentFrame → Canvas 端到端迁移核对

核对日期：2026-09-21。基准为本地 `multix-app` 当前实现、`llmops-web/apps/agentframe-web`，目标为 monorepo 已提交代码。没有把复制进 `internal/server/**` 的未挂载代码计为可用功能，也没有按接口或表数量计算完成率。

目标保持：Canvas Go 业务与媒体执行 + TS Executor Workflow；Chat 复用唯一 ToolLoopAgent、共享 `@repo/chat`；Jotai 页面级状态；Tenant 公司 / Workspace 公司内组织；源 schema 以最新 MySQL 为准，目标 PostgreSQL，Canvas 首次建库合入 v1.0.0。按用户说明，本期没有存量数据兼容要求，未把 MySQL 历史数据搬运列为上线必做项。源仓库只读。

## 已接线的能力

- 项目、画布、节点与连线、手动/Agent CAS mutation；Tenant/Workspace 权限上下文。
- 共享 Chat 右侧会话，Canvas 会话绑定；read/update/delete/generate/history/cancel 工具复用现有 runtime。
- 文本、图片、视频任务派发至 Executor；生成历史、取消、结果回写、资源版本、上传和独立复制。
- 导出接入原 Go ZIP/FCPXML；视频首尾帧接入原 Go FFmpeg executor；唯一 Workflow 调度，不启动旧 MQ/lease worker。
- 资源图片生成草稿/历史/Worker；故事板草稿编辑、确认、渐进 SSE、预览、时间线和排序。
- 管控默认模型、成员/模型授权、项目金额限额、权益包配置 CRUD、用量 XLSX。
- 项目素材搜索与物化、资产入库、节点复制、用户视口、视频首尾帧选用、智能素材匹配。
- 权益包送审：额度预占、短期签名素材 URL、Ark CreateAsset/GetAsset、异步状态轮询及额度提交/释放。
- 归档过期清理和引用安全的两阶段资产 GC；Knowledge 对象删除为幂等内部接口。

## 明确缺口与断点

| 优先级 | 功能 | 端到端断点和完成标准 |
| --- | --- | --- |
| P0 | 真实环境验收 | 代码链已接通，但仍需配置真实模型、Ark 权益包凭证和可被 Ark 访问的 `PUBLIC_GATEWAY_URL`，按文本/图片/视频/分镜/送审路径做成功、失败、取消和恢复验收。 |
| P1 | 审核外部清理 | Ark 送审与查询已接入；源端 DeleteAsset 清理 outbox、审核替换/删除后的外部素材回收仍未迁入。当前包在存在已提交审核时禁止删除，避免凭据和远端素材失联。 |
| P1 | 官方素材 | 普通项目资源、独立物化和送审已接入；源端官方素材注册、全局预置资源对账仍未成为目标运行入口。 |
| P1 | 用量对账 | 预占、配置估算、资源/节点/分镜统计和 XLSX 已接入；真实 Provider 最终账单与估算差异对账仍缺，未知报价保持待结算而不是写成零元。 |
| P1 | IAM scope 清理 | 项目/画布删除、归档清理、资产 GC 已接入；Tenant/Workspace 被 IAM 删除后的整域清理任务仍未装配。 |
| P2 | 用户端验收 | 主要交互和源端样式已迁入；布局、键盘、拖拽、弹层和错误恢复需按源端人工验收。按仓库规则未运行浏览器自动化，不能以构建通过代替视觉验收。 |
| P2 | Chat 能力覆盖 | 当前只有画布读取/修改/删除和节点生成/历史/取消工具；尚不能经对话操作资源库、故事板拆分确认、审核、导出和管理配置。这是用户要求的 AI 扩展目标，不是源 AgentFrame 已有 runtime 的迁移缺失。 |

## 证据入口

- 源公共能力：`../multix-app/api/idl/server.thrift`；源 Worker 实际注册：`../multix-app/internal/bootstrap/worker/module.go`（归档、首尾帧两个 executor）。
- 源平台生命周期：`../multix-app/internal/bootstrap/server/{quota,asset_gc,iam_scope_cleanup}.go`；源业务：`internal/server/application/{benefitpackage,projectusage,canvasnode,resource}`。
- 目标接线：`apps/backend/services/canvas/cmd/server/main.go`、`internal/api/http/*routes.go`；仅 `internal/server/**` 中有实现不等于上述入口消费。
- 目标资源生成：Canvas `internal/application/resource_generation_runs.go`、`internal/infrastructure/persistence/resource_generation.go`、`migrations/versions/v1.0.0.sql`。
- 目标 Worker：Canvas `internal/application/{frame_execution,frame_worker,storyboard_worker,worker_cancellation}.go`；Executor `workflows/canvas-storyboard.ts`、`src/application/tasks/{binding,cleanup,service}.ts`。
- 目标费用/配置：Canvas `internal/application/{management,management_usage}.go`；Admin `src/application/benefit_packages.py` 与 repository。
- 目标用户入口：`apps/frontend/apps/canvas/src/components/{Storyboard,CanvasBoard,GenerationSettings,ResourceGenerationForm,ResourceLibrary}.tsx`、`components/prompt/{PromptEditor,FrameReferences}.tsx`。
- 目标 Agent 工具：`apps/backend/services/chat/src/application/agent/tools/builtins/canvas.ts`；共享会话：`apps/frontend/apps/canvas/src/components/CanvasConversation.tsx`。

## 运行证据与验收边界

已验证：真实本地 Workflow→Go FFmpeg→Knowledge 首尾帧 JPEG、执行重放仍恰好两个输出 owner；先取消 owner 再提交返回同一取消记录、不启动 Workflow；上传/版本字节、节点生成派发/幂等/失败回写、导出失败与权限边界。独立 PostgreSQL 完整执行 Canvas v1.0.0，覆盖送审 fence、归档 cleanup 和资产 GC 表结构；临时数据库已删除。

本轮 `just sync`、根 `just lint`、根 `just build`、Canvas/Gateway Go test+vet、Admin/Knowledge Ruff+Mypy 全部通过。上述结果不是完整产品验收：真实 Provider 文本/图片/视频/分镜成功生成、真实 Ark 审核、执行中取消与宕机恢复、真实视频 ZIP/FCPXML 导出及 UI 交互仍需目标环境验收。

Provider 已接收付费请求但返回 task ID 前连接丢失，缺 Provider 幂等支持时不能保证恰好一次；凭据被删除/失效可能使清理持续失败。持久 cleanup_pending 保证重试意图，不保证外部服务必然接受取消。

默认配置与权益包原源端主要按 Tenant，当前目标按 Tenant+Workspace：公司共享还是组织独立需形成明确目标产品语义，不能自动认为等价。

## 剩余工作的闭环顺序

1. 配置真实 Provider、Ark 凭证和公网 Gateway 地址，完成生成、送审、导出和 UI 用户路径验收。
2. 补 Ark DeleteAsset 清理 outbox、IAM Tenant/Workspace 整域清理和真实账单对账。
3. 迁入官方素材对账，并按产品优先级扩展 Chat 对资源库、故事板、审核和导出的工具覆盖。


## 三 Agent 执行分工（当前批次）

- 主 Agent：分镜分批持久回写/稳定身份、取消和父级生命周期检查、默认推理参数的 Executor 消费；统一公共 client、Workflow、启动、SQL及生成集成。下一批处理导出清理、资产 GC 和作用域清理；物理删除须先核对内容摘要共用与并发上传，不直接按单个 Asset 行删对象。
- 管控 Agent：权益包 CAS/模型归属，节点与资源生成授权/额度，默认参数服务端冻结，用量统计与导出。下一批补审核/AssetGroup与配额。
- 用户端 Agent：产物入库、节点复制、视口保存、项目素材搜索/物化、首尾帧读取与选用。下一批补智能匹配和其余交互。

各自按垂直业务闭环修改前后端；共享文件由主 Agent 集成。当前分支继续，不建 worktree、不 push；分批验证后由主 Agent 统一提交，避免共享 Git index 交叉提交。


### 第一批落地与验证

本批三条线已落代码：主 Agent 接通 Executor 分批 progress HTTP（补上此前漏注册的 worker route）、稳定分镜身份与父级删除/取消保护，接入服务端冻结推理参数；管控 Agent 补权益包行锁 CAS、资源额度准入/终态触发器、模型/估价元数据与用量导出；用户端 Agent 补节点复制、产物入库、视口、统一项目素材搜索/物化、首尾帧选用。

在独立临时 PostgreSQL 数据库和独立 Canvas 进程验证：初始 v1 SQL、分镜多批/replay/稳定ID/冲突/取消/删除父画布、视口往返/跨租户拒绝、节点复制重放及删除后拒绝、产物入库与物化重放/冲突/独立owner。验证库和进程已清理，不改真实源数据。发现并修复了 JSONB 字符串格式差异使幂等回写误增 revision 的问题。

分镜使用独立可重试持久写回 step，重试写回不会重新调用付费模型。随后批次已补齐素材匹配、资源物化、权益包送审、归档清理、资产 GC 和前端资源交互；全仓生成、静态检查和构建现已通过。未完成项以本文件上表为准，不再沿用本节早期批次的在途判断。
