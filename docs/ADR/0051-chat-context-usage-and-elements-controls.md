# ADR 0051: Chat context usage and AI Elements controls

## Status

Accepted.

## Context

The chat composer did not expose how much of the configured model context was
occupied. Tool approvals used local one-off markup even though AI Elements now
provides a Confirmation primitive aligned with AI SDK approval states. A shared
conversation download implementation existed, but persisted conversations did
not expose it from the conversation list.

AI Elements' Context component establishes the relevant interaction model: a
circular utilization indicator with a token breakdown in an interactive detail
surface. Its Confirmation component maps directly to `ToolUIPart` approval
states. The project's TipTap PromptInput already owns rich input and clipboard
image insertion, so replacing that editor would remove working behavior without
improving these controls.

## Decision

- Keep TipTap as the PromptInput editor and preserve its existing paste,
  attachment, mention, and skill behavior.
- Render a compact context ring in the PromptInput footer. Clicking it opens a
  Popover with the model, occupied and configured token counts, and a Cursor-like
  category breakdown. Click is intentional because the detail surface must be
  usable on touch devices and remain open while reading.
- Capture context at the AI SDK language-model middleware boundary, after
  `ToolLoopAgent` has prepared the provider prompt and converted active tools to
  provider-ready JSON Schema. This is the authoritative request surface, not a
  reconstruction from persisted UI messages.
- Persist an estimated conversation context snapshot at the provider request
  boundary, before streaming begins, in the existing step metadata. A completed
  model step replaces it with the provider-calibrated snapshot. This preserves
  the actual prompt composition when the user stops an in-flight response. The
  snapshot classifies system policy/profile/environment, builtin tool
  definitions, runtime rules, Skills, MCP/dynamic tools, memory, and the
  complete projected conversation including compacted history and tool results.
- Anchor the snapshot to the latest run rather than summing agent runs. Within
  that run, prefer the latest completed model step with provider-reported input
  usage over zero-usage synthetic orchestration steps, then fall back to the
  latest estimated snapshot. The DTO labels that fallback explicitly.
- Calculate pressure against the same effective input budget used by context
  projection: `context_window - max_output_tokens - safety_headroom`, with the
  same minimum floor. Return the full window and both reserves separately so
  the UI can explain why pressure reaches 100% before the raw model window does.
  Category values are request-content estimates proportionally calibrated to
  the selected total because providers do not report per-category token counts.
- Read provider limits through a short Redis TTL cache containing only
  `contextWindow` and `maxOutputTokens`; credentials are never cached. Provider
  lookup and stream persistence share the chat service's infrastructure Redis
  client; blocking stream reads use duplicated connections and readiness uses
  an isolated probe. Lookup remains best-effort so failure leaves the maximum
  unknown without making the context read unavailable.
- Expose `GET /conversations/{conversation_id}/context` as the product read
  model. The backend selects the latest terminal model-step snapshot across all
  runs in the conversation, including an estimated request-boundary snapshot
  from a stopped or failed run, resolves the current effective budget, and
  returns render-ready utilization and category shares. The PromptInput does
  not inspect or aggregate run trace data.
- Keep snapshots in the existing transactional `agent_steps.metadata` instead
  of adding a derived table. Run trace may expose the same raw snapshot for
  diagnostics, but it is not the UI contract. ClickHouse remains appropriate
  for fleet analytics, not the latency-sensitive conversation read path.
- Show cache hits as provider metadata only; they are already part of input
  context and are not added to the ring again.
- Adopt an AI Elements-style Confirmation compound component for manual tool
  approvals while retaining the existing approval transport and policy.
- Expose the existing Markdown serialization as a conversation-list action and
  build the file locally from the fetched persisted messages.
- Add no custom `UIMessage` part and no parallel token stream for these
  controls.

## Consequences

- The context ring now represents the unified conversation context that would
  seed the next model call, not billing totals for one run. It refreshes when
  the response completes by reading one conversation-level endpoint and pulses
  while the next snapshot is pending.
- The overall token count is provider-grounded whenever the latest run contains
  a provider-reported step; otherwise the DTO and UI label it as estimated. The
  category split is always explicitly labeled as an estimate because no AI SDK
  or provider usage primitive supplies attribution by prompt section.
- A stopped response retains the request-side context that had already been
  submitted to the provider. Partial output is excluded when the provider does
  not report final usage, so the total remains explicitly estimated.
- Existing runs created before this decision have no categorized snapshot and
  intentionally show an empty state until the conversation runs again. No
  compatibility reconstruction path is retained during the demo phase.
- The displayed percentage reflects compaction pressure against the effective
  input budget, while details retain the full provider window and reserves. If
  configuration is unavailable, the ring uses a neutral indeterminate state
  instead of inventing a fallback limit.
- Tool approvals use the same AI SDK state vocabulary as upstream AI Elements,
  reducing bespoke branching without changing backend semantics.
- Markdown export is deliberately client-side and includes the textual message
  transcript; it does not create a Knowledge artifact or mutate the
  conversation.

## References

- [AI Elements Context](https://elements.ai-sdk.dev/components/context)
- [AI Elements Confirmation](https://elements.ai-sdk.dev/components/confirmation)
