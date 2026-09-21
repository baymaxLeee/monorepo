# AgentFrame → Canvas 端到端迁移核对

核对日期：2026-09-21。基准为本地 `multix-app` 当前实现、`llmops-web/apps/agentframe-web`，目标为 monorepo 当前工作区，包含其他 agent 尚未提交的代码。其他 agent 持续修改中，本清单是当时快照。没有把复制进 `internal/server/**` 的未挂载代码计为可用功能，也没有按接口或表数量计算完成率。

目标保持：Canvas Go 业务与媒体执行 + TS Executor Workflow；Chat 复用唯一 ToolLoopAgent、共享 `@repo/chat`；Jotai 页面级状态；Tenant 公司 / Workspace 公司内组织；源 schema 以最新 MySQL 为准，目标 PostgreSQL，Canvas 首次建库合入 v1.0.0。按用户说明，本期没有存量数据兼容要求，未把 MySQL 历史数据搬运列为上线必做项。源仓库只读。

## 已接线的能力

- 项目、画布、节点与连线、手动/Agent CAS mutation；Tenant/Workspace 权限上下文。
- 共享 Chat 右侧会话，Canvas 会话绑定；read/update/delete/generate/history/cancel 工具复用现有 runtime。
- 文本、图片、视频任务派发至 Executor；生成历史、取消、结果回写、资源版本、上传和独立复制。
- 导出接入原 Go ZIP/FCPXML；视频首尾帧接入原 Go FFmpeg executor；唯一 Workflow 调度，不启动旧 MQ/lease worker。
- 资源图片生成草稿/历史/Worker；故事板草稿编辑、确认、SSE、预览、时间线和排序已有在途实现。是否接线与真实模型成功验收分别记录。
- 管控默认模型、成员/模型授权、项目金额限额、权益包配置 CRUD、用量 XLSX 入口已有在途实现。

## 明确缺口与断点

| 优先级 | 功能 | 端到端断点和完成标准 |
| --- | --- | --- |
| P0 | 资源生成与初始数据库结构 | `ResourceGeneration` 嵌入 Generation，初始 SQL 曾漏 reserved_amount_micros / usage_settled；本轮已补两列。资源任务仍未调用 `admitGeneration`，没有资源任务结算 trigger；项目模型授权/额度必须覆盖资源生成，不能只保护画布节点。 |
| P0 | 权益包并发正确性 | Admin benefit_packages update/delete 先查 revision 后写，缺行锁/CAS；模型归属靠 JSON 查重，缺数据库唯一约束。需要保证并发同 revision 只能一个成功，同一模型不能被两个有效权益包占用。 |
| P1 | 审核与官方素材 | 源 `benefitpackage/review.go`、`review_cleanup_processor.go` 与 `assetreview/client.go` 的送审、查询、重试、清理及 AssetGroup 管理未接入目标运行链；当前权益包只有配置 CRUD，material_used 无实际消费更新。需要上传→审核→官方素材注册/使用→清理全链。 |
| P1 | 素材匹配与物化 | 源 Start/CancelCanvasNodeAssetsMatch、SearchCanvasNodeAssets、MaterializeCanvasResourceAssetReference / StandaloneAssetReference 无完整目标链。目标故事板 matching 固定 false，提示词仅当前图节点；resource-copies 不能代替项目素材搜索、绑定/独立物化。 |
| P1 | 资源双向流转 | 缺画布已有 Asset 入库（源 CreateResourceFromAsset）、资源批量删除/分页/完整描述编辑、生成草稿上传参考图。当前版本历史与独立复制已实现，不能把整个资源模块标为缺失。 |
| P1 | 故事板渐进生成 | Go progress endpoint 与前端 SSE 已存在，但当前 `canvas-storyboard.ts` 没有调用 progress endpoint；Worker 仅终态一次性保存 shots。需分批持久回写、稳定 shot identity、取消/父资源删除检查，才能实现生成过程中逐段可见。完整源素材增强/引用物化亦缺。 |
| P1 | 首尾帧结果消费 | 抽帧 Worker 成功保存两个 Asset 和 owner，但公共 Generation DTO/内容接口未提供首尾帧读取/选用；现有 GenerationContent 只读取视频主输出。前端最新在途代码已有模式选择和 FrameReferences 首尾帧交换，不能再列为完全没有 UI；仍须接上视频产物提帧后的消费链。 |
| P1 | 默认参数与模型选择 | 管控 temperature/top_p/max_tokens/reasoning_effort 未完整进入执行 payload；GenerationSettings、ResourceGenerationForm 仍读全局模型列表，未统一消费项目授权目录。配置可保存不等于执行生效。 |
| P1 | 计费、用量与配额 | 节点 SQL trigger 已做终态释放预占/扣预估费用；但目前主要按 generated_second×请求时长估价，不是实际 Provider 结算。文本/图片/自动时长、币种一致性、资源生成/剧本拆分用量与对账缺失；XLSX 固定 Pending、姓名/模型名为 ID。项目数/存储量/预置权益素材量配额未装配。 |
| P1 | 清理与生命周期 | 源 asset GC/reference reconciler、archive Cleaner、IAM scope cleanup 均未装配。删除 owner 不会物理删除 Knowledge 对象，导出七天不可下载也不会自动清理；租户/Workspace 删除后的业务清理缺失。 |
| P2 | 用户端交互补齐 | 已有节点复制、用户视口保存/恢复、项目封面和项目统计仍缺；资源批量操作等见上。布局/键盘/拖拽/错误恢复需用户按源端验收，未使用浏览器宣称视觉还原。 |
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

已验证：真实本地 Workflow→Go FFmpeg→Knowledge 首尾帧 JPEG、执行重放仍恰好两个输出 owner；先取消 owner 再提交返回同一取消记录、不启动 Workflow；此前已验证上传/版本字节、节点生成派发/幂等/失败回写、导出失败与权限边界。Worker Go build/vet、Executor lint/typecheck/Nitro build、OpenAPI sync 通过。

本轮根 `just build` 通过；根 `just lint` 被其他 agent 在途前端文件格式问题阻断，未修改其业务文件。上述结果不是完整产品验收：真实 Provider 文本/图片/视频/分镜成功生成、执行中取消与宕机恢复、真实视频 ZIP/FCPXML 导出、审核及 UI 交互仍未完成真实端到端验证。

Provider 已接收付费请求但返回 task ID 前连接丢失，缺 Provider 幂等支持时不能保证恰好一次；凭据被删除/失效可能使清理持续失败。持久 cleanup_pending 保证重试意图，不保证外部服务必然接受取消。

默认配置与权益包原源端主要按 Tenant，当前目标按 Tenant+Workspace：公司共享还是组织独立需形成明确目标产品语义，不能自动认为等价。

## 剩余工作的闭环顺序

1. 收敛当前集成断点：资源生成授权/结算、权益包并发、模型配置执行生效、生成结构与初始 SQL 一致。
2. 补素材域：审核/AssetGroup、智能匹配/物化、入库与资源引用、GC及生命周期清理。
3. 补创作闭环：分镜渐进回写/素材增强、首尾帧消费、缺失交互及 Chat 工具覆盖。
4. 配置真实 Provider 按用户路径验收，完成整个工作区生成、构建、静态检查与部署验收。不得以本 Worker 批次提交代替整体迁移完成。
