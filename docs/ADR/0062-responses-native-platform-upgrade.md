# ADR-0062: Responses-native provider and context runtime

## Status

Accepted

## Context

The agent runtime already persists Vercel AI SDK `UIMessage` parts and delegates the tool loop to `ToolLoopAgent`, but every text model is serialized through `@ai-sdk/openai-compatible` to `/chat/completions`. That transport loses Responses item identity, response continuation, native reasoning metadata, and semantic stream events. Dependency versions for AI SDK and Hono are also split across the frontend and backend workspaces.

OpenAI defines Responses as the agent-oriented API primitive. AI SDK 7 treats `UIMessage` as application state, `ModelMessage` as a model projection, and the OpenAI provider uses Responses by default. Codex and Pi retain an application-owned, replayable session history and compaction state instead of making a provider cursor the sole record.

## Decision

- Text generation uses the Responses API family. Chat Completions, URL-based protocol inference, and silent fallback are removed. Admin requires an explicit `openai_responses`, `ark_responses`, or `deepseek_responses` dialect for every chat provider.
- Persisted `UIMessage` parts are the authoritative semantic journal. Provider response chains are capability-gated execution continuations, never the sole business record.
- The context projector chooses capability-based incremental continuation or full Responses-item replay. Provider/model changes and invalid chains start a new lineage from the local journal.
- OpenAI and Ark use `store: true` with `previous_response_id`. DeepSeek is stateless: it uses `store: false`, never sends a previous response id, and replays local reasoning, function calls, and function outputs.
- A stored continuation sends only messages produced after the referenced response, such as the next user message or `function_call_output`. It never resends the assistant `function_call` already owned by the provider chain.
- Response/item identifiers and provider metadata remain attached to official message/reasoning/tool parts and run steps so replay preserves native semantics.
- Standard `reasoning_text` stream events are normalized into AI SDK reasoning parts at the provider boundary until the OpenAI provider exposes those events directly. DeepSeek replay converts those retained reasoning parts back to its plain `reasoning_text` input content.
- Ark's streaming function-call start event may omit `arguments`; the transport boundary supplies the protocol-neutral empty string required by the OpenAI provider until argument deltas arrive.
- AI SDK, Hono, Nitro, and Workflow packages are governed by workspace catalogs and upgraded together to npm's current `latest` dist-tags. A package whose `latest` is prerelease remains exact-pinned.
- Image, video, embedding, and rerank providers retain their native non-Responses APIs.
- Workflow Postgres initialization uses the package's current `bootstrap` binary. Nitro's current tracer bundles OIDC correctly, so the former nf3 override and post-build path rewrite are removed.

## Consequences

The runtime gains native reasoning/tool continuation and smaller incremental requests where the provider supports them, without coupling business history to one vendor. Vendor-specific event normalization and request options remain transport-boundary details selected by an explicit admin capability. Provider connectivity checks exercise both Responses function calling and the configured continuation mode rather than accepting a model after a text-only request. The migration is intentionally incompatible during the demo phase; existing chat providers are classified once by the migration and future configuration never infers dialect from URL.

## Verification

Run the root install/up/sync/build/lint/dev entry points, verify Chat UIMessage streaming and Executor Workflow durability, and inspect real provider requests for Responses endpoints and correct continuation/replay behavior. Follow ADR-0016 after implementation.
