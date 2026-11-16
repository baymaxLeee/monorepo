# Shared Runtime Agent harness

Runtime server and the Electron utility process are the two hosts. This package owns the portable primary SDK loop, instruction assembler, step policy, tool manifest/outcome, Bash definition and approval policy. Hosts inject model, sandbox, persistence and observation capabilities; never import a service, database, Electron, credentials or host filesystem here. Keep SDK native approval, cancellation and UIMessage protocols. No parallel local tool protocol.

Run `just test shared/agent-runtime`, both host tests and builds, and root lint.
