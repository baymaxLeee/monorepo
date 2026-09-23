# ADR-0069: AI-native dependency baseline

## Status

Accepted

## Context

The Responses-native architecture in ADR-0062 is still valid, but the runtime
currently mixes older AI SDK 7 patches, Zod 3 and 4, React 18 compiler support,
locally forked AI Elements, and independently pinned Workflow/Nitro packages.
That combination makes the persisted `UIMessage` contract, provider continuation,
durable workflows, and Module Federation runtime sensitive to package drift.

The current official stable lines are AI SDK 7, AI Elements 1.9, Zod 4, React
Hook Form 7, and Workflow 4. Workflow 5 and React Hook Form 8 are prereleases
and are therefore not part of this migration. Nitro 3 is still published on a
beta dist-tag, so it remains exact-pinned.

## Decision

- Upgrade the AI SDK cohort together: `ai` 7.0.111, `@ai-sdk/react` 4.0.114,
  `@ai-sdk/openai` 4.0.72, `@ai-sdk/provider` 4.0.17, and
  `@ai-sdk/provider-utils` 5.0.45. Keep `ToolLoopAgent`, official `UIMessage`
  parts, `toUIMessageStream`, and `DefaultChatTransport` as the runtime
  primitives.
- Standardize both TypeScript workspaces on Zod 4.6.5. Upgrade
  `react-hook-form` to 7.88.0, `@hookform/resolvers` to 5.9.1, and
  `@hono/zod-validator` to 0.9.1; migrate code from removed Zod 3 type and issue
  APIs instead of importing a Zod 3 compatibility entry.
- Rebase the locally owned AI Elements subset against the official 1.9.0
  registry and record every retained product customization in `UPSTREAM.md`.
  Upgrade Streamdown to 2.6.0. AI Elements stays source-owned because it is a
  registry distribution, not an application runtime package.
- Upgrade the durable execution cohort to Workflow 4.8.9,
  `@workflow/world-postgres` 4.3.7, and exact-pinned Nitro
  3.0.260903-beta. Do not adopt Workflow 5 beta. Retain only workarounds that
  the installed Nitro/Workflow exports and integration tests still prove
  necessary.
- Keep the complete frontend workspace on React and React DOM 18.3.0. The
  upgraded AI SDK React bindings, AI Elements dependencies, Streamdown, Base UI,
  React Hook Form, and resolvers all support React 18. React 19 is not a
  transitive requirement for this migration and the product does not currently
  use a React 19-only primitive. Keep the React Compiler target at `18` and its
  runtime singleton; evaluate React 19 separately when product code can benefit
  from its actions, form status, optimistic state, or resource APIs.
- Upgrade the adjacent HTTP cohort to Hono 4.13.8 and
  `@hono/node-server` 2.1.1. Catalog entries are the only version authority;
  stale release-age exclusions are removed.
- Keep application-owned persisted `UIMessage.parts` as the semantic journal.
  Provider cursors remain optional execution continuation and never replace
  durable application history.
- Keep one primary ToolLoopAgent. This dependency migration does not introduce
  persona agents or a private orchestration loop.

## Direct refactors

- Replace the full custom `LanguageModelV4` implementation with the official
  OpenAI provider plus middleware wherever the official provider owns the
  behavior. Keep the safe-fetch boundary and only those Responses event
  normalizations covered by contract tests.
- Delete Zod 3 generics and issue constants and obsolete dependency-policy
  entries in the same migration. No dual-stack compatibility layer is retained.
- Keep the `reasoning_text` normalizer until an installed OpenAI provider test
  proves that compatible Responses streams are handled natively.
- Keep explicit Postgres World startup until the installed Nitro integration
  exposes and runs the Workflow runtime plugin without it.

## Verification

The migration is complete only when all of the following pass:

1. Provider contract tests cover the Responses URL/body, SSRF rejection,
   reasoning events, annotations, stored continuation, and replay fallback.
2. Chat tests cover `UIMessage.parts` ordering and IDs, tool approval and
   results, client-tool continuation, abort, disconnect, persistence, and
   resume without duplicate messages.
3. Workflow tests cover Postgres World startup, restart recovery, return values,
   cancellation, and continuation of a run created before process restart.
4. Frontend typechecks and production builds prove one React 18 singleton across
   the platform host and every remote, including the compiler runtime.
5. Every locally owned AI Elements component is reconciled with registry 1.9.0 and Chat and
   Canvas render the affected message, reasoning, tool, artifact, and prompt
   components.
6. Run the canonical root `just install`, `just sync`, `just build`,
   `just lint`, and `just doctor` paths, then perform the independent review
   required by ADR-0016.

## Consequences

The platform has one current dependency baseline and fewer private protocol and
runtime abstractions. The migration intentionally accepts source-level breaking
changes during the demo phase. Future upgrades are grouped by compatibility
cohort and validated against wire and durability contracts instead of assuming
that matching `latest` tags imply compatibility.
