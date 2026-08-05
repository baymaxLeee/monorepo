# chat — Conversation Micro-frontend

Owns `/platform/chat/*` and is backed by `apps/backend/services/chat`.

## Boundaries

- Chat uses AI SDK `useChat` + `DefaultChatTransport` and native UIMessage
  parts. Reconnection replays that same protocol; do not add a parallel one.
- The UIMessage stream is a cross-stack contract. Before adding a custom
  `data-*` part / `onData` field, read `schemas/streaming/chat-uimessage-stream.md`
  and register it there. Reuse official parts first (`text`/`reasoning`/`tool-*`/
  `file`/`source-*`, message `metadata`); custom `ChatUIDataTypes` entries are
  only for data no official part covers.
- After persisted messages load, call `resumeStream()` once per conversation.
  Refresh and route changes disconnect only the subscriber. Stop calls both
  `useChat.stop()` and the server run cancellation endpoint.
- Do not add sessionStorage message/stream state; Redis is the replay buffer.
- Client tools answer with `addToolOutput` and
  `lastAssistantMessageIsCompleteWithToolCalls`.
- CRUD goes through `@repo/api`. The transport's custom fetch is only for the AI SDK
  streaming request and response metadata.
- Never import another MFE (enforced by `turbo boundaries`); cross-MFE coordination uses `@repo/runtime`.
- Runtime singletons come from platform's Module Federation shared scope.

## Layout

- `src/router/index.tsx` — relative route tree exposed as `./routes`
- `src/pages/chat/Chat.tsx` — chat and tool continuation
- `src/pages/layout/ChatLayout.tsx` — conversation shell and artifact panel
- Route entry modules export the named `Component` expected by `route.lazy`
- `src/components/ChatMessageView.tsx` — native message-part rendering
- `src/components/ChatArtifactCard.tsx` — persisted plan / artifact card UI
- `src/components/ChatTracePanel.tsx` — run observability
- `src/store/useChatStore.ts` — private UI state
