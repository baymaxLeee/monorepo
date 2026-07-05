# ADR 0026: Oncall agent via org-scoped team knowledge and bot personas

## Status

Accepted.

## Context

The product needs an **oncall agent**: front-line staff describe a live
incident in chat and get a structured answer — root cause, triage steps,
verification steps, and repair recommendations — grounded in the team's
accumulated incident post-mortems and runbooks (an "experience RAG assistant").

The RAG stack (ADR-0019) and the `admin` bot/agent concept (ADR-0011,
ADR-0014) already existed, but three gaps blocked the oncall use case:

1. **Knowledge and bots were user-scoped.** Retrieval filtered by `user_id`,
   so one engineer's uploaded runbooks were invisible to teammates. The whole
   point of an oncall knowledge base is that it is *shared by the team*.
2. **Bots had no persona.** `Bot` / `ResolvedAgent` carried only a name and
   model providers; `buildAgentInstructions` never received an agent-specific
   instruction, so an "oncall RCA" behavior could not be configured by an
   operator — only hard-coded.
3. **No tenancy primitive.** There was no notion of a team/organization to
   scope shared knowledge to, and the user explicitly wanted a `workspace`-style
   team concept that stays **separate** from the future desktop-app "workspace".

The user asked for team knowledge sharing to be delivered now (not deferred),
so this change pulls the "team sharing" decision forward from ADR-0019's
future-work list and builds the minimum multi-tenancy foundation to support it.

## Decision

1. **Organization = the team tenancy primitive, owned by IAM.** Add
   `organizations` + `organization_members` tables (`iam` service, migration
   `v1.1.0.sql`). The access JWT `Claims` carry `org_id` (the caller's active
   org); login/refresh resolve the user's primary org; `AuthResponse.user` and
   `/me` return `orgId` / `orgName`. New registrations auto-join the seeded demo
   team org. We deliberately name it **organization** (团队), not `workspace`, to
   keep it decoupled from the desktop app's later `workspace` concept.

2. **Org propagates as a trusted edge header.** The gateway injects
   `X-Auth-Org-ID` from the verified JWT and strips any inbound copy, exactly
   like `X-Auth-User-ID` (ADR-0002). Downstream services read org from their
   `AuthContext`; they never trust a caller-supplied org.

3. **Team knowledge is org-scoped.** `documents` and `document_chunks` gain
   `org_id` (knowledge migration `v1.5.0.sql`, composite indexes, backfilled to
   `guest-org`). Ingest stamps `org_id`; `dense_search` / `sparse_search` and the
   user-facing document APIs filter by `org_id` (retaining `user_id` only for
   ownership/attribution). `RetrieveInput` and `/internal/retrieve` carry
   `org_id`, threaded from chat's `AuthContext` through the `knowledge_search`
   tool. A team now shares one knowledge base.

4. **Bots are org-scoped and carry a persona.** `bots` gain `org_id` +
   `system_prompt` (admin migration `v1.7.0.sql`; `org_id` tightened to
   `NOT NULL` in `v1.8.0.sql`). `create` stamps the org; `list`/`get` are
   visible to org members. `get_resolved` resolves model providers against the
   **bot's own org** (see decision 8) — a teammate using the shared oncall bot
   hits the team's shared providers, which is the whole point of a curated team
   bot. (An earlier draft resolved via the bot *owner's* user credentials; that
   hack is removed now that providers are themselves org-scoped.)

5. **Persona injection is a first-class instruction section.** chat's
   `getAgent` / `ResolvedAgent` carry `system_prompt`; it flows
   `routes/agents.ts` → `RunAgentInput.persona` → `createAgentRunResponse` →
   `buildAgentInstructions`, which emits an `<agent_persona>` section placed
   **after** the base instructions and mode instructions. The persona defines
   role/format but explicitly does not override the safety and tool-usage rules
   above it.

6. **The oncall RCA persona ships as a seeded bot.** A demo bot `bot-oncall`
   (published, owned by the demo super-admin, org `guest-org`) is seeded with a
   four-section Chinese persona: 根因 / 排查 / 验证 / 修复建议, each with 出处 +
   置信度, and a read-only safety boundary (advise only; never claim to have
   executed changes; require human confirmation for high-risk actions). No new
   agent tools are introduced — the behavior rides on the persona plus the
   existing `knowledge_search` / `web_search` tools.

7. **ruff RUF001/002/003 are disabled repo-wide (backend).** These "ambiguous
   unicode" rules flag full-width CJK punctuation as homoglyphs; for a
   Chinese-facing product whose personas/prompts/UI copy are legitimately
   Chinese they are 100% false positives.

8. **All admin resource-management tables are org-scoped; model providers are
   team-shared.** Extending decision 1 beyond knowledge/bots, `scenes`,
   `intentions`, and `model_providers` gain `org_id` (admin migration
   `v1.8.0.sql`; each column added nullable → backfilled to `guest-org` →
   `NOT NULL`). Their CRUD/service layers filter by `org_id` for non-admins and
   stamp the caller's org on create. `apps` stays **global** (platform config,
   not team-owned), and chat `conversations`/`messages`/`memories` stay
   **user-private** runtime data — neither is a shared *resource*, so neither
   gains `org_id`. Model providers becoming org-scoped is the load-bearing
   choice: **LLM credentials are shared within a team**, which is exactly what
   lets a shared bot resolve models without borrowing its owner's identity.

   Internal provider resolution uses a hybrid trust model. By-ID lookups
   (`/internal/providers/{id}`) are **unscoped** — the opaque ULID plus the
   `X-Internal-Token` are the security boundary, so trusted callers (executor
   workflows, chat, knowledge) that already hold a concrete `provider_id` need
   not thread `org_id` through every step. Only *searches* —
   `/internal/providers/default` and `/internal/providers/by-kind/{kind}` — are
   org-scoped, because "pick this org's default" is inherently a per-org query.

The oncall agent is therefore a *configuration* (a bot with a persona over a
shared team knowledge base), not a new hard-coded chat mode.

## Consequences

- Team knowledge sharing works: any member of an org retrieves the org's whole
  knowledge base; bots, scenes, intentions, and model providers are all
  team-scoped, so a shared bot runs on the team's shared providers (no more
  borrowing the owner's identity).
- Data isolation is enforced across **every** admin resource table, not just
  knowledge — a non-admin only ever sees rows stamped with their own org.
- Multi-tenancy is real end-to-end (IAM → JWT → gateway → knowledge/admin/chat)
  but intentionally minimal: **one active org per session** for the MVP. There is
  no org-switcher, no org CRUD API, and no member-management UI yet — the demo
  org is seeded. Building those is deferred follow-up work.
- The frontend surfaces the active team read-only (platform header + user menu),
  and the admin bot dialog edits the persona; no cross-MFE plumbing was needed.
- Existing user-scoped rows across all affected tables are backfilled to
  `guest-org`; pre-org cached frontend sessions simply lack `orgId`/`orgName`
  (optional fields) until the next login/refresh. The demo phase permits this
  destructive backfill (no forward-compat obligation), so migrations add the
  column nullable, backfill, then enforce `NOT NULL` rather than shipping a
  nullable-forever column.
- Deferred (see `docs/plans/oncall-agent.md`): document freshness metadata and
  bulk import (Phase 2), full org management UI + IAM org CRUD, and MCP-based
  read-only live-telemetry tools (Phase 3).
