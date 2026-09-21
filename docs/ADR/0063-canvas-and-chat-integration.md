# ADR 0063：Canvas 业务能力与统一 Chat runtime

状态：提议中
日期：2026-09-20

## 决定

前后端应用名均为 canvas。Canvas 保留 Go 领域规则，拥有项目、图、资产关系及生成结果；Chat 拥有会话和 AI SDK ToolLoopAgent，工具经生成契约的内部 HTTP client 调用 Canvas。前端统一使用 design-system 与 lucide，不迁入 Arco、Garfish 或旧物料库。

手动与 Agent 写入调用同一 application 用例。内部身份包含服务身份与用户/组织，服务 token 不代替项目权限。画布操作以预期 revision 和幂等 key 防止冲突与重放。画布绑定在会话持久化，不能从模型参数取得；每次 run 和每次操作重新校验权限。

Canvas 素材独立于会话存活；删除会话不能删除被画布持有的内容。旧 Up 接入现有 knowledge 存储的正式 HTTP 能力，不跨库、不跨服务导入实现。模型配置归 admin，直接 provider 调用不再依赖 AIGW；持久任务复用 executor。

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

## 语言演进

第一版保留 Go 以复用既有领域规则、降低功能迁移成本；长期方向是 Canvas 服务统一到 TypeScript。语言统一方便维护工具输入、Provider 调用、异步任务和应用用例，但不改变数据所有权：Chat 仍负责会话与唯一 Agent runtime，Canvas 负责画布、项目与资产业务关系，admin 负责运营配置。

跨服务调用继续通过 OpenAPI 生成的内部 HTTP SDK。安装 SDK 是获得类型和调用入口，并不把远端服务变成本地函数。即使 Canvas 改为 TS，也不从 Chat 导入 Canvas 服务实现或直接访问其数据库。前端共用 packages/chat；后端不为统一语言复制 ToolLoopAgent。

替换顺序为：先完成 Go 版本功能与数据迁移，再以相同契约逐模块替换 Canvas application 和持久化实现，最后退役 Go 服务。每次切换只能有一个权威写入方；保留 ID、scope、revision、幂等记录、资产引用和在途任务语义。数据库迁移与 ORM 切换单独评估，不能因语言变化重建数据。只有确有本地复用需求时才提取独立纯领域包，不预先搭建跨语言适配框架。

官方依据：[ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent) 提供工具循环；[Chat transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) 将 UI 会话与传输分离。选择保留独立 Canvas 服务属于本仓库的数据与权限边界决策，并非 SDK 强制要求。

## 验证状态

现有 ToolCatalog、tool manifest 和 UIMessage 流可扩展，Agent 不复制到 Canvas。源端 domain/canvas 的连线规则继续有效，TOP/AIGW/Up 适配层不属于目标运行契约。参考 Vercel ToolLoopAgent 与 WorkflowAgent 的运行边界，继续采用一个主 Agent 加 executor 的已有模式，不新增角色式 Agent 编排。

本 ADR 在全链路验证和迁移验收前保持提议中。执行缺口见 docs/plans/canvas-migration.md，不能把新建入口视为整体迁移完成。源数据保持，切换采用备份、显式 scope/身份映射、幂等转换和逐项业务不变量验收，不能利用 demo 规则丢弃已有数据。


## 当前落地边界

Canvas 新应用首次接入仅维护 `v1.0.0.sql` 建库版本。源结构事实以 `multix-app/migrations/mysql/3.1.0/schema.json` 及其版本链为准，目标为 PostgreSQL；不依赖 `.100` 环境连接，也没有执行源数据搬迁。当前建库还不是完整源 schema 的迁移结果。

文本生成由 Canvas 事务写入待派发记录，Executor 使用 generation ID 幂等启动 Workflow。Canvas 通过 Executor 原有状态 SSE 收敛任务；重启重新连接同一任务。成功文本保留历史，仅当目标节点版本仍与启动版本相符时自动应用；取消意图在本地持久化，迟到结果不覆盖节点。手动历史选用仍检查节点版本。

素材上传复用 Knowledge ObjectStore，Canvas 持有资产和 `CANVAS_NODE_ASSET` 引用；节点创建与 acquire 同事务，节点/画布/项目删除与 release 同事务。读取先校验项目权限与节点引用，不暴露任意 AssetID 读取口。上传对象以内容摘要幂等写入，数据库提交不明时不删除字节。当前没有物理 GC，资源 revision、生成媒体 owner 和 GC 清理仍是迁移缺口。

验证：本地接口验证了文本任务去重与 Provider 缺失时的持久失败回写，以及媒体上传、服务端类型检测、逐字节读取、重复上传、删除后的 404。未用真实付费模型验证成功生成，未进行浏览器交互验收。


资源库按源端 `resource` 领域规则迁入，支持角色/场景/道具/音频分类、创建编辑删除、素材上传与首个内容 revision。每个 ResourceAsset revision 通过 `RESOURCE_ASSET_REVISION / ResourceAssetID` 持有素材；独立复制到画布额外建立 `CANVAS_NODE_ASSET`。资源删除只释放资源 owner，画布独立副本继续可读。当前复制语义不是“跟随资源当前版本”；跟随绑定、换版与主素材切换仍待迁入，不以静态副本冒充。

资源链路 API 验证覆盖创建、上传、列表、预览、复制以及删除资源后独立副本仍可读。源 MySQL 当前版本链截至 `3.1.0.16`，最终 schema 包含 41 张业务表；尚未迁入的表与用途需逐项对照，不以目标表数相等代替业务验收。

## 图片生成

Canvas 的图片任务复用 AI SDK `generateImage` 和现有 `createProviderImageModel`，API 依据本地 ai/dist/index.d.ts 的 GenerateImagePrompt（文本及图片字节输入）与官方 https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-image。Executor 在单个不可自动重试的付费 step 内读取参考图、调用 Provider、上传不可变对象，仅持久化定位符。Knowledge 允许 Canvas 与 Executor 读写固定 Canvas namespace，任务入口限制 Canvas caller。生成历史以 CANVAS_GENERATION_OUTPUT 拥有资产，节点选中结果只是投影；删除节点、画布或项目释放历史 owner 并请求取消在途任务。CAS 防止后台结果覆盖更新后的节点。
