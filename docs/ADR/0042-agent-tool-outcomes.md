# ADR 0042: Agent tool failures are structured outcomes

## Status

Accepted. Refines ADR 0035 and replaces the earlier video-only native-error decision.

## Context

The agent runtime previously mixed successful values, ad-hoc failure objects,
thrown execution errors, and durable task status objects. Thrown errors became
AI SDK `tool-error` parts, but transport response bodies and partial batch
results were often lost. Ad-hoc failures reached the model inconsistently and
observability sometimes discarded their full output.

The primary ToolLoopAgent must receive the same facts the runtime has so it can
decide whether to stop, explain, change input, switch tools, or make a new visible
tool call. The runtime must not make that product decision through hidden retries.

## Decision

1. Every currently model-visible builtin, Skill, and client tool exposes one
   ToolOutcome envelope: `running`, `completed`, `partial`, `blocked`, or
   `failed`.
2. ToolIssue contains a stable code, self-contained message, retryability fact,
   optional source, and bounded structured details. Transport response bodies
   are normalized at the Chat tool boundary with secret-bearing fields removed.
   Tool data and progress are pure domain payloads; protocol-level `ok/status`
   exist only on the ToolOutcome envelope and are emitted with the shared
   `toolCompleted` / `toolRunning` / failure helpers.
3. Business failures are ordinary AI SDK tool results (`output-available`) and
   enter the next ToolLoopAgent step. Abort, user Stop, approval denial, invalid
   tool input, and protocol/runtime invariants retain native control flow.
4. AsyncIterable tools deliver progress as preliminary ToolOutcome values and a
   final ToolOutcome as their last yield. Iteration errors are normalized;
   Abort still propagates.
5. The UI and model channels remain separate SDK-native views of one result.
   The official tool part keeps the full ToolOutcome as `output-available` for
   persistence and cards. The manifest always installs `toModelOutput`:
   completed delegates successful data to a tool-specific converter or JSON,
   partial sends the full outcome as JSON, and blocked/failed use AI SDK's
   native `error-json`. Existing Skill XML conversion applies only to successful
   Skill data.
6. `ask_user` remains a schema-only client tool. Browser answers use a completed
   ToolOutcome, validated at the continuation merge boundary before persistence
   or model projection.
7. Full outcomes persist in `agent_tool_calls.output_json` even when partial,
   blocked, or failed. The `error` column stores the readable ToolIssue message.
8. No second SSE or custom `data-*` error part is introduced. Cards parse the
   outcome carried by the official tool part; partial image galleries retain
   successful images and show failed-item information.
9. Side-effecting provider creation is not automatically retried without a real
   provider idempotency key. Ark segment create steps use `maxRetries = 0`.
10. Executor Workflow start failures mark the inserted task failed immediately.
    Chat performs one dispatch attempt; a later attempt is a new visible tool
    call with a new owner reference chosen by the primary agent.

## Consequences

- Tool failure is a normal observation, not a failed Agent Run.
- The model and UI receive provider, task, failed-item, and transport facts in a
  stable shape.
- Partial batches preserve value instead of collapsing to all-or-nothing.
- Tool payload schemas no longer duplicate envelope state as nested
  `data.ok/data.status` or `progress.ok/progress.status` fields.
- Duplicate paid generations are not hidden behind Workflow step retries.
- Native `output-error` remains reserved for cancellation, protocol failures,
  and execution paths not yet normalized by the tool boundary.
- The model receives a native error tool-result signal without forcing the UI
  tool part into `output-error` or losing the structured outcome persisted for
  users and observability.

## References

Verified against bundled `ai@7.0.26` and Workflow DevKit `4.5.0`:

- `node_modules/ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx`
- `node_modules/ai/docs/04-ai-sdk-ui/03-chatbot-tool-usage.mdx`
- `node_modules/@ai-sdk/provider-utils/dist/index.js` (`executeTool`)
- `node_modules/@ai-sdk/provider-utils/src/types/content-part.ts` (`ToolResultOutput`)
- `node_modules/ai/src/prompt/create-tool-model-output.ts`
- `node_modules/workflow/docs/foundations/errors-and-retries.mdx`
