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

Two separate streams carry these:

- **Main chat stream** — `POST .../agents/run/stream`, typed as
  `ChatUIMessage = UIMessage<unknown, ChatUIDataTypes>`
  (`apps/frontend/apps/chat/src/lib/chat-message.ts`).
- **Task progress stream** — a task-scoped SSE stream consumed by
  `ChatArtifactCard` for fine-grained artifact-generation progress.

| `data-*` type              | Stream | Persistence | Reconciled by id | Direction        | Producer                                                       | Consumer                                                    | Why not an official part                                                                                   |
| -------------------------- | ------ | ----------- | ---------------- | ---------------- | ------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `data-conversation-title`  | main   | transient   | no               | server → client  | `agent/runs/run.ts` (`writer.write`, first turn)              | `pages/Chat.tsx` `onData` → header + sidebar               | No official "conversation title" part; title is conversation-level, not message-level, so metadata is wrong too. Transient + `onData` is the documented pattern. |
| `data-artifact-progress`   | task   | persistent  | **yes** (`id`)   | server → client  | `agent/streams/task-progress.ts` (`ARTIFACT_PROGRESS_DATA_TYPE`) | `components/ChatArtifactCard.tsx`                          | No official "progress" part; id-reconciled data part is the documented pattern for live progressive updates. |
| `data-plan-execution`      | main   | persistent  | no               | **client → server** (+ persisted) | `pages/Chat.tsx` (`executePlan`, added to the user message)  | `agent/context/file-parts.ts` + `agent/context/projector.ts` | No official "reference/execute this document" part. The docs list "references to content the model refers to" as a data-part use case. Persisted so later turns still show which plan was executed. |

### Verdict on redundancy

- **None of the three duplicate an official part.** Each carries app-specific
  data the protocol has no part for, using the official mechanism correctly
  (transient+`onData`; id-reconciliation; persisted reference part).
- We already use official parts everywhere one exists: `text`, `reasoning`,
  `tool-*`, `file`, and `source-*` (`sendSources: true`). Do not wrap any of
  these in `data-*`.
- Known non-redundant overlaps to leave alone:
  - Document references (uploaded files and a plan hand-off) travel ONLY as
    message parts: a `file` part whose URL carries the document id, or a
    `data-plan-execution` part. `agent/context/file-parts.ts`
    (`referencedDocumentIdsFromParts`) extracts them for *this* run's document
    loading, and the same parts *persist* the references into history for future
    turns. There is no separate `document_ids` request field (removed) — one
    channel, two roles.
  - The artifact tool returns coarse control-flow (`task_id` → `document_id`) as
    **tool output**, while `data-artifact-progress` streams fine per-block
    progress. Deliberately separate granularities — do not collapse them.
  - `generate_image` (media generation) returns its result **as tool output**,
    not a custom part: an inline async-generator tool yields
    `{ status: "generating", count }` then a terminal
    `{ status: "completed", images: [{ document_id, filename, media_type }], count, failed }`.
    Execution failures use the official `output-error` state. A multi-image request is ONE call with a
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
  - `generate_video` follows the same tool-output pattern but is a durable task
    (Ark video is async): it yields a preliminary `{ status, task_id, kind:
    "video" }` then a terminal `{ status: "completed", document_id }` over the
    **main chat stream** while the tool foreground-
    blocks. Because those two yields already carry the generating → done
    transition, `ChatVideoCard` needs **no** task-progress SSE subscription (it
    is not per-block like the HTML artifact), and no `data-*` part is added.
    Like `ChatImageCard`, it renders a lightweight card (no inline `<video>`);
    the side-panel preview fetches and plays the clip on open (ADR-0021).
  - Tool definitions carry `toolMetadata.agent` with capability, effect,
    execution, source, trust, and `uiKind`. AI SDK propagates this metadata onto
    official tool parts; the frontend selects artifact/media/todo/approval UI by
    `uiKind`, not by hard-coded public tool names. This is metadata on the
    official tool part, not a custom `data-*` channel.

---

## 4. Checklist when adding a streamed field (paste into your PR reasoning)

- [ ] Walked the §2 ladder; confirmed no official part/metadata already covers it.
- [ ] Chose transient vs persistent deliberately (reload + model-visibility test).
- [ ] Progressive updates reuse one `id` instead of appending parts.
- [ ] Added the type to `ChatUIDataTypes` (persistent) or documented it as
      transient-only (`onData`).
- [ ] Added a row to the §3 registry table above.
- [ ] Producer and consumer file paths recorded.
