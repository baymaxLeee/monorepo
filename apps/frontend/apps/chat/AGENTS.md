# chat — Conversation Micro-frontend

Owns `/platform/chat/*` and is backed by `apps/backend/services/chat`.

## Boundaries

- Chat uses AI SDK `useChat` + `DefaultChatTransport` and native UIMessage parts. Web and Electron render the same cloud routes, history and inspectors. Electron's new-conversation editor selects execution location and native project. Its Chat sidebar groups local threads by workspace above a combined local and cloud history ordered by last update. Both views share the conversation row and action menu. A created local thread uses the `/local/:id` controller with the shared `ConversationSessionView`, `ChatStream`, `ChatPrompt` and composer controls. Do not add a second session frame, workspace/file sidebars or a Desktop-only inspector.
- The UIMessage stream is a cross-stack contract. Before adding a custom `data-*` part / `onData` field, read `schemas/streaming/chat-uimessage-stream.md` and register it there. Reuse official parts first (`text`/`reasoning`/`tool-*`/ `file`/`source-*`, message `metadata`); custom `ChatUIDataTypes` entries are only for data no official part covers.
- After persisted messages load, call `resumeStream()` only when the authoritative detail has an active run. `204 active-detached` retries the lightweight stream GET; `204 idle` hydrates the PostgreSQL journal once. Refresh and route changes disconnect only the subscriber. Stop calls both `useChat.stop()` and the server run cancellation endpoint.
- Do not add sessionStorage message/stream state or Redis replay. The in-process active hub is a disposable live projection; PostgreSQL journal is the recovery authority.
- Client tools answer with `addToolOutput` and `lastAssistantMessageIsCompleteWithToolCalls`.
- CRUD goes through `@repo/api`. The transport's custom fetch is only for the AI SDK streaming request and response metadata.
- Never import another MFE (enforced by `turbo boundaries`); cross-MFE coordination uses `@repo/runtime`.
- Runtime singletons come from platform's Module Federation shared scope.

## Layout

- `src/router/index.tsx` — relative route tree exposed as `./routes`
- Web and Electron cloud routes render the same `ConversationSessionView`, `ChatStream` and `ChatPrompt`. The Desktop new-conversation shell composes the same `PromptInput` into the native context-bar layout; its `+` picker uses the desktop bridge for ordinary file paths and native inline image parts for vision. Cloud creation uses the Conversation/Storage upload path.
- `src/pages/chat/Chat.tsx` — route wrapper for `@repo/ai-elements/conversation` ChatSession
- `src/pages/local/` — Desktop-only local transport/controller; it injects native runtime state into the shared session UI and is not a parallel product shell
- `src/pages/layout/ChatLayout.tsx` — three-region composition only; no message, list or preview-content subscriptions
- `src/components/ChatPanels.tsx` — shadcn Sidebar/Resizable layout; only visibility changes may cross region boundaries
- `src/components/ChatConversationSidebar.tsx` / `hooks/useConversationHistory.ts` — conversation CRUD and title updates, owned by the left sidebar
- `src/components/ChatInspector.tsx` — the single right-sidebar surface for cloud Artifact/video previews
- `src/components/ChatAuxiliaryPanels.tsx` — lazy memory/trace sheets; closed panels do not subscribe to content updates
- `packages/ai-elements/src/Conversation/components/ChatStream.tsx` — the only high-frequency SDK subscriber; do not lift messages into the shell, composer or app store
- `packages/ai-elements/src/Conversation/components/ConversationSessionView.tsx` — the shared cloud session frame; route controllers inject state and composer behavior without replacing its header or stream UI
- Route entry modules export the named `Component` expected by `route.lazy`
- `packages/ai-elements/src/Conversation/components/ChatMessageView.tsx` — native message-part rendering
- `packages/ai-elements/src/Conversation/lib/artifact-output.ts` — artifact tool-output parsing for derived todo status
- `src/components/ChatTracePanel.tsx` — run observability
- `@repo/ai-elements/conversation/store/useChatStore` — shared conversation UI implementation; each remote keeps its own bundle instance
