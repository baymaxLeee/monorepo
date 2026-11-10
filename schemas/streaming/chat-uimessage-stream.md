# Chat UIMessage stream contract (chat backend ↔ chat frontend)

The chat SSE stream is a **cross-stack wire contract**, exactly like `openapi/` and `proto/` — so it lives here. It is the Vercel AI SDK **UI Message Stream** carried over SSE between `services/chat` (producer) and `apps/frontend/packages/chat` (consumer, via `useChat`).

The golden rule for this contract: **reuse official AI SDK parts first. Only invent a `data-*` part for data the official protocol has no part for.** A custom part that duplicates an official one is a bug (see the file-token precedent below), not a feature.

> Sources of truth (re-verify, do not trust memory — AGENTS.md "industry practice" rule): the bundled v7 docs at `node_modules/ai/docs/04-ai-sdk-ui/20-streaming-data.mdx`, `.../25-message-metadata.mdx`, `.../50-stream-protocol.mdx`, and the `UIMessagePart` union in `node_modules/ai/dist/index.d.ts`.

---

## 1. Official protocol — the catalog you MUST check before inventing anything

The AI SDK gives three distinct, first-class mechanisms. Most "I need to send X alongside the reply" needs are already covered by one of them.

### 1a. Official `UIMessagePart` types (persisted in `message.parts`)

| Part type         | Use it for                                             |
| ----------------- | ------------------------------------------------------ |
| `text`            | assistant/user text                                    |
| `reasoning`       | model reasoning / thinking                             |
| `tool-<name>`     | a typed tool call + its input/output (static tools)    |
| `dynamic-tool`    | a tool whose name isn't known at compile time          |
| `file`            | a file/document reference or attachment (URL-based)    |
| `reasoning-file`  | a provider reasoning attachment, disclosed separately  |
| `source-url`      | a cited web source (RAG) — emit via `sendSources:true` |
| `source-document` | a cited document source (RAG)                          |
| `step-start`      | multi-step boundary marker                             |
| `data-<name>`     | **app-specific** dynamic data (the escape hatch)       |

### 1b. Message metadata (`message.metadata`, message-level, not a part)

For information _about the message as a whole_ — timestamps, model id, token usage, finish reason. Sent via the `messageMetadata` callback of `toUIMessageStream`; read via `message.metadata`. **Do NOT model these as `data-*` parts.**

The assistant message metadata contract is:

| Field | Meaning |
| --- | --- |
| `runId` | Local durable Agent run identifier. |
| `providerId`, `model` | Exact model snapshot used for the run. Text providers use the single Responses protocol. |
| `responseId`, `parentResponseId` | Provider response lineage. Null before the first response is accepted. |
| `status` | `streaming`, `completed`, `failed`, or `cancelled`. |
| `finishReason` | AI SDK unified finish reason when available. |
| `usage` | Input/output/cache/reasoning/total token counters. |
| `historyRevision` | Conversation journal revision claimed by this logical operation. |
| `fork` | Persisted branch-history provenance `{conversationId, messageId}`. Copied history replaces old execution metadata with this field; it is not streamed as a new run and never resumes the source provider chain. |

Metadata streams through the official `messageMetadata` callback and is stored beside `parts` in the local message journal. It is observability and continuation state, not the source of conversation semantics; `parts` remain replayable when a provider chain expires or the selected provider/model changes.

### 1c. `data-*` parts (the escape hatch) — two flavors

- **Persistent** `data-<name>` (optionally with a stable `id`): added to `message.parts`, survives reload. Writing the **same `id`** again _reconciles_ (updates in place) — this is the official mechanism for progressive/live updates (progress bars, collaborative artifacts).
- **Transient** `data-<name>` (`transient: true`): sent over the wire but **not** added to history. Only observable via `useChat({ onData })`. The official mechanism for ephemeral UI signals (status, notifications).

---

## 2. Reuse-first decision rule (avoid redundancy)

Before adding any new streamed field, walk this ladder and stop at the first hit:

1. Is it **text / reasoning / a tool call / a file / a cited source**? → use the official part (`text`/`reasoning`/`tool-*`/`file`/`source-*`). **Never** wrap these in a custom `data-*` part.
2. Is it **message-level info** (timestamp, model, tokens, finish reason)? → use **message metadata**, not a `data-*` part.
3. Is it **app-specific dynamic data with no official part**? → use a `data-*` part. Then decide persistence:
   - Needs to survive reload / be seen by the model next turn → **persistent** (add to `ChatUIDataTypes`, render from `message.parts`).
   - Pure ephemeral UI signal → **transient**, consumed only via `onData`.
   - Progressive updates to one logical thing → **reuse one `id`** (reconcile), don't append N parts.

### Precedent: the file-token redundancy (do not repeat)

An earlier iteration embedded a **custom file token** in message text to reference an attached document. That duplicated the official `file` part and was removed in favor of `file` parts (`documentIdFromFilePart` parses the document id out of a `/documents/:id/source` URL). Lesson: a custom encoding that an official part already expresses is redundant — delete it.

---

## 3. Our custom `data-*` registry (audited — all justified, none redundant)

There is **one** stream — the main chat stream:

- **Main chat stream** — `POST .../agents/run/stream`, typed as `ChatUIMessage = UIMessage<ChatMessageMetadata, ChatUIDataTypes>` (`apps/frontend/packages/chat/src/lib/chat-message.ts`).

There is no separate task-progress SSE stream. Durable video creation progress rides the main stream as **preliminary `tool-*` results** (see docs/ADR/agent-runtime.md): `create_video_production` watches Executor's authenticated task-status SSE and yields running snapshots (`progress_done`/`progress_total`) that the SDK emits as preliminary tool outputs, then a terminal result with the production id. `ChatVideoCard` reads progress straight off the tool part — no second browser connection and no `data-artifact-progress`. Ordinary files are generated in the run sandbox and appear as the terminal native result of `save_sandbox_file`; there is no delegated-file stream.

| `data-*` type | Stream | Persistence | Reconciled by id | Direction | Producer | Consumer | Why not an official part |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `data-conversation-title` | main | transient | no | server → client | `agent/runs/run.ts` (`writer.write`, first turn) | `pages/Chat.tsx` `onData` → header + sidebar | No official "conversation title" part; title is conversation-level, not message-level, so metadata is wrong too. Transient + `onData` is the documented pattern. |
| `data-plan-execution` | main | persistent | no | **client → server** (+ persisted) | `pages/Chat.tsx` (`executePlan`, added to the user message) | `agent/context/file-parts.ts` + `agent/context/projector.ts` | No official "execute this file" part. The strict payload is `{ file_id }`, referencing one immutable Chat-owned Plan. Sandbox initialization imports it under `/workspace/sources/saved/<file_id>/`; the runtime contract requires Bash to read it completely before execution. |
| `data-skill-activation` | main | persistent | no | **client → server** (+ persisted) | `pages/Chat.tsx` (`submit`, added to the user message when a `/` skill is active) | `agent/context/file-parts.ts` (`activatedSkillNameFromParts` → server injects `<activated_skill>` body for that turn) + `components/ChatMessageView.tsx` (renders a skill badge) | No official "invoke this skill" part. Mirrors `data-plan-execution` (client→server reference): the L2 body never rides the part — only the skill `name`. Persisted so history/continuation show which skill drove the turn; the projector's `convertDataPart` returns `undefined` for it, so older turns are dropped from model context and the body is injected server-side only for the turn its message triggers (docs/ADR/identity-and-configuration.md §4, docs/ADR/agent-runtime.md). |

### Verdict on redundancy

- **None of these duplicate an official part.** Each carries app-specific data the protocol has no part for, using the official mechanism correctly (transient+`onData`; persisted reference part).
- We already use official parts everywhere one exists: `text`, `reasoning`, `tool-*`, `file`, and `source-*` (`sendSources: true`). Do not wrap any of these in `data-*`.
- Known non-redundant overlaps to leave alone:
  - Source-document references use an official `file` part whose URL carries the document id. Plan execution uses `data-plan-execution` as a command reference containing a stable Chat `file_id`, not copied Plan content or a virtual path. There is no separate `document_ids` request field.
  - `generate_images` (media generation) returns its result **as tool output**, not a custom part: an inline async-generator tool emits a running ToolOutcome with progress `{ count }`, then a completed or partial ToolOutcome whose data is `{ images: [{ document_id, filename, media_type }], count, failed }`. Business failures use a structured ToolOutcome on the official `output-available` state and AI SDK `toModelOutput` maps blocked/failed to model-side `error-json`; Abort and protocol failures use `output-error`. A multi-image request is ONE call with a `prompts[]` array (one image per prompt, processed serially); `count` is the requested total and `failed` how many prompts dropped (partial gallery). See docs/ADR/agent-runtime.md for the serial generation-orchestration model. The frontend `ChatImageCard` renders a **lightweight reference card** (icon + count, zero bytes fetched at render); clicking it opens the image lightbox, which fetches the group from those `document_id`s on demand (served via `/documents/:id/source`, the same route `file` parts use) — no `data-*` part is needed because the tool part already carries everything. Generated bytes live in Knowledge, never a temporary provider URL (docs/ADR/identity-and-configuration.md); the transcript never inlines them (docs/ADR/frontend.md).
  - `create_video_production` creates a durable production task. It yields preliminary `{ status, task_id, kind: "video" }` results while Executor plans, then a completed result carrying `production_id` once the initial storyboard and cost projection are durable. The same Workflow continues approvals, paid generation, Take review, assembly, and publication after the chat tool has completed. `ChatVideoCard` opens the director workspace from that production id; no second task-progress stream or custom `data-*` part is needed.
  - Tool definitions carry `toolMetadata.agent` with capability, effect, execution, source, trust, and `uiKind`. AI SDK propagates this metadata onto official tool parts; the frontend selects artifact/media/todo/approval UI by `uiKind`, not by hard-coded public tool names. `subagent` denotes one official tool part containing one to three actual inline child ToolLoopAgents and their nested UIMessage progress; `artifact` denotes a published `save_sandbox_file` result. Persisted fork tool parts add `agent.historical: true`; external task approvals remain in the original conversation. Unfinished/preliminary results become native `output-error`, never a replay request. This is metadata on the official tool part, not a custom `data-*` channel.
  - `update_todos` output items carry an optional `deliverable` tag (`"artifact" | "image" | "video"`). It is **not** a new part: it rides the existing `tool-update_todos` output. The frontend (`ChatTodoListCard.collectDeliverableCompletion`) reads the live `image-gallery`/`video`/`artifact` tool parts emitted after the latest `update_todos` and advances the active tagged todo from its serial deliverable card while the model is between snapshots. This is display-layer derivation from official tool parts (the completion fact already on the wire), so no `data-*` part is added; the model's next-step `update_todos` remains the canonical snapshot. See docs/ADR/agent-runtime.md and docs/ADR/agent-runtime.md.
  - Persisted `tool-update_todos` UIMessage output is also the model-side truth source while it remains in retained history. The context projector never reconstructs or dynamically injects Todo business state (docs/ADR/agent-runtime.md).
  - On explicit user cancellation, unfinished official tool parts are persisted as `output-error`; no cancellation `data-*` part is added. Non-completed `update_todos` items become `cancelled`, which is a terminal persisted todo status. Navigation-only disconnects do not perform this transition. See docs/ADR/agent-runtime.md.

---

Runtime schemas for application metadata and registered `data-*` parts live in [chat-ui.ts](chat-ui.ts). `just sync` generates backend and frontend modules; `just sync-check` rejects drift. Native parts remain owned by AI SDK. Hydration validates native parts and these extensions; an absent metadata field is valid for ordinary user messages, while present run/fork metadata must match its schema.

## 4. Request, replay, and journal invariants

`POST /conversations/{conversationId}/agents/run/stream` carries one logical operation. In addition to the SDK message it requires:

| Field | Contract |
| --- | --- |
| `trigger` | `submit-message` or `regenerate-message`; tool continuation is derived from the submitted awaited assistant message. |
| `messageId` | Explicit edit/regenerate/continuation target when the SDK operation supplies one. It is not inferred from the last array element. |
| `expected_revision` | Last hydrated conversation history revision. A stale value is a conflict, never an implicit merge. |
| `request_id` | Stable logical-operation id. `(conversation_id, request_id)` binds to a canonical fingerprint of the full operation, target, message and run context; exact retries replay the same run, any changed reuse is rejected. |

The browser cannot start a history mutation until hydration and UIMessage schema validation have established `expected_revision`. History selection and explicit request replay are each single-flight operations; a selection response applies only if the SDK message snapshot is unchanged. A user-originated `file` must use the authorized conversation-document URL and must not supply `providerReference`; provider references are accepted only on server-produced assistant parts. Image model projection reads that authorized resource with `maxDim: 1536` while the journal retains the stable URL.

The response is the official UIMessage SSE protocol. The outer composition owns the only public message `start`/`finish`. Nested model conversion retains its SDK finish internally to capture `finishReason`; the composition suppresses that inner finish before merging content. Files are published per new chunk in order, never by scanning the assembled continuation for already published files. Search evidence is projected to native `source-*` while the original tool output remains intact. Model `file` and `reasoning-file` parts must be published to an authorized conversation resource before the finish can be committed. A `save_sandbox_file` result remains a tool result and is rendered as an Artifact; it is not duplicated as a native file part.

`GET /conversations/{conversationId}/agents/run/stream` replays the active run's stored native SSE from the beginning with replay semantics enabled in `DefaultChatTransport`; `useChat.resume` is enabled only when the hydrated detail has an active run, while an explicit recovery probe with no active stream returns `204`. Redis is an active-run replay buffer, not message history: a five-minute sliding lease is refreshed independently of output, one run is bounded to 8 MiB and 10,000 entries, and capacity exhaustion fails the run before Redis can grow without bound. After the PostgreSQL journal reaches a terminal state and the SSE consumer drains, the stream is deleted immediately; TTL only reclaims crash leftovers. Disconnecting a reader only cancels that Redis blocking read. Explicit Stop uses the cancel endpoint and the run AbortSignal. After stopping the local reader, the client re-reads the authoritative `active_run_id` before cancellation so a claimed POST whose response headers were not observed is still cancelled. Clearing the Redis active pointer compares run id so an old subscriber or producer cannot clear a newer run, while the uniquely named old run stream can be deleted.

PostgreSQL is the semantic source of truth. The finalizer atomically commits tool terminal state, assistant UIMessage, run status/token usage, selected history leaf and lease removal. Terminal/missing runs and expired leases are reclaimed instead of blocking history selection or deletion; an expired active run becomes `interrupted`. Selected pointer and message graph reads use one ordered database transaction so consumers never observe a new pointer with an old graph. Redis is deliberately not part of that transaction; recovery checks the authoritative run journal before retiring a stale pointer.

## 5. Checklist when adding a streamed field (paste into your PR reasoning)

- [ ] Walked the §2 ladder; confirmed no official part/metadata already covers it.
- [ ] Chose transient vs persistent deliberately (reload + model-visibility test).
- [ ] Progressive updates reuse one `id` instead of appending parts.
- [ ] Added the type to `ChatUIDataTypes` (persistent) or documented it as transient-only (`onData`).
- [ ] Added a row to the §3 registry table above.
- [ ] Producer and consumer file paths recorded.
