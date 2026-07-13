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
   into the earliest retained user/assistant message, avoiding a synthetic
   consecutive user turn, and is explicitly marked as untrusted history rather
   than a new request. It carries structured goals, constraints, decisions,
   completed work, open questions, and document identifiers.

4. **Compaction is incremental, versioned, observable, and best-effort.** The
   snapshot records `coveredThroughMessageId` and uses revision compare-and-swap.
   A schema version mismatch rebuilds the snapshot directly; there is no legacy
   adapter. Compaction batch size is bounded by the selected provider's current
   context budget. Its model usage is added to run usage and emitted on an
   `agent.context_compaction` span. Invalid output or provider failure falls back
   to the last valid snapshot, or direct truncation when none exists. Snapshot
   write conflicts are logged and skipped. Explicit user cancellation still
   aborts the run.

5. **Todo state has one durable representation.** The latest successful
   `tool-update_todos` UIMessage part is canonical. If pruning removes its tool
   result while unfinished work remains, the projector derives a bounded
   `<current_todo_snapshot>` in the historical replacement message. The runtime
   no longer queries observability tables for business state.

6. **Plans and documents are referenced, not embedded.** `data-plan-execution`
   continues to become `<referenced_plan>` in messages. Plan mode may add only an
   `<active_plan_reference>` containing document and revision identifiers when
   that reference is otherwise absent. The model must use `read_file` before
   editing or executing the body; Knowledge remains the source of truth and
   existing revision compare-and-swap remains authoritative. A stale reference
   or transient Knowledge failure omits the optional hint instead of failing the
   user's turn.

## Consequences

- The system prefix is smaller and more stable, with clearer trust boundaries.
- Recent conversations do not receive a duplicate summary or state block.
- Long conversations incur an additional model call only when a prefix actually
  leaves the recent budget; later calls compact only the newly covered prefix.
- No API, stream part, database schema, or migration changes are required.
- Existing version-1 context snapshots are intentionally rebuilt on demand.
- Demo-phase policy applies: this refactor adds no test scaffolding. Chat scoped
  lint and build are the required implementation checks.

## References

- ADR-0017: Agent Todo list
- ADR-0024: Deliverable-tagged live Todos
- ADR-0032: Code-governed prompt layering and structured Bot profile
- `schemas/streaming/chat-uimessage-stream.md`
