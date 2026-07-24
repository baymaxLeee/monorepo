# Chat UIMessage stream contract (chat backend ↔ chat frontend)

The chat SSE stream is a **cross-stack wire contract**, exactly like `openapi/`
and `proto/` — so it lives here. It is the Vercel AI SDK **UI Message Stream**
carried over SSE between `services/chat` (producer) and `apps/frontend/apps/chat`
(consumer, via `useChat`).

The golden rule for this contract: **reuse official AI SDK parts first. Only
invent a `data-*` part for data the official protocol has no part for.** A custom
part that duplicates an official one is a bug (see the file-token precedent
below), not a feature.

> Sources of truth (re-verify, do not trust memory — AGENTS.md "industry
> practice" rule): the bundled v7 docs at
> `node_modules/ai/docs/04-ai-sdk-ui/20-streaming-data.mdx`,
> `.../25-message-metadata.mdx`, `.../50-stream-protocol.mdx`, and the
> `UIMessagePart` union in `node_modules/ai/dist/index.d.ts`.

---

## 1. Official protocol — the catalog you MUST check before inventing anything

The AI SDK gives three distinct, first-class mechanisms. Most "I need to send X
alongside the reply" needs are already covered by one of them.

### 1a. Official `UIMessagePart` types (persisted in `message.parts`)

| Part type            | Use it for                                             |
| -------------------- | ------------------------------------------------------ |
| `text`               | assistant/user text                                    |
| `reasoning`          | model reasoning / thinking                             |
| `tool-<name>`        | a typed tool call + its input/output (static tools)    |
| `dynamic-tool`       | a tool whose name isn't known at compile time          |
| `file`               | a file/document reference or attachment (URL-based)    |
| `source-url`         | a cited web source (RAG) — emit via `sendSources:true` |
| `source-document`    | a cited document source (RAG)                          |
| `step-start`         | multi-step boundary marker                             |
| `data-<name>`        | **app-specific** dynamic data (the escape hatch)       |

### 1b. Message metadata (`message.metadata`, message-level, not a part)

For information *about the message as a whole* — timestamps, model id, token
usage, finish reason. Sent via the `messageMetadata` callback of
`toUIMessageStream`; read via `message.metadata`. **Do NOT model these as
`data-*` parts.**

### 1c. `data-*` parts (the escape hatch) — two flavors

- **Persistent** `data-<name>` (optionally with a stable `id`): added to
  `message.parts`, survives reload. Writing the **same `id`** again *reconciles*
  (updates in place) — this is the official mechanism for progressive/live
  updates (progress bars, collaborative artifacts).
- **Transient** `data-<name>` (`transient: true`): sent over the wire but **not**
  added to history. Only observable via `useChat({ onData })`. The official
  mechanism for ephemeral UI signals (status, notifications).

---

## 2. Reuse-first decision rule (avoid redundancy)

Before adding any new streamed field, walk this ladder and stop at the first hit:

1. Is it **text / reasoning / a tool call / a file / a cited source**? → use the
   official part (`text`/`reasoning`/`tool-*`/`file`/`source-*`). **Never** wrap
   these in a custom `data-*` part.
2. Is it **message-level info** (timestamp, model, tokens, finish reason)? → use
   **message metadata**, not a `data-*` part.
3. Is it **app-specific dynamic data with no official part**? → use a `data-*`
   part. Then decide persistence:
   - Needs to survive reload / be seen by the model next turn → **persistent**
     (add to `ChatUIDataTypes`, render from `message.parts`).
   - Pure ephemeral UI signal → **transient**, consumed only via `onData`.
   - Progressive updates to one logical thing → **reuse one `id`** (reconcile),
     don't append N parts.

### Precedent: the file-token redundancy (do not repeat)

An earlier iteration embedded a **custom file token** in message text to
reference an attached document. That duplicated the official `file` part and was
removed in favor of `file` parts (`documentIdFromFilePart` parses the document id
out of a `/documents/:id/source` URL). Lesson: a custom encoding that an official
part already expresses is redundant — delete it.

---

## 3. Our custom `data-*` registry (audited — all justified, none redundant)

There is **one** stream — the main chat stream:

- **Main chat stream** — `POST .../agents/run/stream`, typed as
  `ChatUIMessage = UIMessage<unknown, ChatUIDataTypes>`
  (`apps/frontend/apps/chat/src/lib/chat-message.ts`).

There is no separate task-progress SSE stream. Delegated file and video progress
now ride the main stream as **preliminary `tool-*` results** (see ADR-0035): the
`delegate_tasks` and `create_video_production` tools poll executor
`GET /tasks/:id` and `yield` running snapshots (`done`/`total`,
`progress_done`/`progress_total`) that the SDK emits as preliminary tool
outputs, then a terminal `yield` with the published path(s) or production id.
`ChatArtifactCard` /
`ChatVideoCard` read progress straight off the tool part — no second connection,
no `data-artifact-progress`.

| `data-*` type              | Stream | Persistence | Reconciled by id | Direction        | Producer                                                       | Consumer                                                    | Why not an official part                                                                                   |
| -------------------------- | ------ | ----------- | ---------------- | ---------------- | ------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `data-conversation-title`  | main   | transient   | no               | server → client  | `agent/runs/run.ts` (`writer.write`, first turn)              | `pages/Chat.tsx` `onData` → header + sidebar               | No official "conversation title" part; title is conversation-level, not message-level, so metadata is wrong too. Transient + `onData` is the documented pattern. |
| `data-plan-execution`      | main   | persistent  | no               | **client → server** (+ persisted) | `pages/Chat.tsx` (`executePlan`, added to the user message)  | `agent/context/file-parts.ts` + `agent/agents/tool-loop.ts` | No official "execute this file" part. The part persists only the stable Plan path; the run projects that reference and forces `read_file` over contiguous line ranges until the selected Plan is fully read before execution tools are enabled. |
| `data-skill-activation`    | main   | persistent  | no               | **client → server** (+ persisted) | `pages/Chat.tsx` (`submit`, added to the user message when a `/` skill is active) | `agent/context/file-parts.ts` (`activatedSkillNameFromParts` → server injects `<activated_skill>` body for that turn) + `components/ChatMessageView.tsx` (renders a skill badge) | No official "invoke this skill" part. Mirrors `data-plan-execution` (client→server reference): the L2 body never rides the part — only the skill `name`. Persisted so history/continuation show which skill drove the turn; the projector's `convertDataPart` returns `undefined` for it, so older turns are dropped from model context and the body is injected server-side only for the turn its message triggers (ADR-0033 §4, ADR-0036). |

### Verdict on redundancy

- **None of these duplicate an official part.** Each carries app-specific
  data the protocol has no part for, using the official mechanism correctly
  (transient+`onData`; persisted reference part).
- We already use official parts everywhere one exists: `text`, `reasoning`,
  `tool-*`, `file`, and `source-*` (`sendSources: true`). Do not wrap any of
  these in `data-*`.
- Known non-redundant overlaps to leave alone:
  - Source-document references use an official `file` part whose URL carries
    the document id. Plan execution uses `data-plan-execution` as a command
    reference containing a stable virtual path, not copied Plan content: the
    tool loop forces `read_file` to read that path completely. There is no separate
    `document_ids` request field.
  - `delegate_tasks` carries BOTH coarse control-flow
    (`task_id` + stable `path`) and per-file progress
    (`done`/`total`) on the SAME `tool-delegate_tasks` part:
    preliminary `yield`s while polling executor `GET /tasks/:id`, then a
    terminal `yield` with the atomically published `paths`.
    There is no separate progress channel (ADR-0035 collapsed the old
    task-progress SSE into these preliminary tool results).
  - `generate_images` (media generation) returns its result **as tool output**,
    not a custom part: an inline async-generator tool emits a running
    ToolOutcome with progress `{ count }`, then a completed or partial
    ToolOutcome whose data is
    `{ images: [{ document_id, filename, media_type }], count, failed }`.
    Business failures use a structured ToolOutcome on the official
    `output-available` state and AI SDK `toModelOutput` maps blocked/failed to
    model-side `error-json`; Abort and protocol failures use `output-error`. A multi-image request is ONE call with a
    `prompts[]` array (one image per prompt, generated concurrently); `count` is
    the requested total and `failed` how many prompts dropped (partial gallery).
    See ADR-0022 for the parallel-deliverable execution model. The frontend
    `ChatImageCard` renders a
    **lightweight reference card** (icon + count, zero bytes fetched at render);
    clicking it opens the image lightbox, which fetches the group from those
    `document_id`s on demand (served via `/documents/:id/source`, the same route
    `file` parts use) — no `data-*` part is needed because the tool part already
    carries everything. Generated bytes live in Knowledge, never a temporary
    provider URL (ADR-0014); the transcript never inlines them (ADR-0021).
  - `create_video_production` creates a durable production task. It yields
    preliminary `{ status, task_id, kind: "video" }` results while Executor
    plans, then a completed result carrying `production_id` once the initial
    storyboard and cost projection are durable. The same Workflow continues
    approvals, paid generation, Take review, assembly, and publication after
    the chat tool has completed. `ChatVideoCard` opens the director workspace
    from that production id; no second task-progress stream or custom `data-*`
    part is needed.
  - Tool definitions carry `toolMetadata.agent` with capability, effect,
    execution, source, trust, and `uiKind`. AI SDK propagates this metadata onto
    official tool parts; the frontend selects artifact/media/todo/approval UI by
    `uiKind`, not by hard-coded public tool names. This is metadata on the
    official tool part, not a custom `data-*` channel.
  - `check_file` uses `uiKind: "validation"` and returns deterministic
    diagnostics on its official `tool-check_file` part. No validation `data-*`
    part or secondary stream exists.
  - `update_todos` output items carry an optional `deliverable` tag
    (`"artifact" | "image" | "video"`). It is **not** a new part: it rides the
    existing `tool-update_todos` output. The frontend
    (`ChatTodoListCard.collectDeliverableCompletion`) reads the live
    `image-gallery`/`video`/`artifact` tool parts emitted after the latest
    `update_todos` and advances each tagged todo to completed the instant its own
    deliverable card finishes — because a parallel html/image/video step
    `Promise.all`-blocks until the slowest one returns, the model cannot restate
    the snapshot in-step. This is display-layer derivation from official tool
    parts (the completion fact already on the wire), so no `data-*` part is
    added; the model's next-step `update_todos` remains the canonical snapshot.
    See ADR 0024.
  - Persisted `tool-update_todos` UIMessage output is also the model-side truth
    source while it remains in retained history. The context projector never
    reconstructs or dynamically injects Todo business state (ADR 0041).
  - On explicit user cancellation, unfinished official tool parts are persisted
    as `output-error`; no cancellation `data-*` part is added. Non-completed
    `update_todos` items become `cancelled`, which is a terminal persisted todo
    status. Navigation-only disconnects do not perform this transition. See
    ADR 0025.

---

## 4. Checklist when adding a streamed field (paste into your PR reasoning)

- [ ] Walked the §2 ladder; confirmed no official part/metadata already covers it.
- [ ] Chose transient vs persistent deliberately (reload + model-visibility test).
- [ ] Progressive updates reuse one `id` instead of appending parts.
- [ ] Added the type to `ChatUIDataTypes` (persistent) or documented it as
      transient-only (`onData`).
- [ ] Added a row to the §3 registry table above.
- [ ] Producer and consumer file paths recorded.
