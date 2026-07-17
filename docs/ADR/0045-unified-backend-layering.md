# ADR-0045: Unified backend layering

## Status

Accepted.

## Context

Backend services already use a layer-first structure, but equivalent concerns
have different names across Python, Go, and TypeScript: `routers`, `handlers`,
`services`, `crud`, `models`, `lib`, and capability-specific folders. The
inconsistent vocabulary makes cross-language navigation harder and leaves
ambiguous buckets such as `lib` and `crud`.

The service remains the business and deployment boundary. A second
`modules/<resource>/...` hierarchy inside every service would duplicate that
boundary and add nesting without improving isolation.

## Decision

Every backend service uses the same logical layers:

- `bootstrap`: configuration, dependency assembly, and process lifecycle.
- `api`: inbound HTTP or gRPC adapters and middleware.
- `application`: use cases, business-flow orchestration, and shared input/output
  contracts.
- `domain`: framework-independent entities, policies, errors, and events.
- `infrastructure`: persistence, outbound clients, providers, security
  implementations, caching, and observability.

The primary dependency direction is `api -> application`; application code may
use domain rules and concrete infrastructure adapters inside the same service.
Ports are introduced only when an external boundary or multiple implementations
justify them. `bootstrap` is the composition root and may import all layers. ORM
models are persistence details, not domain entities.

Resources remain separated within each layer. Small resources start as one file
and split into a resource directory only when their implementation grows.
Services without meaningful domain behavior do not create placeholder domain
types.

Code enters `domain` only when it expresses a business invariant, value object,
policy, or deterministic state transition. Domain code must not import `api`,
`application`, `infrastructure`, ORM models, HTTP frameworks, or runtime SDKs.
Transport DTOs and persistence status columns do not become domain objects merely
because they contain business-looking names.

The first extraction applies this rule to the existing behavior with the clearest
domain ownership:

- IAM identity normalization, account/organization value rules, and role names.
- Admin Skill workspace paths, frontmatter, hashes, and publishing invariants.
- Knowledge text chunking and indexing outcomes.
- Chat Artifact verification as a deterministic state machine over normalized
  tool-result events.
- Executor HTML Artifact validation and its canonical decision.

Gateway and Telemetry remain without a `domain` directory until they own actual
business rules.

Python and TypeScript keep `src/` as their code root. Go keeps `cmd/` entrypoints
and `internal/` implementation packages. TypeScript Workflow DevKit entrypoints
remain in `workflows/`, and the chat agent runtime remains cohesive under
`application/agent`; no wrapper is added around AI SDK `ToolLoopAgent` or native
UIMessage streams.

For Chat, the AI SDK step adapter stays in `application`. It converts official
ToolLoopAgent step results into framework-independent domain events, then feeds
the domain state machine. This follows the installed AI SDK's official
`docs/03-agents/04-loop-control.mdx` contract: `prepareStep` remains the SDK loop
control point while domain code owns only the deterministic business decision.
Executor keeps Workflow DevKit entrypoints and durable step orchestration outside
the domain for the same reason.

Public and internal API paths, ports, storage schemas, and cross-service
contracts do not change as part of this migration.

## Consequences

- Cross-language service navigation uses one vocabulary.
- Generic `lib`, `crud`, and top-level `services` buckets disappear.
- Import paths and service documentation change mechanically.
- The migration must preserve all root `just` commands and per-service builds.
