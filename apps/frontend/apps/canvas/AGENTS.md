# Canvas 微前端

- 负责 `/platform/canvas/*`，使用 monorepo 的 design-system、lucide 和 OpenAPI 生成客户端；不引入 Arco 或旧物料库。
- Studio 以 `ProjectID + CanvasID` 为 key 挂载 Jotai Provider；不得使用默认全局 Store 保存画布业务状态。
- `src/pages/studio/store/canvasGraph.ts` 是当前页面正式图的唯一事实投影，只有 `CanvasReplica` 的 HTTP 快照安装与 SSE reducer 可以写入。故事板从视频节点派生，素材/节点面板不得另存正式图副本。XYFlow 仅保留拖动、选择等展示状态。
- `src/pages/studio/store/mutations.ts` 串行发送命令；请求层等待 `X-Canvas-Cursor` 被 SSE 投影观察后完成。普通命令及 Chat 完成不得回填正式状态或重新拉图。`getCanvasGraph` 保留为首次加载与异常恢复入口，旧快照不得覆盖新 cursor。参见 `schemas/streaming/canvas-events.md`，验证 `just test frontend/canvas` 与 `just test frontend/@repo/api`。
- 切换节点或视图前完成编辑；失败保留草稿与当前编辑器。正式 revision 只来自快照/SSE；组件草稿不写入正式 Store。
- Chat 放在画布右侧可收起、可调宽面板，复用 `@repo/chat`；UIMessage、流恢复和工具审批由共享 Chat/AI SDK 管理，不复制到 Jotai。
- 页面交互以当前产品需求和用户验收截图为准；重构基础组件不得删减既有交互。
