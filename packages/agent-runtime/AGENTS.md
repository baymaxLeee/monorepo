# Shared Runtime Agent harness

Runtime server and the Electron utility process are the two hosts. This package owns the portable single SDK loop, instruction renderer, step policy, tool manifest/outcome, Bash definition, approval policy and portable tool registry. Do not add Agent factories or reusable Agent profiles. The registry exposes one shared manifest set; hosts inject model, sandbox, persistence and observation capabilities and append only their real host/domain manifests. Duplicate tool names fail closed instead of replacing or selecting capabilities. Hosts must not enumerate shared manifests independently. Never import a service, database, Electron, credentials or host filesystem here. Keep SDK native approval, cancellation and UIMessage protocols. No parallel local tool protocol.

Keep source and public subpaths grouped by responsibility: `agent/` owns the loop and step/runtime control, `tools/` owns tool contracts, policy and implementations, `protocol/` owns UIMessage/artifact lifecycle, and `instructions/` owns prompt rendering. The package root exports only the single reusable harness; hosts bind it directly and other consumers use the owning grouped subpath. Internal source imports use the real module location. Do not restore flat compatibility aliases.

Run `just test shared/agent-runtime`, both host tests and builds, and root lint.
