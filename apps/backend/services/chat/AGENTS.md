# chat service (TypeScript)

Conversation + durable agent runtime microservice. Consumes the knowledge service
for documents and artifacts; owns conversations/messages plus business run
observability tables.

## Owns
- DB tables: `conversations`, `messages`, `agent_runs`, `agent_steps`,
  `agent_tool_calls`, `user_memories`
- Agent runtime (`@ai-sdk/workflow` `WorkflowAgent` hosted by Workflow DevKit)
- Workflow stream resume via `WorkflowChatTransport`; Redis is not the replay
  source for agent streams
- HTTP API: `/conversations/*`, `/conversations/{id}/agents/run/stream`,
  `/conversations/{id}/agents/run/stream/{workflowRunId}/stream`,
  `/agents/run/cancel`
- Externally: gateway `/api/chat-server/*`

## Agent tools
- `list_documents` / `read_document` — knowledge-base context (sliced reads)
- `analyze_image` — multimodal vision over an uploaded image (uses the
  run's `multimodal_provider_id`; fetches raw bytes from knowledge
  `/internal/documents/{id}/source`)
- `create_artifact` — brief-driven markdown/html deliverable; tool runs a dedicated
  `streamText` generation, normalizes content, then persists to knowledge
- `update_artifact` — brief-driven in-place artifact revision; rewrites an existing
  knowledge artifact and keeps the same `document_id`
- `web_search` — public web lookup via Tavily

Artifacts persist to knowledge; tool results expose `document_id` for the UI.
Workflow completion writes assistant messages server-side so browser disconnects
do not own final persistence. Completion text must never be empty; if the
model does not produce final text, `src/services/chat-agent.ts` derives a
deterministic summary from successful artifact tool results. `thinking` /
`reasoning_effort` map to
openai-compatible `providerOptions.reasoningEffort`; provider `extra_body` is
merged as provider options by the workflow-serializable admin provider model.
Do not pass `@ai-sdk/openai-compatible` models directly across workflow step
boundaries: their function-valued config is dropped during workflow
serialization.

Current migration note: the durable WorkflowAgent host is active for model
streaming/resume/cancel. All workflow tools (`list_documents`, `read_document`,
`web_search`, `create_artifact`, `update_artifact`, `analyze_image`) run inside
workflow-safe `'use step'` functions. `ask_user` is a client-side tool with no
`execute` function; the frontend must render its tool card and resume the agent
with `addToolOutput`. Token-by-token artifact preview during generation and
approval tools remain follow-up parity work.

## Does NOT own
- Document storage / MarkItDown conversion (→ knowledge service)
- User identity (→ iam / gateway headers)
- Model provider credentials (→ admin internal API)

## Cross-service clients
- Chat calls admin/knowledge through `@backend/transport-ts` from
  `apps/backend/libs/transport-ts`; do not add raw service URL `fetch()` calls
  in chat.
- `src/clients/admin.ts` and `src/clients/knowledge.ts` are chat-local facades
  for cache and error mapping only. The HTTP paths, internal token injection,
  timeout handling, and DTO shapes live in the transport client SDK.
- Workflow code may only call these clients from `'use step'` functions; the
  workflow sandbox itself has no network/Node access.

## Entry points
- `src/index.ts` — Nitro-hosted Hono app export
- `src/routes/*.ts` — HTTP handlers
- `src/services/agent-runtime.ts` — route-facing Workflow run helpers
- `src/services/chat-agent.ts` — WorkflowAgent workflow function; keep this
  module free of Node-only static imports
- `src/gen-openapi.ts` — OpenAPI export (`just gen-openapi chat`)

## Commands (from `apps/backend/`)
- `just dev chat` — `pnpm dev` on port 8009
- `just lint chat` — `tsc --noEmit`
- `just gen-openapi chat` — writes `schemas/openapi/chat-server.json`
