# Canvas 微前端

- 负责 `/platform/canvas/*`，使用 monorepo 的 design-system、lucide 和 OpenAPI 生成客户端；不引入 Arco 或旧物料库。
- Studio 以 `ProjectID + CanvasID` 为 key 挂载 Jotai Provider；不得使用默认全局 Store 保存画布业务状态。
- `src/store/graph.ts` 是当前页面正式图的唯一事实投影。故事板从视频节点派生，素材/节点面板不得另存正式图副本。XYFlow 仅保留拖动、选择等展示状态。
- `src/store/mutations.ts` 串行处理手动写入。入队推进 epoch，整图刷新等待稳定队尾；旧读取不得覆盖新写入。服务端仍通过 revision 和 operation ID 处理跨窗口及 Agent 并发。
- 切换节点或视图前完成编辑；失败保留草稿与当前编辑器。响应以服务端 revision 回填，不自行递增。
- Chat 放在画布右侧可收起、可调宽面板，复用 `@repo/chat`；UIMessage、流恢复和工具审批由共享 Chat/AI SDK 管理，不复制到 Jotai。
- 页面交互以当前产品需求和用户验收截图为准；重构基础组件不得删减既有交互。
