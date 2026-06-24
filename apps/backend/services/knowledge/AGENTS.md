# knowledge service

User-owned document knowledge base: raw object storage, MarkItDown conversion,
and persistent artifacts. Chat consumes documents via internal HTTP; a future
knowledge MFE manages lifecycle independently of conversations.

## Owns
- DB table: `documents` (source uploads + agent artifacts, per user)
- Local filesystem object backend (demo / single-VPS)
- HTTP API: `/ingest/*` (public via gateway), `/internal/*` (service-to-service)
- Externally: gateway `/api/knowledge-server/*`

## Does NOT own
- Conversations / messages (→ chat service)
- LLM agent runtime (→ chat service)
- User identity verification (→ gateway / iam)

## Entry points
- `src/knowledge/main.py` — FastAPI app
- `src/knowledge/routers/*.py` — HTTP handlers
- `src/knowledge/services/*.py` — ingest, conversion, object store
- `src/knowledge/gen_openapi.py` — OpenAPI export

## Conventions
- Documents are user-scoped; `conversation_id` is an optional tag only (no FK).
- Deleting a chat conversation does NOT delete knowledge documents.
- Errors via `kernel.errors.*`, NEVER raw HTTPException.
