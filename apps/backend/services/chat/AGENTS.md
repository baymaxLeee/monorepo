# chat service

The chat (对话) microservice. Manages conversation lifecycle and streams LLM
responses back to clients over SSE.

## Owns
- DB tables: `conversations`, `messages`
- HTTP API: `/conversations/*` internally; externally exposed by gateway as
  `/api/chat-server/conversations/*`
- LLM upstream: any OpenAI-compatible HTTP endpoint
  (`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`). Falls back to an
  echo mock when no key is configured so the demo always runs.

## Does NOT own
- User identity (→ iam service)
- Bot definitions (→ admin service)
- Audit log (→ audit service via events, future)

## Entry points
- `src/chat/main.py` — FastAPI app
- `src/chat/routers/*.py` — HTTP handlers (`/conversations`, `/messages`,
  `/healthz`)
- `src/chat/services/conversations.py` — conversation CRUD orchestration
- `src/chat/services/messages.py` — user/assistant message persistence and
  streaming orchestration
- `src/chat/services/llm.py` — OpenAI-compatible client + mock fallback
- `src/chat/crud/*.py` — persistence operations
- `src/chat/models/*.py` — SQLAlchemy ORM table models
- `src/chat/schemas/*.py` — Pydantic request/response schemas
- `src/chat/gen_openapi.py` — OpenAPI export (`just gen-openapi chat`)

## Conventions
- Routers are thin: request/response wiring only. SSE routes still call into
  the service layer for any DB writes.
- Business rules live in `services/`.
- DB access lives in `crud/`; routers never touch SQLAlchemy directly.
- Pydantic API shapes live in `schemas/`; SQLAlchemy table definitions live in
  `models/`.
- Keep business resources separated end-to-end. `conversation` and `message`
  each own their own `models/`, `schemas/`, `crud/`, `services/`, `routers/`.
- Errors via `kernel.errors.*`, NEVER raw HTTPException.
- The streaming endpoint MUST persist the user message before the first
  upstream token and persist the full assistant message in a single commit
  after the stream completes (or mark `status=failed`).
