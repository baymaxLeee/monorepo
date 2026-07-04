# ADR 0020: Feishu enterprise knowledge — runtime tool-based federated retrieval (no ingest)

## Status

Proposed. **Not implemented** (deferred by request). This ADR records the agreed
design and the grounded facts so the approach is not re-derived from memory when
implementation starts.

## Context

ADR-0019 built a local RAG knowledge base in `knowledge` (ingest → chunk →
embed → hybrid retrieve, scoped to `user_id`). That path is for documents users
upload *into our system*.

The new requirement is different: query the **enterprise knowledge base that
already lives in Feishu (Lark)** — Wiki spaces and cloud docs — from inside this
system, through the chat agent.

**Red line (hard product constraint): enterprise Feishu content MUST NOT be
persisted into our private store.** No ETL, no indexing, no embedding copy — a
second durable copy of company knowledge is forbidden (data-governance /
residency requirement). The data-egress boundary was explicitly chosen as
`no_persist`: transient use inside the LLM prompt for a single turn is
acceptable (same posture as ordinary chat), but a persistent copy is not.

This constraint is the whole reason the design below is the *opposite* of
ADR-0019's ingest pipeline.

### Grounded facts (verified against live Feishu docs 2026-07, not memory)

- Feishu ships an **official OpenAPI MCP** — `@larksuiteoapi/lark-mcp`
  (`github.com/larksuite/lark-openapi-mcp`, Beta) — wrapping Feishu APIs as MCP
  tools, including `wiki.v1.node.search`, `wiki.v2.space.getNode`,
  `docx.v1.document.rawContent`, `docx.builtin.search`. It supports
  `--token-mode auto|tenant_access_token|user_access_token` and a static
  `-u <user-token>`.
- Retrieval endpoints:
  - Search docs+wiki: `POST /open-apis/search/v2/doc_wiki/search` — 100/min,
    scope `search:docs:read`, tenant **or** user token; searches **the current
    user's visible docs** (so a user token yields per-user ACL for free). Filters
    by type: DOC / DOCX / SHEET / BITABLE / MINDNOTE / WIKI / FILE …
  - Search wiki nodes: `POST /open-apis/wiki/v2/nodes/search` — user token.
  - Get doc plain text: `GET /open-apis/docx/v1/documents/:id/raw_content` —
    5/s per app, scope `docx:document:readonly`, tenant or user token; 403 if the
    identity lacks doc permission; error `1770033` if raw content exceeds size.
  - Wiki node → real doc token: `GET /open-apis/wiki/v2/spaces/get_node`
    (100/min, `wiki:wiki:readonly`) returns `obj_token` + `obj_type`.
- OAuth v2 (user identity): authorize at
  `https://accounts.feishu.cn/open-apis/authen/v1/authorize`
  (`client_id`, `response_type=code`, `redirect_uri`, space-separated `scope`,
  `state`); exchange/refresh at
  `https://open.feishu.cn/open-apis/authen/v2/oauth/token`. `offline_access`
  scope is required to receive a `refresh_token`; the **`refresh_token` is
  single-use and rotates on every refresh** (must persist the new one each time).

## Decision

1. **Federated retrieval at runtime via an agent tool — no ingest, no index, no
   copy.** Chat's `ToolLoopAgent` (ADR-0011) gains Feishu retrieval tools
   (`feishu_search` + `feishu_read`), analogous to the existing `web_search` /
   `knowledge_search` builtins in
   `services/chat/src/agent/tools/builtins/`. The tool calls Feishu at request
   time; results enter only the current turn's context; **nothing is written to
   `knowledge` / pgvector**. This is deliberately the inverse of ADR-0019.

2. **Per-user identity via `user_access_token` (OAuth).** Retrieval runs as the
   requesting user, so Feishu enforces its **native per-document ACL** — we never
   mirror ACLs and never over-return. `search/v2/doc_wiki/search` is documented to
   scope to the current user's visible docs. (Recommended; app-identity fallback
   in Open decisions.)

3. **Credentials + OAuth live in `admin`** (management/config plane; same
   precedent as ADR-0014 for third-party credentials): `app_id`/`app_secret`
   (encrypted) + per-user OAuth tokens (encrypted) + an internal endpoint that
   returns a *currently valid* `user_access_token`, transparently handling the
   single-use refresh-token rotation. Chat fetches a token per request. The
   enterprise **content** is never stored — only access credentials are.

4. **OAuth endpoints behind the gateway**, hosted in `admin`
   (`/integrations/feishu/authorize` + `/integrations/feishu/callback`): browser
   → authorize → Feishu consent page → callback with `code` → exchange (v2) →
   store encrypted tokens → redirect back to the chat UI. The **only** step on
   Feishu's domain is the user tapping "consent" (unavoidable in any OAuth).

5. **Tool delivery: a custom AI SDK tool over the Feishu SDK/OpenAPI**
   (`@larksuiteoapi/node-sdk` in the TS chat service), injecting the per-request
   user token — chosen over mounting the official Lark MCP as-is because the
   MCP's static `-u` single-token model targets single-identity CLI/desktop, not
   a multi-user server. We still **follow the Lark MCP as the behavioral
   benchmark** (identical tool surface: doc_wiki search + docx raw_content + wiki
   node search) and may later re-expose our tool over MCP transport. (Open
   decision.)

6. **Retrieval shape.** `feishu_search(query, types?)` → `doc_wiki/search` →
   ranked hits (`title`, `token`, `obj_type`, `url`). `feishu_read(token, type)`
   → `docx raw_content` (or sheet/bitable readers) → plain-text snippet. The
   agent cites Feishu URLs so the user can open the source in Feishu. Exponential
   backoff on 429 / rate-limit (search 100/min, raw_content 5/s).

## Consequences

- Retrieval is Feishu's **keyword search, not semantic** — lower recall than
  ADR-0019's hybrid dense+BM25+rerank. This is the accepted cost of not indexing.
  If semantic quality becomes mandatory, the only compliant path is **in-tenant**
  embeddings; a persistent external copy stays forbidden.
- Latency: two hops (search + read) per query plus Feishu rate limits → slower
  than local pgvector; the agent should read only the top few hits.
- No offline availability; depends on Feishu uptime and per-user token validity.
- **LLM-egress caveat (implied by `no_persist`):** retrieved text still enters
  the LLM prompt each turn; with an external chat provider it transits that
  provider. Accepted under `no_persist`. If that ever becomes unacceptable, the
  fallback is an in-tenant model or a titles/links-only tool (agent never reads
  full text) — recorded, not built.
- New `admin` work only: Feishu app-credential CRUD + per-user OAuth
  (authorize / callback / refresh with single-use rotation) + encrypted token
  store. **No new `knowledge` / pgvector schema** (by design).
- Onboarding: each user authorizes once (per-user OAuth); a Feishu tenant admin
  must approve the app's read scopes (`search:docs:read`, `wiki:wiki:readonly`,
  `docx:document:readonly`, `offline_access`).

## Alternatives considered

- **ETL/index Feishu docs into our RAG (extend ADR-0019).** Rejected —
  **violates the red line** (persistent second copy + embeddings of enterprise
  content). The whole design is the deliberate opposite.
- **App identity only (`tenant_access_token`, app added as a space member).**
  Rejected as the primary path — cannot enforce per-user ACL (everyone sees
  whatever the app can), and `wiki/nodes/search` requires a user token. Retained
  as an optional "shared org space" fallback for a quick pilot (Open decisions).
- **Mount the official Lark MCP as-is.** Deferred — its static single-user `-u`
  token model does not fit multi-user per-request tokens; we mirror its tool
  surface in a custom tool and can expose via MCP later.
- **Hybrid (index for recall + live for freshness).** Rejected — the index half
  still persists content → red line.

## Open decisions (resolve before implementation)

- **Identity:** per-user OAuth (recommended) vs single app-tenant shared-space
  (simpler onboarding, no per-user ACL, limited wiki search) vs app-first-then-OAuth.
- **Tool delivery:** custom AI SDK tool (recommended) vs mounting the Lark MCP
  behind a per-user token broker.
- **Surface scope (phase 1):** Wiki only / Wiki + docx / all (sheet, bitable,
  mindnote).

## Plan-skill compliance

1. **Critical review** — ADR-0019's local-RAG shape is intentionally *not*
   reused; it conflicts with the red line and is re-derived from the `no_persist`
   constraint.
2. **Official grounding** — Feishu OpenAPI, OAuth v2, and the official Lark MCP
   were verified against live 2026 docs (URLs below), not memory.
3. **Benchmark** — official Lark MCP (tool surface) + Onyx/Danswer (enterprise
   connector pattern); we adopt the federated-tool half and reject the indexing
   half by constraint.
4. **Single-agent** — one chat `ToolLoopAgent` gains two tools; no new agent
   runtime, no persona/multi-agent theatre.
5. **Refactor decision** — additive (new tools + admin OAuth); `knowledge` RAG is
   untouched; there is deliberately no ingest path.

## Verification (when implemented)

Not implemented yet. When built: OAuth round-trip stores an encrypted token;
`feishu_search` / `feishu_read` return cited passages in chat for a doc the user
can see and 403/empty for one they cannot; assert nothing is written to
`documents` / `document_chunks`; `just lint` + `just sync` (new admin routes →
`@backend/transport-ts`).

## Sources (verified 2026-07)

- Official Lark MCP: `https://github.com/larksuite/lark-openapi-mcp` ·
  `https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_installation`
- Search docs/wiki: `https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/search-v2/doc_wiki/search`
- Docx raw content: `https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/raw_content`
- Wiki get_node: `https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node`
- OAuth authorize + token (v2): `https://open.feishu.cn/document/sso/web-application-end-user-consent/guide` ·
  `https://open.feishu.cn/document/authentication-management/access-token/refresh-user-access-token`
