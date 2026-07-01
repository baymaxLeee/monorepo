---
name: plan
description: >-
  Mandatory solution-design / architecture skill for THIS repository. Every code
  agent (Cursor, Codex, Claude Code, ...) MUST follow it whenever planning,
  designing, architecting, reviewing, or deciding how to implement a feature,
  service, agent runtime, refactor, or migration — and before writing any
  non-trivial code. Use it for any "plan / design / architecture / RFC / ADR /
  refactor / tech-selection / 方案 / 设计 / 架构 / 技术选型" work. It encodes five
  hard constraints: think critically with no preconceptions; ground every AI
  decision in the latest Vercel AI SDK (ToolLoopAgent + Workflow DevKit +
  harness) and AI Elements official best practices; build a single-agent-first
  runtime for long/complex tasks with no role-play multi-agent theatre; copy the
  core designs of Claude Code / Codex / Cursor instead of inventing; and refactor
  legacy problems directly with no historical baggage.
---

# Plan — mandatory solution-design constraints for this repo

> This skill governs the **design / architecture decision phase**. Any code agent
> MUST read it and comply for the full duration of any planning, design,
> architecture, review, tech-selection, or refactor task. It is the same source
> as the root `AGENTS.md` rules "Industry practice before platform decisions",
> "Future-first compatibility policy", and "AI-Native technology preference", and
> reinforces them. On conflict, the stricter rule wins.

Treat the five constraints below as a pre-flight checklist: satisfy each one, and
show that you did in your plan / PR reasoning.

## 1. No preconceptions — review critically

Critically re-examine **all** existing architecture, designs, and code. Never
assume "it exists, so it's correct." Every prior decision must be re-derivable
from first principles; if you cannot re-justify it, it is a candidate for change.

- **Do** ask "does this design still hold, and why?" before extending it.
- **Do** back every claim with a source (official docs / benchmark product / a
  real measurement).
- **Do NOT** copy the current pattern just because it is already there.
- **Never** justify a decision with memory, habit, or "that's how it was."

## 2. Ground every AI decision in the latest official best practice

You MUST look up the **latest** Vercel AI SDK (`ToolLoopAgent` + Workflow DevKit
+ harness abstractions) and AI Elements guidance — the forward-looking,
AI-Native agent-runtime foundation. Your training memory of the SDK is almost
certainly stale.

- **Do** consult authoritative sources in order: bundled `node_modules/ai/docs/**`
  and `node_modules/ai/dist/*.d.ts` → then ai-sdk.dev → then the `ai-sdk`,
  `workflow`, `ai-gateway` skills.
- **Do** reuse official protocol primitives. For the chat stream / any custom
  `data-*` part, read `schemas/streaming/chat-uimessage-stream.md` first.
- **Do NOT** rely on remembered SDK APIs; verify against source/docs, then
  typecheck.
- **Do NOT** add a limit / config knob / timeout / orchestration rule without a
  clear product, operational, or official-practice basis (root AGENTS.md).
- **Never** reinvent a primitive the SDK already provides (e.g. a custom part
  that duplicates the official `file` / `source-*` / tool / metadata parts).

## 3. Single-agent-first runtime for long / complex tasks

The core architecture is **one primary agent**, with a small number of
subAgents added later only as **assistance**, built for **long-running, complex
tasks**. This is not a role-play system.

- **Do** default to one agent + one context window + a thin harness (the SDK owns
  the tool-call loop; the prompt supplies policy, not manual orchestration).
- **Do** reserve subAgents for exactly three cases: context-free grunt work
  (codegen / mass migration), fresh-eyes review, and read-only exploration that
  returns a compact summary.
- **Do** prioritize long-task concerns: cancellation, resume, compaction,
  tool approval, streaming UX, and context/memory engineering.
- **Do NOT** split one feature across a "frontend agent" and a "backend agent";
  cross-stack decisions must stay in one context.
- **Never** build role-play / persona multi-agent theatre ("PM agent",
  "designer agent", "reviewer persona", etc.). No make-believe division of labor.

## 4. Copy the benchmarks — do not build in a vacuum

Following from #3, base decisions on the core implementations of industry
benchmark agent products — **Claude Code, Codex, Cursor** (and the AI SDK /
frameworks). Much of it can be adopted directly; do not self-invent.

- **Do** research how these products solve the problem first (harness, tool
  protocol, approval, artifacts, streaming, playbooks, agent-facing repo rules),
  then localize.
- **Do** adopt a proven shape rather than an equivalent private convention.
- **Do NOT** invent bespoke abstractions / adapter layers when a mature pattern
  exists.
- **Never** design a platform-level mechanism without checking prior art.

## 5. No historical baggage — refactor directly

Bookending #1: this project is in the demo phase with **no forward-compatibility
obligation**. When existing architecture / design / code has systemic problems in
**performance, security, usability, extensibility, or maintainability**, refactor
it directly — do not hesitate.

- **Do** refactor straight to the target shape and delete obsolete paths.
- **Do** briefly record the new convention (code comment / doc / ADR) by blast
  radius.
- **Do** follow the migration-safety CLI checklist (root AGENTS.md) and
  `.agents/playbooks/**` for large-radius refactors.
- **Do NOT** add compatibility layers, legacy branches, or shims to appease an
  old shape.
- **Never** knowingly leave a systemic problem in place "to be safe" — flag it or
  fix it.

---

## Design workflow (run this in the planning phase)

```
- [ ] 1 Critical review: list the relevant existing designs + a "still valid?" verdict with evidence for each
- [ ] 2 Official alignment: look up current AI SDK / AI Elements usage (cite the exact doc/type path)
- [ ] 3 Benchmark check: state how Claude Code / Codex / Cursor handle this problem
- [ ] 4 Single-agent check: confirm no role-play multi-agent; subAgents limited to the three allowed cases
- [ ] 5 Refactor decision: list systemic problems found + "refactor directly" vs "minimal change" with rationale
- [ ] 6 Close-out: write/update docs/ADR as needed; run `just sync` for cross-stack; `just lint` passes
```

## When to use / when to skip

- **Use** for any plan / design / architecture / tech-selection / review /
  refactor decision, or before writing non-trivial code.
- **Skip** for pure Q&A, single-file tweaks, and mechanical changes with no
  architectural impact.

## Worked examples

For concrete, end-to-end applications of the six-step workflow (two good plans and
one rejected anti-pattern), plus the plan output template, see
[examples.md](examples.md). Read it when you are unsure how to shape a plan.

## Related reading (one level deep, on demand)

- Root `AGENTS.md` — global hard rules (industry practice / future-first / AI-Native)
- `schemas/streaming/chat-uimessage-stream.md` — chat stream protocol: reuse official parts
- `.agents/playbooks/**` — concrete workflows (new-microservice / cross-service-refactor)
- `docs/ADR/**` — existing architecture decisions (read the relevant entry before refactoring)
