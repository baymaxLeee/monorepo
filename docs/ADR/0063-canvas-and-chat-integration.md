# ADR 0063：Canvas 业务能力与统一 Chat runtime

状态：已接受
日期：2026-09-20

## 决定

前后端应用名均为 canvas。Canvas 保留 Go 领域规则，拥有项目、图、资产关系及生成结果；Chat 拥有会话和 AI SDK ToolLoopAgent，工具经生成契约的内部 HTTP client 调用 Canvas。前端统一使用 design-system 与 lucide，不迁入 Arco、Garfish 或旧物料库。

手动与 Agent 写入调用同一 application 用例。内部身份包含服务身份与用户/组织，服务 token 不代替项目权限。画布操作以预期 revision 和幂等 key 防止冲突与重放。画布绑定在会话持久化，不能从模型参数取得；每次 run 和每次操作重新校验权限。

Canvas 素材独立于会话存活；删除会话不能删除被画布持有的内容。旧 Up 接入现有 Knowledge 正式 HTTP 能力，不跨库、不跨服务导入实现。模型 Provider、全局目录、默认配置与权益包归 Admin；Canvas 拥有项目级成员、模型授权、使用量、审核状态和资源使用关系。Canvas 的图片、视频和文本节点生成保留 AgentFrame 业务状态机，通过 monorepo AIGW/Provider 能力执行；持久任务复用 Executor。

Canvas 不运行 HiBot、个人 Agent 或租户 Agent。右侧对话唯一 runtime 是 Chat 的 AI SDK v7 `ToolLoopAgent`，同一 tenant、workspace、user、project、canvas 原子地获取或创建一个私有会话；Canvas 协作数据共享，会话和 memory 不共享。Canvas 删除后保留只读聊天历史，不再允许启动绑定该 Canvas 的新 run。

浏览器只经 Gateway 的 `/api/canvas-server` 前缀访问；Chat、Executor 等服务以 service token 直连 Canvas 根路径。Canvas 验证服务身份，用户/租户头不能单独构成可信内部身份。前端业务代码直接消费 OpenAPI 生成客户端和 snake_case DTO，不保留 AgentFrame facade、Board/Action 协议、旧 export alias 或运行时协议探测。

## 复用矩阵

| 能力 | 消费者 | 决定 |
| --- | --- | --- |
| Canvas 契约 | Canvas、Chat、Canvas 前端 | schemas 生成客户端；领域实现留在 Canvas |
| 内部 HTTP | Chat、executor | 延用 transport-ts；不新建通用 kernel |
| 会话展示 | Chat、Canvas | 共用 packages/chat 的 ChatSession、消息类型、工具卡片与 artifact 面板；ai-elements 保持基础展示层 |
| 权限 | gateway、IAM、Canvas | 共用身份契约，Canvas 负责项目授权 |
| 资产生命周期 | Canvas、knowledge | 各自持有业务关系/存储对象；不复用会话删除语义 |

## 前端状态与布局

Canvas 保留 Jotai，按 ProjectID + CanvasID 挂载页面级 Provider。正式图规范化为节点 ID 列表与节点映射，故事板派生自视频节点；节点组件按 ID 订阅。XYFlow 临时坐标、选择和表单草稿留在对应交互层。手动写入共用串行队列，入队推进 epoch；整图刷新等待队尾并丢弃过期响应，队列失败不阻断后续操作。Agent 通过服务端同一 mutation 用例写入，完成事件触发重新读取，而非把模型输出直接写入 atoms。

左侧保留节点/素材面板，中间为画布或故事板，右侧为可收起、可调宽的共享 Chat。节点编辑留在画布内。Chat 消息流使用既有 AI SDK 状态，不建立 Jotai 消息副本。Jotai 仅由 Canvas 消费，不升级为平台全局状态库或跨 MFE singleton；共享 Chat 保持原来的 Zustand 实现。

此选择依据是迁用现有 Canvas 原子状态与交互不变量；不以状态库宣称 AI-native。Jotai 的 [Provider](https://jotai.org/docs/core/provider) 与 [Store](https://jotai.org/docs/core/store) 支持子树隔离，服务端版本校验承担多调用方并发边界。

## 实现与迁移策略

Canvas 保留 Go，以复用 AgentFrame 已验证的领域规则。跨服务调用继续通过 OpenAPI 生成客户端；前端共用 `packages/chat`，后端不复制 `ToolLoopAgent`。本次不规划第二语言实现，也不建立为未来迁移准备的抽象层。

项目处于 demo 阶段且 Canvas 数据无需保留。首次安装 migration 直接更新为最终 schema，开发环境重装；删除旧 HiBot 表、简化模型、旧 DTO、旧 facade、双读双写和 fallback。任何时刻只有一个权威实现和一份协议。

官方依据：[ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent) 提供工具循环；[Chat transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) 将 UI 会话与传输分离。选择保留独立 Canvas 服务属于本仓库的数据与权限边界决策，并非 SDK 强制要求。

## 验证状态

迁移已按最终协议完成接管。Canvas 启动入口只装配迁入的领域与应用服务；旧 HiBot/Agent runtime、Canvas 私有配置、数据升级器、读时修复和旧前端 facade 均已删除。项目、Canvas、节点、资源、生成、审核、归档走同一套 OpenAPI handler；浏览器入口与内部 service-auth 入口共享业务实现。

2026-09-22 已在清空并重建的本地数据库上完成真实 HTTP 验收：IAM 登录、Admin 创建项目、创建 Canvas、创建及读取文本节点、资源统计、归档分页、旧配置路由 404、Chat Canvas 会话两次 get-or-create 返回同一 ID、删除项目后 Canvas 404 且聊天历史仍可读。创建节点路径同时验证未知旧字段会返回 400，最终协议无兼容吞字段。`just sync`、裸 `just lint`、裸 `just build`、Canvas Go test/vet 与前端 typecheck 均通过。

Provider 的真实付费图片/视频/文本成功结果仍取决于部署环境配置有效凭据，不属于本地无凭据验收条件；业务调度、状态收敛和失败路径已经接入 monorepo Admin/Executor/Knowledge。
