# Plan skill — worked examples

Concrete applications of the five constraints and the design workflow. Read the
one closest to your task, then produce a plan in the same shape.

## Contents

- [Output template — how to present a plan](#output-template)
- [Example 1 — Add conversation auto-title (good)](#example-1)
- [Example 2 — Audit custom `data-*` parts vs official protocol (good)](#example-2)
- [Example 3 — "Researcher + writer agents" (anti-pattern, rejected)](#example-3)

---

## Output template

Present every plan as the 6-step workflow, one short paragraph per step. Keep it
evidence-first: cite the exact doc/type/file you checked, not memory.

```markdown
### Plan: <title>

1. Critical review — <existing designs touched + "still valid?" verdict + evidence>
2. Official alignment — <AI SDK / AI Elements usage, with doc/type path cited>
3. Benchmark check — <how Claude Code / Codex / Cursor do this>
4. Single-agent check — <confirm no role-play; subAgent use justified if any>
5. Refactor decision — <systemic problems found + "refactor directly" vs "minimal">
6. Close-out — <ADR/doc updates, `just sync` if cross-stack, `just lint`>
```

---

<a id="example-1"></a>

## Example 1 — Add conversation auto-title (good)

**Task:** auto-name a new conversation from the first user message, updating the
header, sidebar, and DB.

1. **Critical review.** The header already reads `detail.title`; `onFinish`
   already refetches the conversation. No live-title mechanism exists. Verdict:
   extend the existing SSE channel rather than add a new endpoint.
2. **Official alignment.** Checked
   `node_modules/ai/docs/04-ai-sdk-ui/20-streaming-data.mdx` and
   `25-message-metadata.mdx`: title is conversation-level (not message-level → not
   metadata) and has no official part → use a **transient `data-*` part** + the
   `onData` callback (the documented pattern for ephemeral UI signals). Confirmed
   `createUIMessageStream` / `writer.merge` / `transient` exist in
   `dist/index.d.ts`.
3. **Benchmark check.** ChatGPT streams the title live; the Vercel Chat SDK's
   `generateTitleFromUserMessage` generates it from the first message with a small
   model. Adopt both: generate like the Chat SDK, stream like ChatGPT.
4. **Single-agent check.** No new agent; a single concurrent `generateText` call
   inside the same run, merged into the same stream. No orchestration added.
5. **Refactor decision.** Generation runs concurrently and never blocks the first
   token; failure is swallowed. Persist before the transient write so a refresh
   can't race. No compatibility shim needed.
6. **Close-out.** Registered the new `data-conversation-title` part in
   `schemas/streaming/chat-uimessage-stream.md`; typechecked both stacks.

**Why it's good:** every AI decision cites a primary source; reuses the official
transient-data-part mechanism instead of a bespoke channel; stays single-agent.

---

<a id="example-2"></a>

## Example 2 — Audit custom `data-*` parts vs official protocol (good)

**Task:** the team suspects some custom SSE parts duplicate official ones (as an
earlier custom "file token" did).

1. **Critical review.** Enumerated every custom part (`data-plan-execution`,
   `data-conversation-title`, `data-artifact-progress`) with its producer and
   consumer — did not assume any was fine.
2. **Official alignment.** Extracted the authoritative `UIMessagePart` union from
   `dist/index.d.ts` (`text | reasoning | tool-* | file | source-* | data-* |
   step-start | ...`) and the metadata mechanism from the docs. Mapped each custom
   part to "is there an official part for this?" → none existed for title,
   progress, or plan-reference.
3. **Benchmark check.** The AI SDK docs literally list "references to content the
   model refers to", "status/notifications", and "progressive updates" as the
   intended data-part use cases — matching our three.
4. **Single-agent check.** N/A (protocol audit).
5. **Refactor decision.** Verdict: none are redundant; each uses the official
   mechanism correctly. The one *real* redundancy historically was the file token
   → already refactored to the official `file` part. Recorded the reuse-first rule
   so it isn't repeated.
6. **Close-out.** Wrote `schemas/streaming/chat-uimessage-stream.md` (official
   catalog + registry + decision ladder) and linked it from root/service AGENTS.md.

**Why it's good:** grounds the redundancy verdict in the actual type union and
docs, not intuition; produces a durable guardrail.

---

<a id="example-3"></a>

## Example 3 — "Researcher + writer agents" (anti-pattern, rejected)

**Task proposal:** "Build a research feature with a `ResearcherAgent` that
gathers sources and hands off to a `WriterAgent` persona that drafts the report."

**Why this violates the skill (constraint 3 & 4):** it is role-play multi-agent
theatre. Two persona agents mean two context windows and a lossy handoff of every
decision just made — for a task one agent can do end to end.

**Corrected plan:**

1. **Critical review.** The requirement is "gather sources, then write." That is a
   linear tool sequence, not a division of labor.
2. **Official alignment.** One `ToolLoopAgent` with a `web_search` tool and a
   `write_file` tool; the SDK owns the loop (thin harness). Long-running artifact
   generation uses the existing blocking-tool + progress-stream pattern.
3. **Benchmark check.** Claude Code / Codex / Cursor run a single primary agent
   with tools; subagents are reserved for grunt work, fresh-eyes review, or
   read-only exploration — never personas.
4. **Single-agent check.** One agent, one context. If parallel source-gathering is
   truly needed later, dispatch a **read-only exploration subAgent** that returns a
   compact summary — an allowed case — not a "researcher persona."
5. **Refactor decision.** Drop the persona/handoff design entirely; no adapter to
   keep it.
6. **Close-out.** Note the decision in the plan; no ADR needed unless it recurs.

**Why the correction is right:** keeps all cross-cutting decisions in one context,
copies the benchmark single-agent shape, and only uses a subAgent within its
sanctioned role.
