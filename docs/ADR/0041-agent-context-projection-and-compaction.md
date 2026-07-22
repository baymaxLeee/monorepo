# ADR 0041: Agent context projection and incremental compaction

## Status

Accepted.

## Context

The chat runtime mixed two different kinds of model input. Stable policy,
runtime contracts, Skills, Bot configuration, conversation summaries, Todo
state, plan bodies, and document metadata were all assembled into
`ToolLoopAgent.instructions`. This gave historical and user-derived data system
message semantics, invalidated the otherwise cacheable instruction prefix on
every run, duplicated file metadata already present in UIMessage parts, and
copied full plan bodies even though Knowledge is their versioned source of
truth.

AI SDK exposes `instructions`, `messages`, and `tools` as separate developer
inputs, then normalizes instructions and messages into the provider prompt.
Therefore the relevant boundary is semantic and cache-oriented: stable control
policy belongs in instructions; current and historical world state belongs in
messages; tool contracts belong in tools.

## Decision

1. **Instructions remain stable and code-governed.** They contain core policy,
   the mode contract, execution protocol, tool capability projection, available
   Skills, an explicitly activated Skill, structured Bot profile, bounded
   approved memory, and server environment facts. Conversation summary, Todo,
   plan, and document state are not instruction inputs.

2. **Persisted UIMessage is the conversation truth source.** File parts are
   projected once into image inputs or `<document_reference>` message text.
   Official tool-call and tool-result parts remain in recent messages and feed
   subsequent ToolLoopAgent steps through the SDK-native message trajectory.

3. **Old history is replaced only when the input budget requires it.** The
   projector reserves output and instruction overhead, keeps the newest messages,
   and incrementally compacts only the older prefix. The host context is merged
   into the first retained message when it is a user message; otherwise a
   bounded synthetic user message is prepended so historical state never moves
   after retained conversation content. It is explicitly marked as untrusted
   history rather than a new request and carries structured goals, constraints,
   decisions, completed work, open questions, and document identifiers.

4. **Compaction is incremental, versioned, observable, and best-effort.** The
   snapshot records `coveredThroughMessageId` and uses revision compare-and-swap.
   A schema version mismatch rebuilds the snapshot directly; there is no legacy
   adapter. Compaction batch size is bounded by the selected provider's current
   context budget using a conservative multilingual token estimate. Its model
   usage, including successful batches before a later failure, is added to run
   usage and emitted on an `agent.context_compaction` span. Invalid output or
   provider failure uses the last successful state, or deterministic truncation
   when none exists, only as a projection for the current run. Snapshot state and
   `coveredThroughMessageId` advance only through batches with valid structured
   output, so an unresolved suffix remains eligible for a later run. Retryable
   provider failures use AI SDK's bounded exponential-backoff retries; explicit
   user cancellation still aborts immediately. Snapshot write conflicts are
   logged and skipped.

5. **Todo state has one durable representation.** The latest successful
   `tool-update_todos` UIMessage part is canonical. The projector neither queries
   observability tables nor reconstructs or injects Todo business state. Normal
   history pruning and compaction are the only context-management mechanisms.

6. **Plan discovery belongs to the agent, not context projection.** The projector
   never queries Knowledge to inject an active Plan or Plan candidate list. Plan
   editing and generic natural-language execution use `list_files`, `read_file`,
   and `ask_user`. When the current user message explicitly carries
   `data-plan-execution`, the projector only converts that user-supplied id to a
   `<plan_execution_request>` reference and the ToolLoop forces `read_file` until
   contiguous slices cover the full latest document.

7. **Run-start freshness applies to mutable authority, not historical evidence.**
   Plans, activated Skills, and referenced instruction/config sources are
   resolved from their authoritative service on every run that uses them,
   regardless of older tool results in conversation history. Client-tool
   continuation therefore reloads the latest published Skill instead of reusing
   its persisted body. Successful web/knowledge search results remain evidence
   in history and are not automatically repeated; a new search requires an
   explicit refresh/re-search or an explicit latest/current request unsupported
   by the existing evidence.

## Consequences

- The system prefix is smaller and more stable, with clearer trust boundaries.
- Recent conversations do not receive a duplicate summary or state block.
- Long conversations incur an additional model call only when a prefix actually
  leaves the recent budget; later calls compact only the newly covered prefix.
- A failed batch does not corrupt durable coverage. The current run continues
  with bounded fallback context, while a later run retries only the unresolved
  suffix after any successfully committed batches.
- No API, stream part, database schema, or migration changes are required.
- Existing version-1 context snapshots are intentionally rebuilt on demand.
- Demo-phase policy applies: this refactor adds no test scaffolding. Chat scoped
  lint and build are the required implementation checks.

## References

- ADR-0017: Agent Todo list
- ADR-0024: Deliverable-tagged live Todos
- ADR-0032: Code-governed prompt layering and structured Bot profile
- `schemas/streaming/chat-uimessage-stream.md`
- [OpenAI Codex compaction implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs)
- [Claude Code context windows and compaction](https://code.claude.com/docs/en/context-window)
- [AI SDK message modification for longer agent loops](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling#message-modification-for-longer-agentic-loops)
