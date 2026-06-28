# chat — Conversation Micro-frontend

Owns `/platform/chat/*` and is backed by `apps/backend/services/chat`.

## Boundaries

- Chat uses AI SDK `useChat` + `DefaultChatTransport` and native UIMessage
  parts. Do not add a parallel SSE implementation.
- The primary control is Send/Stop. Stop calls `useChat.stop()`; there is no
  pause/resume/sessionStorage replay state.
- Client tools answer with `addToolOutput` and
  `lastAssistantMessageIsCompleteWithToolCalls`.
- CRUD goes through `api`. The transport's custom fetch is only for the AI SDK
  streaming request and response metadata.
- Never import another MFE; cross-MFE coordination uses `runtime`.
- Runtime singletons come from platform's Module Federation shared scope.

## Layout

- `src/pages/Chat.tsx` — chat, tool continuation, artifact panel
- `src/components/ChatMessageView.tsx` — native message-part rendering
- `src/components/ChatPlanCard.tsx` — persisted plan UI
- `src/components/ChatTracePanel.tsx` — run observability
- `src/store/useChatStore.ts` — private UI state
