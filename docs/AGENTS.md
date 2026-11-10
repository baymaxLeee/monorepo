# Documentation ownership

[index.md](index.md) is the current-specification router. Maintain one current
document per topic, updating it in place and removing superseded paragraphs.
Do not append revision logs, overrides or a second architecture manual.

- Rules belong in the closest AGENTS; contracts in schemas; dependency/service
  facts in manifests. Link to owners instead of copying inventories.
- Verify changed claims against implementation and tests. Mark proposed behavior
  explicitly; it must not enter the current-specification index as fact.
- ADRs are current topic-based decision snapshots. Update the relevant topic
  directly with implementation evidence and tradeoffs; Git preserves history.
  A durable independently searchable cross-boundary decision may require a new
  descriptive topic rather than being buried in a broad ADR; follow
  [ADR instructions](ADR/AGENTS.md). Do not create numbered successors or append
  overrides to old decisions.
- Plans, baselines and progress notes are opt-in history. Read only relevant
  current topics; do not load chronological history to reconstruct current rules.
- Multi-phase work follows the current
  [completion playbook](../.agents/playbooks/completion-review.md), not ADR logs.
- Verify links, commands and consistency; run `just check-repo`.
  Documentation-only work does not require application tests or builds.
