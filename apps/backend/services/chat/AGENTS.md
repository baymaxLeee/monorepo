# chat service (TypeScript)

Conversation + agent runtime service. It owns conversation/message/run
observability in MySQL and consumes admin (providers), knowledge
(documents/artifacts), and executor (durable background tasks) through
`@backend/transport-ts`.

## Runtime contract

- The core agent is AI SDK v7 `ToolLoopAgent`; one POST creates one run.
- Browser disconnect only drops an SSE subscriber. Redis retains the native
  UIMessage SSE so `useChat.resumeStream()` can attach through the GET route.
- Stop uses the run cancellation endpoint. Propagate the server-owned run
  `AbortSignal` into model, search, multimodal, and nested artifact model calls.
- Replay is a transport concern only: never model it as ToolLoopAgent state or
  claim process-crash resume. Plans and messages remain durable business context.
- `ask_user` is a client tool without `execute`. The browser supplies
  `addToolOutput`; AI SDK automatically starts the next request.
- Trace persistence is observability and must never fail generation.

## Tools and artifacts

- `update_plan` snapshots are persisted in native UIMessage tool parts.
- `write_file`/`edit_file` handle both Markdown and HTML. Markdown runs
  synchronously in this tool call (a single `streamText`, no durability
  needed). **HTML dispatches to the `executor` service as a non-blocking
  background task** (`agent_task_执行时服务` plan, Phase 2) — the tool call
  returns immediately with `{ status, task_id }`; the ToolLoopAgent does not
  wait for generation to finish. The frontend polls
  `GET /conversations/:id/tasks/:taskId` (proxied to executor) and renders the
  artifact card once the task completes. Knowledge/ObjectStore owns full
  content; chat history and traces never carry HTML fragments.
- `run_command` (`validate_html`/`inspect_layout`) inspects an already
  *published* HTML artifact; it stays local to chat since it needs no LLM
  call and no durability.
- Cancelling a chat run does **not** cancel an in-flight executor task it
  already dispatched — that task is durable background work by design and
  outlives the run/turn that started it, the same way a Cursor/Codex
  background agent keeps running after you stop watching it.
- `web_search` uses Tavily. `create_memory`/`update_memory` stage a candidate;
  user approval remains asynchronous in the memory panel.

## Boundaries

- No direct imports from another service.
- Service URLs, internal auth, DTOs and timeouts live in transport-ts clients;
  chat-local clients only add cache/error mapping.
- User identity belongs to iam, provider configuration to admin, and document /
  artifact storage to knowledge.

## Entry points

- `src/routes/agents.ts` — run stream and trace routes
- `src/agent/runs/run.ts` — request/stream/persistence orchestration
- `src/agent/agents/tool-loop.ts` — ToolLoopAgent implementation
- `src/agent/tools/catalog.ts` — built-in tools and run-scoped extension assembly
- `src/agent/context/projector.ts` — bounded model context projection
- `src/agent/README.md` — module boundaries and extension rules
- `src/gen-openapi.ts` — OpenAPI export

Run from `apps/backend`: `just lint chat`, `just build chat`,
`just gen-openapi chat`.
