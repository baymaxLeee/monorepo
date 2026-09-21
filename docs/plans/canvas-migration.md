# Canvas 迁移执行清单

目标：将 AgentFrame 用户端与管控端完整迁入 monorepo，前后端均命名 canvas；复用 IAM、存储、Provider、Chat runtime，禁止引入 Arco 与旧物料库。

- [ ] Canvas 服务、契约、IAM/gateway、项目与画布、手动/Agent 共用 mutation。
- [ ] Canvas 微前端与现有组件、图标、画布/故事板交互。
- [ ] Chat 会话绑定、内部 Canvas client、工具与会话面板。
- [ ] Admin 默认模型、权益、项目管理、权限配置。
- [ ] 素材上传、独立持有、引用/历史/GC、现有存储接入。
- [ ] Provider、executor、文本/图片/视频/分镜生成、取消/恢复/历史。
- [ ] 资源库、审核、匹配、导出、用量及配额。
- [ ] 存量数据转换、在途任务、恢复方案和不变量验收。
- [ ] 生成、静态检查、构建、API 验证、部署组成与文档 review。

源仓库保持只读。未完成的能力不得标记已迁移，未验证部署不替换旧环境。真实环境切换与不可逆数据操作另行在具体方案就绪后确认。

语言策略：第一版保留 Go，长期将 Canvas 后端统一到 TS；当前功能迁移不同时开展全量语言重写。OpenAPI 与内部 HTTP SDK 是替换边界，共享 Chat UI 和唯一 ToolLoopAgent 不随 Canvas 实现语言变化。后续 TS 替换必须保留数据与任务语义，并逐模块切换唯一写入方，详见 ADR 0063。

## 前端还原验收

以源端现行组件、交互文档和用户截图为基线，不以简版入口代替迁移。基础原语改用 monorepo design-system / lucide；布局、操作顺序和状态保留。

- 项目与剧集：封面卡片、搜索排序、分页、创建/编辑/删除确认、项目内视频创作与资产库导航。
- Studio：左侧节点/资产双页签与分类检索，中间点阵画布、节点端口/连线、多选拖动、快捷操作、编辑浮层和视图切换。
- 用户截图右侧为可折叠、可调宽的 Chat 会话栏；共用 packages/chat，不占用节点编辑浮层的位置。
- 故事板：分镜顺序、选择、编辑、生成/取消、历史选版、预览播放和时间线；离开编辑前保存，失败保留草稿。
- 素材：角色/场景/道具/音频分类、搜索、上传、物化、引用、详情与审核状态。
- 管控：默认模型参数、项目管理与授权、权益配置、用量导出。
- 导出：批量导出、记录、进度、失败恢复。

当前已运行 install/up/dev、前三个前端构建与核心静态检查；这些仅证明组合启动，不代表上述 UI 或业务已完成。

Canvas 状态方案已按用户确认采用 Jotai：页面 Provider、规范化正式图、派生故事板、按节点订阅与串行写入协调器。Chat 不建立第二份消息状态。


## 已接通的增量

- 文本节点 → Canvas 生成记录 → Executor Workflow → Admin Provider；支持历史、取消、CAS 回写与 Chat 调用。真实 Provider 成功结果仍待验证。
- 本地图片/视频/音频上传 → Knowledge 独立对象命名空间 → Canvas Asset/引用账本 → 节点预览；不依赖 Chat 会话生命周期。素材资源库、媒体生成、审核和物理 GC 尚未接通。
- 从源端直接迁入领域模块和生成输入 resolver；resolver 已用于文本生成，保留 mention 与输入顺序语义。
- 用户授权按模块在 monorepo 本地提交；不 push。源 schema 基准改为 multix-app 最新 MySQL schema，目标 PostgreSQL，Canvas migration 合为 v1.0.0。

- 资源库已接通四种分类、创建/重命名/删除、上传素材及独立复制到画布，左栏新增节点/资产页签。资源换版、跟随引用、审核、生成草稿仍待迁移。

## Tenant / Workspace（当前实施）

用户确认 monorepo 全量移除 Org 概念：Tenant 是公司，Workspace 是公司内的组织工作空间；无存量兼容与滚动升级窗口，直接整体改造。IAM 增加公司管理与工作空间归属，签发双层 scope；Gateway、Canvas、Chat、Admin、Knowledge、Executor 和生成客户端统一采用新契约。Canvas 初始 migration 仍保持单版本。

已验证公司/工作空间创建和切换、Canvas/Chat 跨空间及跨租户拒绝、Gateway 清除伪造 scope 头；全仓 lint/build/sync 与本地 migration/up/dev 通过。IAM 原 char(26) ID 的补空格破坏会话切换，已统一 varchar(26)。后续继续检查 Knowledge 原先仅按 user_id 授权的接口，不能把字段迁移当成所有资源的隔离验收。

- 图片生成已连接 AI SDK generateImage → Executor Workflow → Knowledge 独立对象 → Canvas 生成输出账本与选版；参考图与参数在提交时冻结，复用源端分辨率/画幅换算。Chat 使用 generate_canvas_node 统一发起文本或图片任务。已验证实际任务派发、幂等与失败回写；本地无启用 Provider，真实出图和成功回写未验收。

- 视频节点已接独立 Executor Workflow：参考素材/首尾帧、取消、结果对象持有和历史选版；Chat 同一工具支持三种生成节点。本地已验证派发、幂等、失败回写，真实模型成功结果未验收。
