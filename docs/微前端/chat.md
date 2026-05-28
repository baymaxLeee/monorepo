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
- 发送消息走 `streamChatMessage(conversationId, { content }, { onChunk })`。
  这是前端唯一一处直接 `fetch`+`ReadableStream` 的封装，集中在
  `packages/api/src/chat-server.ts`，业务侧（MFE）只看到 `onChunk` 回调。

## 状态管理

- 会话与消息列表是页面级 `useState`（请求结束后从服务端回填权威 id /
  时间戳）。
- 发送过程中的 "锁" 放在私有 zustand store `useChatStore.sendingConversationId`，
  避免重复提交。
- 跨 MFE 通信走 `runtime` 事件总线（当前未启用，后续接入 admin 已发布的
  bot 触发对话时再补）。

## 注意事项

- 严禁 `import` 任何其它 MFE。
- 严禁绕开 `api` 直接 fetch；SSE 已经在 `api` 内封装。
- Tailwind/CSS 由 platform host 注入，remote 不打 CSS。
