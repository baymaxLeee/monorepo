# AI-native current decision snapshots

This directory is the searchable decision layer for coding agents and humans.
Read [README.md](README.md), then only the relevant topics. `AGENTS.md` tells an
agent when and where to look; an ADR explains the durable decision and why;
schemas, manifests, code and tests enforce it; Git preserves prior versions.

## Decide whether to create or update

Before a non-trivial architecture, lifecycle or cross-boundary change, state its
decision key in one sentence and search this index/headings for the same question.

Update an existing topic when it already owns that decision key. Create a new,
descriptively named topic when the decision is independently discoverable and at
least two of these apply:

- it spans multiple modules, stacks, services, contracts or runtime phases;
- it changes ownership, source of truth, lifecycle, recovery, authorization,
  concurrency or a resource/cost boundary;
- credible alternatives and tradeoffs are likely to be revisited;
- future implementation or operations work needs one stable entry point.

Do not hide a qualifying decision inside a broad catch-all ADR merely because one
already exists. Do not create an ADR for a local mechanical edit, ordinary bug fix,
task plan, validation report or a constant with no durable architectural meaning.

## Authoring workflow

1. Run `just context <affected-path>` and read the owner instructions, current
   contract and only candidate ADR topics.
2. Verify unfamiliar platform choices against installed source/types and current
   primary sources. Record what is project policy versus a vendor requirement.
3. Update or create the topic in the same change as the implementation. Use a
   stable descriptive filename, never a sequence number or date.
4. Add one routing row to [README.md](README.md) for a new topic. Broader ADRs and
   domain docs retain only a concise summary plus link; remove duplicated policy.
5. Keep current truth in place. Replace superseded paragraphs; never append an
   override, changelog, progress diary or "new decision supersedes above" layer.
6. Trace implementation owners, consumers, failure/cleanup paths and tests. Run
   the affected checks plus `just check-repo` for links and navigation.

## Content contract

Every topic must be compact but sufficient for a fresh agent to act without
reconstructing chat history. Include, when relevant:

- current status, scope and the decision/source-of-truth statement;
- testable invariants and observable lifecycle/data flow;
- non-obvious context and primary-source evidence;
- rejected alternatives, tradeoffs and residual operational limits;
- failure, cancellation, cleanup, compatibility and migration behavior;
- implementation/consumer links and the verification boundary.

Exact wire fields belong in schemas, service topology in manifests, procedures in
runbooks/playbooks and executable rejection in tests. Link to those owners instead
of copying inventories. Mark proposals explicitly; documentation cannot prove an
implementation or passing check. Preserve unrelated in-flight documentation.

## Instruction hygiene

Keep always-loaded AGENTS concise, concrete and scoped; move rationale here and
multi-step execution to skills/playbooks. Avoid conflicting duplicated rules.
This follows the official layered-instruction model used by
[OpenAI Codex](https://developers.openai.com/codex/guides/agents-md) and
[Anthropic Claude Code](https://code.claude.com/docs/en/memory): closer
instructions are more specific, large repositories use path/topic scoping, and
instructions should be verifiable. Neither vendor defines a public ADR format;
the current-topic/Git-history split is this repository's decision.
