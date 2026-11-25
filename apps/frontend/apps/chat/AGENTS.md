# Chat conversation MFE

Chat owns `/platform/chat/*` and the product UI backed by the Chat and Runtime
services. Web and Electron reuse the same cloud routes, history, session frame,
composer, transcript and inspectors; do not create a second Desktop product shell.

- Use AI SDK `useChat`, `DefaultChatTransport` and native UIMessage parts. Custom
  `data-*`/`onData` fields must follow
  [`schemas/streaming/chat-uimessage-stream.md`](../../../../schemas/streaming/chat-uimessage-stream.md).
- After persisted messages load, resume only an authoritative active run.
  `active-detached` retries lightweight stream GET; `idle` hydrates the PostgreSQL
  journal once. Refresh/route changes detach only the subscriber; explicit Stop
  also calls the server cancellation endpoint.
- PostgreSQL journal is recovery authority. Do not add sessionStorage message
  state, Redis replay or another client stream log.
- Client tools settle with AI SDK `addToolOutput` and the official completion
  predicate. CRUD uses generated API clients; custom fetch is limited to AI SDK
  stream transport and response metadata.
- Conversation stream rendering is the high-frequency SDK subscriber. Shell,
  panels, composer and app stores consume only the smallest derived state; do not
  lift full messages out of the transcript boundary.
- Route controllers may inject local/cloud runtime state into the shared session
  composition, but they do not replace its header, transcript, composer or
  approval behavior.

Run `just test frontend/chat` and `just test frontend/@repo/ai-elements`; verify
the Chat build when routes, federation exports or shared CSS inputs change.
