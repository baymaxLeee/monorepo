# chat MFE

对话域的 micro-frontend，挂载在 platform 的 `/platform/chat/*`。后端是
`apps/backend/services/chat`。

## 路由

- `/platform/chat` → 重定向到 `/platform/chat/conversations`
- `/platform/chat/conversations` — 欢迎页 / 引导新建会话
- `/platform/chat/conversations/:id` — 聊天室；含消息时间线 + 输入框
- 左侧 `ChatLayout` rail 渲染会话列表（新建 / 切换 / 删除）

## Module Federation

- Remote 名：`mfe_chat`
- 端口：`3005`
- 暴露：`./App`（`src/App.tsx`）
- Shared 依赖：`apps/frontend/mf-shared.mjs` 中的 host 单例
  （react / react-dom / react-router-dom / zustand / runtime / shared / observability）
- `components` 与 `api` 是普通 workspace 依赖，不进 MF shared scope

## 与后端的衔接

- 普通 CRUD 走 `api.fetchConversations` / `createConversation` /
  `fetchConversation` / `deleteConversation`。
- 聊天框附件走 `api.uploadConversationDocument(conversationId, file)`，由
  chat-server 使用 Microsoft MarkItDown 转成 Markdown，并以 `source` 文档写入
  当前会话。
- 发送消息走 `api.streamConversationAgent(conversationId, input, { onEvent })`。
  SSE 封装集中在 `packages/api/src/chat-server.ts`，业务侧（MFE）只消费
  `message` / `step` / `card` 三类事件：`message` 渲染助手主回复，`step`
  渲染 runtime 调用模型/工具/代码执行状态，`card` 渲染模型决定生成的产物卡片。
  当有附件时，MFE 先上传生成会话文档，再把 `document_ids[]` 传给 agent run；
  用户气泡持久化 `[[chat-document:<id>]]` 标记并渲染成可点击文档 card。
- Agent 可读取当前会话历史和文档，并在需要输出文件时调用 `write_artifacts`
  写入新的 `artifact` 文档；是否展示 card 由后端 SSE `card` 事件决定，不和
  普通消息强绑定。
- 所有 `source` / `artifact` 文档 card 点击后都用现有
  `components/markdown-editor` 打开，可预览、二次编辑；Markdown 编辑走防抖自动
  保存回 chat-server，HTML artifact 以 iframe 占满剩余区域预览。

## 状态管理

- 会话与消息列表是页面级 `useState`（请求结束后从服务端回填权威 id /
  时间戳）。
- 会话文档列表随 `ConversationDetail.documents` 一起回填；完整 Markdown 内容按需
  通过 `fetchConversationDocument()` 懒加载，避免时间线一次性拉大。
- 发送过程中的 "锁" 放在私有 zustand store `useChatStore.sendingConversationId`，
  避免重复提交。
- 跨 MFE 通信走 `runtime` 事件总线（当前未启用，后续接入 admin 已发布的
  bot 触发对话时再补）。

## 注意事项

- 严禁 `import` 任何其它 MFE。
- 严禁绕开 `api` 直接 fetch；SSE 已经在 `api` 内封装。
- Tailwind/CSS 由 platform host 注入，remote 不打 CSS。
