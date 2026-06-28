# chat service (TypeScript)

Conversation + agent runtime service. It owns conversation/message/run
observability in MySQL and consumes admin (providers) plus knowledge
(documents/artifacts) through `@backend/transport-ts`.

## Runtime contract

- The core agent is AI SDK v7 `ToolLoopAgent`; the POST request owns one run.
- `useChat.stop()` aborts that request. Propagate its `AbortSignal` into model,
  search, multimodal, and nested artifact model calls.
- Do not add pause/resume/replay state to the core chat path. Plans and messages
  are durable business context; a later user run continues from that context.
- `ask_user` is a client tool without `execute`. The browser supplies
  `addToolOutput`; AI SDK automatically starts the next request.
- Trace persistence is observability and must never fail generation.

## Tools and artifacts

- `update_plan` snapshots are persisted in native UIMessage tool parts.
- Markdown uses `create_artifact`.
- Large HTML uses `begin_artifact` → bounded `write_artifact_part` calls →
  `publish_artifact`. Knowledge/ObjectStore owns full content; chat history and
  traces redact HTML fragments.
- Artifact tools do not start nested agents/workflows. The main ToolLoopAgent
  waits for every server tool execution before its next step.
- `web_search` uses Tavily. `propose_memory` stages a candidate; user approval
  remains asynchronous in the memory panel.

## Boundaries

- No direct imports from another service.
- Service URLs, internal auth, DTOs and timeouts live in transport-ts clients;
  chat-local clients only add cache/error mapping.
- User identity belongs to iam, provider configuration to admin, and document /
  artifact storage to knowledge.

## Entry points

- `src/routes/agents.ts` — run stream and trace routes
- `src/services/agent-runtime.ts` — request/context/persistence boundary
- `src/services/chat-agent.ts` — ToolLoopAgent construction
- `src/services/agent-tools.ts` — tool registry
- `src/gen-openapi.ts` — OpenAPI export

Run from `apps/backend`: `just lint chat`, `just build chat`,
`just gen-openapi chat`.
