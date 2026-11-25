# Chat UIMessage stream contract (chat backend ↔ chat frontend)

The chat SSE stream is a **cross-stack wire contract**, exactly like `openapi/` and `proto/` — so it lives here. It is the Vercel AI SDK **UI Message Stream** carried over SSE between `services/chat` (producer) and `apps/frontend/packages/ai-elements` (consumer, via `useChat`).

The golden rule for this contract: **reuse official AI SDK parts first. Only invent a `data-*` part for data the official protocol has no part for.** A custom part that duplicates an official one is a bug (see the file-token precedent below), not a feature.

> Sources of truth (re-verify, do not trust memory — AGENTS.md "industry practice" rule): the bundled v7 docs at `node_modules/ai/docs/04-ai-sdk-ui/20-streaming-data.mdx`, `.../25-message-metadata.mdx`, `.../50-stream-protocol.mdx`, and the `UIMessagePart` union in `node_modules/ai/dist/index.d.ts`.

---

## 1. Official protocol — the catalog you MUST check before inventing anything

The AI SDK gives three distinct, first-class mechanisms. Most "I need to send X alongside the reply" needs are already covered by one of them.

### 1a. Official `UIMessagePart` types (persisted in `message.parts`)

| Part type          | Use it for                                             |
| ------------------ | ------------------------------------------------------ |
| `text`             | assistant/user text                                    |
| `reasoning`        | model reasoning / thinking                             |
| `tool-<name>`      | a typed tool call + its input/output (static tools)    |
| `dynamic-tool`     | a tool whose name isn't known at compile time          |
| `file`             | a file/document reference or attachment (URL-based)    |
| `reasoning-file`   | a provider reasoning attachment, disclosed separately  |
| `source-url`       | a cited web source (RAG) — emit via `sendSources:true` |
| `source-document`  | a cited document source (RAG)                          |
| `step-start`       | multi-step boundary marker                             |
| `steering-message` | 运行中加入下一 step/任务的用户补充（experimental）     |
| `data-<name>`      | **app-specific** dynamic data (the escape hatch)       |

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

1. Is it **text / reasoning / a tool call / a file / a cited source / a steering supplement**? → use the official part (`text`/`reasoning`/`tool-*`/`file`/`source-*`/`steering-message`). **Never** wrap these in a custom `data-*` part.
2. Is it **message-level info** (timestamp, model, tokens, finish reason)? → use **message metadata**, not a `data-*` part.
3. Is it **app-specific dynamic data with no official part**? → use a `data-*` part. Then decide persistence:
   - Needs to survive reload / be seen by the model next turn → **persistent** (add to `ChatUIDataTypes`, render from `message.parts`).
   - Pure ephemeral UI signal → **transient**, consumed only via `onData`.
   - Progressive updates to one logical thing → **reuse one `id`** (reconcile), don't append N parts.

### Precedent: the file-token redundancy (do not repeat)

An earlier iteration embedded a **custom file token** in message text to reference an attached document. That duplicated the official `file` part and was removed in favor of `file` parts (the conversation content URL identifies the document by its path). Lesson: a custom encoding that an official part already expresses is redundant — delete it.

---

## 3. Our custom `data-*` registry (audited — all justified, none redundant)

There is **one** stream — the main chat stream:

- **Main chat stream** — `POST .../stream`, typed as `ChatUIMessage = UIMessage<ChatMessageMetadata, ChatUIDataTypes>` (`apps/frontend/packages/ai-elements/src/Conversation/lib/chat-message.ts`).

The browser receives media results on the main stream. Runtime observes the durable worker task internally. Ordinary files are generated and persisted in the active workspace independently of display. Cloud and local both project each file from an explicit terminal `upload_artifacts` batch to persistent `data-file`; there is no delegated-file stream, implicit turn-change scan, or model-authored HTML marker.

| `data-*` type | Stream | Persistence | Reconciled by id | Direction | Producer | Consumer | Why not an official part |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `data-conversation-title` | main | transient | no | server → client | Runtime `agent/runs/run.ts` (`writer.write`, first turn); Chat BFF observes the same frame and conditionally persists product metadata | `useConversationChat.ts` `onData` → header + sidebar | No official "conversation title" part; title is conversation-level, not message-level, so metadata is wrong too. Transient + `onData` is the documented pattern. |
| `data-model-retry` | main | transient | no | runtime → client | Shared `createModelStreamRetryPolicy`; Cloud `agent/runs/run.ts` and Electron `runtime/session-manager.ts` publish retrying/recovered/failed plus the bounded reason enum `dns | timeout | connection_reset | incomplete_stream | provider_unavailable` for the current model step or automatic compaction call | Cloud `useConversationChat.ts` and local `pages/local/LocalSession.tsx` `onData` → inline reconnect status | No official UIMessage part represents provider reconnect progress. The status is turn-local, must not enter model/history context, and is therefore transient. The reason is deliberately diagnostic but contains no provider message, host, URL or request id. |
| `data-context-compaction` | main | transient | no | runtime → client | Shared history projector and step compactor publish `started/completed` with `history|step`; Cloud buffers events produced before its writer is attached, Desktop publishes them directly | Cloud `useConversationChat.ts` and local `pages/local/LocalSession.tsx` `onData` → inline compaction status | Compaction is a potentially slow runtime operation, not assistant content or message metadata. The lifecycle must be visible without entering the journal or future model context. |
| `data-context-usage` | main | transient | no | runtime → client | Cloud `agent/runtime/cloud-turn.ts` and Electron `runtime/session-manager.ts` publish an estimated snapshot immediately before each model request and a provider-confirmed snapshot when that step ends | Cloud `useConversationChat.ts` and local `pages/local/LocalSession.tsx` `onData` → composer context meter | Official message metadata records terminal usage for one assistant message. This value describes the active next-model context and must update at model-step boundaries during a multi-step turn; it is therefore transient and is not emitted per text delta. |
| `data-skill-activation` | main | persistent | no | **client → server** (+ persisted) | `pages/Chat.tsx` (`submit`, added to the user message when a `/` skill is active) | `agent/context/file-parts.ts` (`activatedSkillNameFromParts` → server injects `<activated_skill>` body for that turn) + `components/ChatMessageView.tsx` (renders a skill badge) | No official "invoke this skill" part. The L2 body never rides the part — only the skill `name`. Persisted so history/continuation show which skill drove the turn; the projector's `convertDataPart` returns `undefined` for it, so older turns are dropped from model context and the body is injected server-side only for the turn its message triggers. |
| `data-file` | main | persistent | no | runtime → client (+ persisted) | Shared `fileDataChunks` projects the terminal `upload_artifacts` result; Cloud applies it in `agent/streams/native-parts.ts`, local in Electron `runtime/session-manager.ts` | `ChatMessagePart` → inline `ChatFileTag` | Both modes use one explicit publication tool and keep its ordinary tool part observable. Cloud commits a Session file/Storage revision and keeps internal occurrence provenance; local validates the real authorized path and returns a stable local file reference. The public display contract exposes stable `file_id` plus display metadata and optional `workspace_path`; `data-file.id` is that `file_id`, never an occurrence/revision/hash identity. |

### Verdict on redundancy

- **None of these duplicate an official part.** Each carries app-specific data the protocol has no part for, using the official mechanism correctly (transient+`onData`; persisted reference part).
- We already use official parts everywhere one exists: `text`, `reasoning`, `tool-*`, `file`, and `source-*` (`sendSources: true`). Do not wrap any of these in `data-*`.
- Known non-redundant overlaps to leave alone:
  - A user attachment is a native `file` part with a stable URL of the form `/api/chat-server/conversations/:id/files/:fileId/content`. The file belongs to the originating conversation.
  - Media generation uses official tool outputs. `generate_images` returns the published session files in `images` with `count` and `failed`. `generate_video` completes with a published session `file`, prompt and duration. Each file carries its session file ID and display metadata. See the [media tool implementation](../../apps/backend/services/runtime/src/application/agent/tools/builtins/media.ts).
  - Tool definitions carry `toolMetadata.agent` with capability, effect, execution, source, trust, and `uiKind`. AI SDK propagates this metadata onto official tool parts; the frontend selects media/todo/approval UI by `uiKind`, not by hard-coded public tool names. The transcript shows ordinary calls in order. `todo-list` calls are represented by one current checklist attached inside the composer surface above the editor, separated by the composer's divider instead of being duplicated in transcript rows. The checklist is projected from retained UIMessage history: the latest successful non-empty snapshot wins across assistant replies; a successor that is still streaming or fails leaves that snapshot visible, while an empty successful snapshot clears it. Deliverable-derived progress is scoped to the assistant message that owns the snapshot so a later unrelated turn cannot complete an older task. Todo approvals and failures remain actionable or diagnosable in the transcript. All calls remain in the persisted UIMessage parts. `subagent` denotes one official tool part containing one to three actual inline child ToolLoopAgents and their nested UIMessage progress. `artifact` marks the trusted cloud `upload_artifacts` result that the stream layer projects to one `data-file` per uploaded file; the UI renders those ordered data parts while the upload remains an ordinary observable tool call rather than a specialized preview card. Persisted fork tool parts add `agent.historical: true`; external task approvals remain in the original conversation. Unfinished/preliminary results become native `output-error`, never a replay request.
  - `update_plan` takes an optional explanation and a complete `plan` array. Each item contains `step` and `status`. The UI renders the latest usable snapshot in the composer header. The model receives the text `Plan updated`.
  - Persisted `tool-update_plan` UIMessage output is also the model-side truth source while it remains in retained history. The context projector never reconstructs or dynamically injects Todo business state (docs/ADR/agent-runtime.md).
  - On explicit user cancellation, unfinished official tool parts are persisted as `output-error`; no cancellation `data-*` part is added. Non-completed `update_plan` items become `cancelled`, which is a terminal persisted todo status. Navigation-only disconnects do not perform this transition. See docs/ADR/agent-runtime.md.

---

Runtime schemas for application metadata and registered `data-*` parts live in [chat-ui.ts](chat-ui.ts). `just sync` generates backend and frontend modules; `just sync-check` rejects drift. Native parts remain owned by AI SDK. Hydration validates native parts and these extensions; an absent metadata field is valid for ordinary user messages, while present run/fork metadata must match its schema.

## 4. Request, replay, and journal invariants

`POST /conversations/{conversationId}/stream` carries one logical operation. In addition to the SDK message it requires:

| Field | Contract |
| --- | --- |
| `trigger` | `submit-message` or `regenerate-message`; tool continuation is derived from the submitted awaited assistant message. |
| `messageId` | Explicit edit/regenerate/continuation target when the SDK operation supplies one. It is not inferred from the last array element. |
| `expected_revision` | Last hydrated conversation history revision. A stale value is a conflict, never an implicit merge. |
| `request_id` | Stable logical-operation id. `(conversation_id, request_id)` binds to a canonical fingerprint of the full operation, target, message and run context; exact retries replay the same run, any changed reuse is rejected. |

The browser cannot start a history mutation until hydration and UIMessage schema validation have established `expected_revision`. History selection and explicit request replay are each single-flight operations; a selection response applies only if the SDK message snapshot is unchanged. Chat maps the URL of a user-originated `file` to the authorized Runtime Session before journaling. Runtime verifies the attachment belongs to that Session and rebuilds the part with its registered metadata. User parts cannot supply `providerReference`. The journal retains the stable file URL. During model projection, ordinary files become read-only workspace paths and vision models receive supported images from the registered Storage revision at a maximum dimension of 1536 pixels.

The response is the official UIMessage SSE protocol. The outer composition owns the only public message `start`/`finish`. Nested model conversion retains its SDK finish internally to capture `finishReason`; the composition suppresses that inner finish before merging content. Files are published per new chunk in order, never by scanning the assembled continuation for already published files. Search evidence is projected to native `source-*` while the original tool output remains intact. Model `file` and `reasoning-file` parts must be published to an authorized conversation resource before the finish can be committed. A successful `upload_artifacts` result remains one batch tool result for harness continuity and is projected once per uploaded file to ordered `data-file` parts for inline display; those references are not duplicated as native `file` parts. Cloud and local differ only in the host `deliver` adapter and persistence authority, not in the tool or stream protocol.

`GET /conversations/{conversationId}/stream` resumes the locally active Turn. Runtime atomically returns a materialized replay from `start` and subscribes the response to the same producer's live tail. The projection coalesces text/reasoning/tool-input deltas, retains current tool and persistent data state, and excludes transient notifications; it is not a cumulative encoded SSE log. Its merge rules remain equivalent to AI SDK consumption: message metadata recursively merges objects, arrays/primitives replace, and text/reasoning deltas retain the latest non-null provider metadata. Initial replay is pull-driven; the live queue retains incoming chunks in order up to the Node object-stream high-water mark. A subscriber exceeding that budget is disconnected without affecting the Run or other subscribers.

When no local hub exists, `204` is not an ambiguous cache miss. A running or cancelling Turn returns `x-agent-run-state: active-detached` plus `x-agent-run-id`, and the client retries only lightweight GET `/stream`; `x-agent-run-state: idle` causes one PostgreSQL completed-step/terminal hydration. An exact duplicate POST subscribes to the existing local hub, or returns `409 active_run_detached` with the same headers when the active Run is not attached to this process. A duplicate whose Turn is waiting for input or has finished returns `409 run_settled` for journal hydration. Redis capacity, eviction, or availability never aborts a Turn. Explicit Stop uses the cancel endpoint and the run AbortSignal. After stopping the local reader, the client re-reads authoritative `active_run_id` before cancellation so a claimed POST whose response headers were not observed is still cancelled.

PostgreSQL is the semantic source of truth. Each completed model step updates the same materialized assistant item; the finalizer atomically commits tool terminal state, assistant UIMessage, run status/token usage, selected history leaf and lease removal. Terminal/missing runs and expired leases are reclaimed instead of blocking history selection or deletion; an expired active run becomes `interrupted`. Selected pointer and message graph reads use one ordered database transaction so consumers never observe a new pointer with an old graph. Stream chunks, subscribers and cache state are never recovery authority.

运行中的用户输入走独立的非流式 admission/status API，但最终语义仍回到同一条 UIMessage stream。POST `/inputs` 必须携带 route 一致的 `expected_run_id`、稳定 `client_message_id`、正文和 `follow-up|next-turn` mode；同 id 仅允许完全相同重试。普通 composer 固定使用 `follow-up`，使补充或纠偏优先进入同一 run 的下一次模型决策；`next-turn` 只表达“当前任务终答后再做下一项”。显式 cancel 是独立 API，任一输入 mode 都不得暗中取消当前工具或整轮。Chat 在 PostgreSQL `agent_run_inputs` 保存 `accepted → dispatching → delivered|not_delivered|unconfirmed`，持有 run lease 的进程才可调用底层 SDK steering。`delivered` 以官方 `steering-message` part 持久化；`not_delivered` 与 `unconfirmed` 均保留给用户判断，客户端不得自动创建下一 turn 或盲目重发。GET 单项状态用于实时对账，run 级列表用于刷新后的 pending 恢复。

`follow-up` 使用 AI SDK `steer()` 的安全 step boundary：当前采样 response 及其已经生成的工具调用保持完整，工具完成后最新 user message 才进入下一次模型决策。普通 follow-up 不取消工具、不截断 sampling、不伪造 `execution-denied`，也不使用 run AbortSignal；显式 cancel 才会中断整轮。`next-turn` 使用 `queue()`，等当前任务终答后再进入后续任务。

Shared Agent harness 保留 SDK 提供的 steering message，把正文作为最新普通 `role:user` 消息传入，不复制进 system instruction，也不增加一套 response gate 或工具副作用策略。模型在下一 step 决定如何吸收补充并继续原任务。客户端在 input admission 成功后立即把补充渲染为 composer 上方的临时用户行；它位于流式 transcript 的 `MessageScrollerContent` 测量边界外，不随 text delta 参与滚动校正。官方 `steering-message` 到达后按稳定 id 去重并进入 transcript，`not_delivered`/`unconfirmed` 则继续在临时队列中保留可见状态供用户判断。

## 5. Checklist when adding a streamed field (paste into your PR reasoning)

- [ ] Walked the §2 ladder; confirmed no official part/metadata already covers it.
- [ ] Chose transient vs persistent deliberately (reload + model-visibility test).
- [ ] Progressive updates reuse one `id` instead of appending parts.
- [ ] Added the type to `ChatUIDataTypes` (persistent) or documented it as transient-only (`onData`).
- [ ] Added a row to the §3 registry table above.
- [ ] Producer and consumer file paths recorded.
