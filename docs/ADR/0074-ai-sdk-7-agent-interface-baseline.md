# ADR-0074: AI SDK 7 agent interface baseline

## Status

Accepted

## Context

AI SDK 7 added first-party Bash, Web Fetch, Code Mode and Tool Search. In the same release line, shadcn/ui replaced the packaged AI SDK Elements registry with 21 source-owned AI Elements patterns built from Trace, Code Block, Message Scroller and the other shadcn/ui components. Workflow 5 also merged workflow and step delivery into one flow handler and made World resolution asynchronous.

The repository already had the right ownership shape: one interactive `ToolLoopAgent`, native `UIMessage` parts, source-owned AI UI compositions and Workflow-backed durable execution. Its dependency baseline and component implementations predated these primitives.

## Decision

- Keep one primary `ToolLoopAgent`. Add the official Bash, Web Fetch, Code Mode and Tool Search primitives to its existing tool catalog.
- Give every run its own in-memory Bash session without host mounts, environment variables or network access. Bash is temporary computation; application file tools remain the persistent file boundary.
- Bind Code Mode only to public Web Fetch. Business tools remain direct SDK tools so their authenticated context and approval policy cannot be bypassed.
- Preserve native `toolSearch()` results and markers. All application tools continue to use the repository's `ToolOutcome` contract.
- Generate Trace and Code Block with the official shadcn CLI. Maintain the 21 AI Elements patterns as source-owned compositions in `@repo/ai-elements`, as the official distribution now specifies. Keep heavy terminal highlighting and the TipTap composer behind package subpaths.
- Upgrade Workflow to version 5 and use the combined flow bundle. Local and production runtimes expose one `/.well-known/workflow/v1/flow` handler; the removed step handler is not retained.
- Treat the Workflow 5 Postgres schema as the only supported schema. Local demo databases created by an older migration timeline are rebuilt instead of carrying a compatibility migrator.

## Consequences

Agent tool definitions can stay deferred until the model searches for them, reducing the initial tool surface. Shell and generated JavaScript execution have explicit security and persistence boundaries. Tool activity, reasoning, plans, sources, terminal output and test results share the same Trace and Code Block visual language.

Workflow development and deployment use the same version 5 flow topology. An environment upgrading from the previous local demo schema must rebuild its Workflow database; durable application state remains owned by the service databases rather than the Workflow execution store.

## Verification

The change requires runtime tests for Bash isolation, private-address blocking, Code Mode capability boundaries, cancellation and deferred tool discovery. AI Elements tests cover streaming disclosure, approvals, file-tree actions and failed test expansion. Canonical `just sync`, `just lint`, `just build` and a fresh Workflow Postgres bootstrap must pass.
