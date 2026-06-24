# chat service (TypeScript)

Conversation + agent runtime microservice. Consumes the knowledge service for
documents and artifacts; owns only `conversations` and `messages`.

## Owns
- DB tables: `conversations`, `messages`
- Agent runtime (Vercel AI SDK `streamText` + tools)
- Redis-backed SSE replay for in-flight agent runs
- HTTP API: `/conversations/*`, `/conversations/{id}/agents/run/stream`
- Externally: gateway `/api/chat-server/*`

## Agent tools
- `list_documents` / `read_document` — knowledge-base context (sliced reads)
- `analyze_image` — multimodal vision over an uploaded image (uses the
  run's `multimodal_provider_id`; fetches raw bytes from knowledge
  `/internal/documents/{id}/source`)
- `create_artifact` — single-call markdown/html deliverable → knowledge
- `append_artifact_chunk` — incremental builder for large deliverables
  (same filename across calls, final `done=true` persists)
- `web_search` — one public web lookup per run

Artifacts persist to knowledge; the model cites a `⟦artifact:N⟧` placeholder
that the runtime backfills to a `[16hex]` slot at turn end. `thinking` /
`reasoning_effort` map to openai-compatible `providerOptions.reasoningEffort`;
provider `extra_body` is merged as defaults via `transformRequestBody` (runtime
fields win).

## Does NOT own
- Document storage / MarkItDown conversion (→ knowledge service)
- User identity (→ iam / gateway headers)
- Model provider credentials (→ admin internal API)

## Entry points
- `src/index.ts` — Node HTTP server (`@hono/node-server`)
- `src/routes/*.ts` — HTTP handlers
- `src/services/agent-runtime.ts` — Vercel AI SDK agent loop
- `src/services/agent-streams.ts` — Redis SSE replay
- `src/gen-openapi.ts` — OpenAPI export (`just gen-openapi chat`)

## Commands (from `apps/backend/`)
- `just dev chat` — `pnpm dev` on port 8009
- `just lint chat` — `tsc --noEmit`
- `just gen-openapi chat` — writes `schemas/openapi/chat-server.json`
