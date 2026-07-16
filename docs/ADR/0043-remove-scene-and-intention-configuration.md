# ADR-0043: Remove scene and intention configuration

- Status: Accepted
- Date: 2026-07-16

## Context

The admin service exposes complete CRUD surfaces for `scenes` and
`intentions`, including PostgreSQL tables, demo seeds, REST routes, generated
contracts, frontend API wrappers, and admin pages.

The chat runtime does not consume either resource. Its AI SDK v7
`ToolLoopAgent` receives instructions and a flat tool set, then lets the model
select tools and observe their results inside the SDK-owned loop. The two admin
resources therefore do not influence agent behavior despite presenting
themselves as agent configuration.

Keeping disconnected configuration is actively harmful:

- operators can edit values that never affect a run;
- the API and UI imply a routing layer that does not exist;
- future work may accidentally build a second orchestration system beside the
  native tool loop;
- every resource duplicates persistence, authorization, contract, and UI code
  without a runtime consumer.

## External alignment

AI SDK v7 defines an agent as an LLM using tools in a loop and recommends
`ToolLoopAgent` as the default reusable abstraction. Tool availability,
instructions, runtime/tool context, `prepareStep`, and stopping conditions are
the supported control surfaces:

- <https://ai-sdk.dev/docs/agents/overview>
- <https://ai-sdk.dev/docs/agents/building-agents>
- <https://ai-sdk.dev/docs/agents/loop-control>

The benchmark coding agents follow the same fundamental shape:

- Codex describes one agent loop iterating between model inference and tool
  calls, with context management owned by the harness:
  <https://openai.com/index/unrolling-the-codex-agent-loop/>
- Claude Code exposes tools and permissions directly to its agentic turns
  rather than requiring a domain intent registry:
  <https://docs.anthropic.com/en/docs/claude-code/cli-usage>
- Cursor Agent continues using its enabled tools until the task is complete,
  with reusable rules supplying scoped prompt context:
  <https://docs.cursor.com/en/agent/tools>

These systems may use instructions, skills, rules, or tool policy, but none
requires an application-owned scene/intention CRUD layer before the primary
agent can choose tools.

## Decision

Remove the scene and intention configuration feature end to end:

- drop the `scenes` and `intentions` tables with a forward database migration;
- delete their admin models, schemas, CRUD, services, routers, and demo seeds;
- remove their REST endpoints and regenerate all downstream contracts;
- delete their admin pages, routes, navigation items, handwritten API wrappers,
  gateway path aliases, and unused runtime event;
- remove active architecture and domain documentation that advertises these
  resources.

Historical migrations and ADRs remain immutable records. The new migration is
the authoritative removal for both existing and fresh databases.

The word "scene" used by video storyboards and the natural-language concept of
user intent are unrelated and remain unchanged.

## Consequences

- The primary agent decides directly from the current conversation,
  instructions, available tools, skills, and tool results.
- Admin no longer exposes configuration that has no runtime effect.
- Any future deterministic routing requirement must be justified by a concrete
  product or operational need. It should use native tool policy, scoped skills,
  or explicit workflow code rather than recreating generic scene/intention
  registries.
- This is intentionally incompatible: the removed endpoints return 404 and the
  removed database rows are discarded.

