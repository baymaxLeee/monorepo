# Current decision snapshots

This directory is the searchable decision layer for agents and humans. Read
[README.md](README.md), then only relevant topics. AGENTS routes work; ADRs record
durable decisions and rationale; schemas, manifests, code and tests enforce them;
Git preserves prior versions.

## Create or update

Before a non-trivial architecture, lifecycle or cross-boundary change, state its
decision key and search the index/headings for the same question.

Update an existing topic when it owns that key. Create a descriptively named topic
when the decision is independently discoverable and at least two apply:

- it spans modules, stacks, services, contracts or runtime phases;
- it changes ownership, authority, lifecycle, recovery, authorization,
  concurrency or a resource/cost boundary;
- credible alternatives and tradeoffs are likely to be revisited;
- future implementation or operations need one stable entry point.

Do not create ADRs for local mechanical edits, ordinary bug fixes, task plans,
validation reports or constants with no durable architectural meaning. Do not hide
a qualifying decision inside a catch-all merely because one exists.

## Authoring

1. Read the owner instructions, current contract and only candidate ADR topics.
2. Verify unfamiliar platform choices against installed source/types and current
   primary sources. Separate project policy from vendor requirements.
3. Update or create the topic with the implementation. Use a stable descriptive
   filename, never a sequence number or date.
4. Add one routing row to [README.md](README.md) for a new topic. Broader docs keep
   only a concise summary and link; remove duplicated policy.
5. Replace superseded text in place. Never append an override, changelog,
   progress diary or “new decision supersedes above” layer.
6. Trace owners, consumers, failure/cleanup paths and tests; run affected checks
   plus `just check-repo`.

## Content contract

Keep a topic compact but sufficient for a fresh agent. Include when relevant:

- current status, scope, owner and source-of-truth statement;
- testable invariants and observable lifecycle/data flow;
- non-obvious context and primary-source evidence;
- rejected alternatives, tradeoffs and residual operational limits;
- failure, cancellation, cleanup, compatibility and migration behavior;
- implementation/consumer links and verification boundary.

Exact wire fields belong in schemas, topology in manifests, procedures in
runbooks/playbooks and executable rejection in tests. Mark proposals explicitly;
documentation cannot prove implementation or passing checks. Preserve unrelated
in-flight documentation.
