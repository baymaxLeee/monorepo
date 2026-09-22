# AgentFrame → Canvas 源码迁移接管计划

更新时间：2026-09-21

## 事实与结论

- 业务事实源固定为 `multix-app@1435719f6932b84172d077e67eefc2898c4c71aa` 和同工作区当前 `agentframe-web`。
- 目标仓库此前同时存在两套 Canvas 后端：`internal/server/**` 是从 AgentFrame 搬来的成熟实现，`internal/application/**` 是另写的简化实现。
- `cmd/server/main.go` 实际挂载的是简化实现；因此即使成熟代码存在，运行时的 revision、节点局部更新、任务状态、素材匹配和生成协议仍会漂移。
- 旧文档把简化实现宣称为“已接线能力”，缺少运行入口证据，结论无效。

本次直接重构，不再继续扩展简化实现，也不在成熟核心中增加兼容旧实现的 API。迁移完成后，运行时只保留一套领域模型、应用服务、持久化模型和节点状态机。

## 搬迁边界

直接复制且保持业务语义不变：

- `internal/server/domain/**`
- `internal/server/application/**`
- `internal/server/adapters/outbound/persistence/**`
- AgentFrame 的 Canvas / CanvasNode / Resource / Asset / Generation / Task 业务字段、错误语义及 handler 行为
- 前端以现有已完成本土化适配的 Canvas Studio 为基线；只同步缺失交互及后端契约变化，不再整体覆盖

仅允许在边界处适配：

- Go module import path
- Hertz/TOP/Thrift 不迁入目标运行时；基于同一 application service 重新暴露 monorepo HTTP/OpenAPI，允许精炼资源命名，但请求/响应字段与交互语义必须可追溯到成熟契约
- IAM 身份与项目权限上下文
- AIGW/模型目录到 Admin + Executor
- UP/对象存储到 Knowledge
- Redis、异步任务和部署启动方式
- MySQL 模型到目标 PostgreSQL 的等价持久化映射
- Arco 到 shadcn/ui，以及旧 `h-*` utility 到默认 Tailwind CSS

边界 adapter 不得重新实现 revision、状态机、幂等、节点 patch、轮询合并、排序或任务生命周期。

## 执行顺序

1. **冻结基线**：记录源 commit；机械同步 domain/application/persistence，排除测试文件，只替换 module path。每批同步后单独编译 `internal/server/...`。
2. **数据库同构**：用版本化 migration 把现有 `canvas_nodes` 转为 AgentFrame 的 scope + `node_data` + node revision 模型，批量回填并验证后在同批删除旧列；补齐成熟核心实际使用的任务、生成、资源、资产和清理表。不得在普通请求中做数据转换。
3. **运行入口接管**：新增本地 bootstrap，只装配成熟 application services；HTTP/OpenAPI 只做 DTO 映射。把节点创建、字段 patch、位置批量更新、连线、删除、生成状态批量读取先切换，再覆盖其余路由。
4. **异步能力接管**：复制 TaskRun、poll scheduler、generation、storyboard、archive、cleanup 生命周期；Provider 调用落在 Executor/Admin/Knowledge adapter，不改变核心状态机。
5. **删除双实现**：所有路由切换并通过编译后，删除 `internal/application/**`、旧 persistence models、旧 worker 及它们的 contracts；禁止保留 fallback 或双写。
6. **前端对齐**：保留现有 Canvas Studio 及已完成的 shadcn/ui、Tailwind、路由和 API 本土化适配；只按当前 `agentframe-web` 核对缺失功能与交互。节点写入发送字段 patch；服务端响应和轮询按 node id/revision 只合并目标节点，禁止整图重建。
7. **生成与验证**：API 变化运行 `just sync`；执行 Canvas Go 编译、前端 typecheck、受影响 build、根 `just lint`。浏览器/UI 验收由用户按仓库规则执行。

## 完成标准

- `cmd/server` 不再 import `internal/application`。
- `internal/application/**` 和旧 `internal/infrastructure/persistence` 被删除。
- 节点任意字段更新、拖动与轮询都只更新指定 node；其他 node 的 revision、生成状态、选中产物和本地交互状态保持不变。
- 前后端 DTO 能逐项追溯到 AgentFrame 当前契约；目标仓库不再存在私自发明的 `asset-matches/latest` 等接口。
- 数据库表和索引与成熟 repository 的实际查询一致，migration 对存量节点完成结构化回填和不变量校验。
- 生成、取消、历史选择、素材匹配、故事板、资源、归档、审核的状态迁移与 AgentFrame 一致；差异只出现在明确列出的基础设施 adapter。
- `just sync`、受影响 build/typecheck 和 `just lint` 通过。

## 当前进度

- 已确认双实现及错误启动接线。
- 已从上述源 commit 机械同步 `domain/**`、`application/**`、`persistence/**`；成熟核心 `go test ./internal/server/...` 编译通过。
- 已复制并验证无需私有 SDK 的 Redis、异步执行、IAM resource、project cleanup、task/usage observer adapter；AIGW、UP、IAM config/quota/user、HiBot 和密钥实现已完成端口清单，临时复制的私有 SDK 实现正逐项由 monorepo 基础设施替换，不能进入最终运行树。
- 已把成熟 Artifact port 的 UP 实现替换为 Knowledge 实现；成熟业务 namespace 保持不变，只在 Knowledge 边界转换为其要求的 64 位 scope。
- 已明确目标传输协议为 OpenAPI；临时复制的 Action/Thrift handler 与生成类型只用于字段核对，接管时删除，不进入最终运行入口。
- 成熟 handler 已从 `thrift_gen` 解耦并改用纯 Go contracts；Action registry、Thrift 生成树及 Hertz SSE transport 已删除。新增 OpenAPI REST transport 的节点主链路，使用资源路径承载 scope，并在边界将 snake_case JSON 无损映射到成熟 contracts。
- OpenAPI 节点更新路由直接调用成熟 `UpdateCanvasNode`，请求仍保留 pointer patch 语义；位置批量更新与状态批量读取是独立端点，不再走整图 mutation。
- 已发现旧简化层依赖其私自加入成熟核心的兼容 API；这些 API 不会回填，旧层将在入口接管时删除。
- 下一步是补齐其余 OpenAPI 资源与 SSE/polling 端点、继续替换 IAM/AIGW/HiBot 外部依赖，并装配成熟 application runtime；完成前不切换 `cmd/server`。
