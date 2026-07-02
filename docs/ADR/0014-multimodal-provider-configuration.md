# ADR 0014: Multimodal provider configuration and generation boundaries

## Status

Accepted.

## Context

Admin already owns encrypted model-provider credentials consumed by chat. The
same management plane must prepare credentials for Volcengine Ark Seedream
image generation and Seedance video generation without treating either as a
chat model or copying credentials into consumer services.

Image generation is request/response but returned Ark URLs are temporary.
Video generation is an asynchronous task API with explicit query and cancel
operations. A provider connectivity check must not become a hidden, billable
long-running generation workflow.

## Decision

- A provider has an explicit `provider_kind`: `chat`, `image`, or `video`.
- Admin owns provider CRUD, encrypted API keys, masked public responses, and
  service-to-service decrypted snapshots for the owning user.
- Provider base URLs must resolve only to public HTTP(S) addresses. Admin
  validates them before persistence and connectivity tests; consumers validate
  again before use and reject redirects, protecting internal and metadata
  endpoints from administrator-configured SSRF.
- Only chat providers may be the user's default chat model. Changing a default
  provider away from `chat` clears its default flag atomically.
- Provider tests are kind-specific. Chat and image tests invoke their matching
  API. Video tests validate Ark API authentication by listing tasks and never
  create or poll a billable generation task.
- `extra_body` contains provider request defaults only. Local orchestration
  controls such as polling deadlines do not belong in provider configuration.
- Future image/video tools use dedicated typed request and result contracts.
  Seedance task IDs, status, cancellation and retries belong to a durable
  generation workflow, not an Admin HTTP request.
- Generated image/video bytes are copied immediately into Knowledge/ObjectStore.
  Conversation messages persist artifact/document references, never temporary
  provider URLs as the durable source of truth.

## Consequences

- Chat cannot accidentally select an image or video provider as its language
  model.
- Chat reads the current provider snapshot for each model-client creation rather
  than caching decrypted credentials in-process, so disable and key rotation
  changes take effect on the next run.
- Seedream and Seedance can reuse one Ark credential configuration while their
  execution semantics remain separate.
- The current provider table retains chat token-budget columns for migration
  simplicity. Future generation contracts must not expose those fields as
  image/video runtime parameters.
- Admin connectivity checks stay bounded; actual video progress and
  cancellation can be surfaced through the agent generation workflow later.

## Update: image generation landed (Seedream)

Image generation is now wired end to end as an agent tool, honoring the
boundaries above:

- The chat `ToolLoopAgent` has an inline `generate_image` tool
  (`services/chat/src/agent/tools/builtins/media.ts`). It resolves the image
  provider from the run-scoped `multimodal_provider_id` (independent of the chat
  language model), validates `provider_kind === "image"`, and calls the AI SDK
  `generateImage` over the shared OpenAI-compatible adapter
  (`libs/transport-ts/provider-model.ts` `createProviderImageModel`, same
  `secureProviderFetch` SSRF guard as chat).
- The OpenAI-compatible image model always requests `response_format: "b64_json"`
  and parses it, so we receive raw bytes regardless of the provider's configured
  default. Those bytes are copied immediately into Knowledge via a new internal
  endpoint `POST /internal/media-documents`
  (`services/knowledge/src/knowledge/routers/documents_internal.py`), which
  mirrors the artifact-publish object-store path. Messages persist only the
  resulting `document_id`; Ark's temporary URL is never persisted.
- Generation is synchronous/inline (a single `generateImage` await), matching
  the request/response nature of image models — no durable executor task. The
  frontend renders results inline from the tool output (`ChatImageCard`) and can
  open the side preview panel (`ArtifactPreview`, image kind).

## Update: video generation landed (Seedance)

Video generation is now wired end to end as a durable executor workflow, exactly
as this ADR prescribed for its asynchronous, billable task API:

- Ark video is an async task API (create `POST /contents/generations/tasks`,
  then poll `GET .../tasks/{id}`), so it runs as an executor Workflow DevKit task
  (`services/executor/workflows/video-generation.ts`, registered as
  `video-generation`), never inline in the chat turn. Steps: create the Ark task
  → poll to a terminal state → download the finished video → persist to Knowledge.
  Ark HTTP goes through `secureProviderFetch` (SSRF guard) via
  `services/executor/src/clients/ark.ts`.
- The chat `generate_video` tool (`services/chat/src/agent/tools/builtins/video.ts`)
  resolves the video provider from a run-scoped `video_provider_id` (distinct
  from the image `multimodal_provider_id`; a user typically has separate Seedream
  and Seedance providers), validates `provider_kind === "video"`, dispatches the
  durable task and foreground-blocks on it — reusing the same
  dispatch/resilient-poll/cancel-on-abort helpers as the HTML-artifact tool
  (extracted to `services/chat/src/agent/tools/task-runner.ts`). It streams a
  preliminary `{ status, task_id }` then a terminal `{ status, document_id }` on
  the main chat stream; the frontend `ChatVideoCard` shows a generating state and
  then plays the video inline. Downloaded bytes are copied into Knowledge via the
  same `POST /internal/media-documents` endpoint; the temporary Ark video URL is
  never persisted.
- User Stop cancels the in-flight executor task (Workflow DevKit `run.cancel()`),
  same as the HTML-artifact tool.
