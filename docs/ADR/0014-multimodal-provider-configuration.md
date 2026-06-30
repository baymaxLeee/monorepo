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
