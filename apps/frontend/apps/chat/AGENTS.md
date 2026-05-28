# chat — Conversation Micro-frontend

Manages the "对话" domain on the frontend. Backed by
`apps/backend/services/chat`.

## Boundaries

- Owns routes under `/platform/chat/*` when mounted by platform
- `http://localhost:3005/` is not a supported page; this app only serves
  federation assets
- API calls go through `api` ONLY (no raw fetch). The SSE streaming endpoint
  is wrapped by `streamChatMessage()` exported from `api`.
- NEVER import from `admin`, `mfe-scene`, or any other MFE
- For cross-MFE coordination, use `runtime` event bus
- Runtime-critical dependencies (`react`, `react-dom`, `react-router-dom`,
  `zustand`, platform infra packages) are provided by platform via
  Module Federation shared scope; chat must not bundle standalone fallbacks
- `components` and `api` are normal workspace dependencies, not MF-shared
  singletons; keep tree-shaking intact

## Exposes (via Module Federation)

- `./App` — main route component (mounted by platform)

## Layout

- `src/App.tsx` — `TooltipProvider` + `useRoutes(routes)`
- `src/router/index.tsx` — `ChatLayout` + nested routes
- `src/pages/ChatLayout.tsx` — conversation rail (left) + outlet (right)
- `src/pages/ConversationListPage.tsx` — empty-state landing
- `src/pages/ChatRoomPage.tsx` — message stream with SSE incremental render
- `src/store/useChatStore.ts` — local UI state (zustand, private store)

## When to extract a component

- Single-use → keep in `src/components/`
- Used by 2+ MFEs → promote to `components`
