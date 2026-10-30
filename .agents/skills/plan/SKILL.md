---
name: plan
description: Design, review or refactor this monorepo's architecture and non-trivial implementations using existing boundaries, current specifications and primary-source evidence. Skip mechanical edits and factual Q&A.
---

# Evidence-based repository design

Follow root and closest AGENTS. User intent and already-authorized scope take
precedence over this workflow; do not manufacture an extra approval gate.

## Establish the contract

Use `just context <path-or-target>` to locate owners and declared consumers.
Trace entry point, implementation, consumers and tests; state observable behavior,
protected invariants and the change boundary. Reassess existing designs using
evidence, not their mere existence. Read current specifications through
[docs/index.md](../../../docs/index.md) and the relevant topic decision. Consult
Git history only for a specific rationale question; do not load old plans by default.

## Choose the design

Prefer existing boundaries and proven primitives. Use current official sources
for platform/technology choices, then confirm APIs in installed types/source.
Use a focused local trace for ordinary repository changes; unrelated AI-runtime
research is not required for a tooling or documentation edit.

For AI runtime/UI changes, consult installed AI SDK docs/types and current
official [AI SDK](https://ai-sdk.dev/docs/agents/overview),
[Workflow](https://workflow.dev/docs) or [AI Elements](https://elements.ai-sdk.dev/docs)
guidance as relevant. Read the
[stream contract](../../../schemas/streaming/chat-uimessage-stream.md) before
custom stream parts. Keep one primary agent, SDK-owned tool execution and a thin
harness; evaluate cancellation, continuation, compaction, approval and persistence
at the affected boundary. Helpers are limited to mechanical work, exploration and
independent review, not role-playing or split frontend/backend ownership.

Benchmark public implementations where they solve the actual problem. Distinguish
verified source from product documentation and unavailable internals. Do not copy
vendor-specific policy or introduce limits without product/operational evidence.
Refactor systemic problems directly and remove obsolete paths; avoid speculative
adapters and unrelated changes.

## Record and verify

Explain the chosen approach, alternatives, source evidence and affected checks
briefly. Update the current owning specification and relevant topic ADR in place.
Keep significant tradeoffs; previous versions remain in Git history.
Do not append another architecture description or historical progress log.

Use [change verification](../../playbooks/change-verification.md) for coupled
changes and [completion review](../../playbooks/completion-review.md) for
multi-phase/service work. Follow the root test/build gates and report actual gaps.
