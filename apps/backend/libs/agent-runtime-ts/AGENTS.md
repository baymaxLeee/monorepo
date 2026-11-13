# Shared Agent harness

Chat service and Electron are the two hosts. This package owns the primary SDK loop, instruction assembler, step policy, tool manifest/outcome, Bash definition and approval policy. Hosts inject model, sandbox, persistence and observation capabilities; never import a service, database, Electron, credentials or host filesystem here. Keep SDK native approval, cancellation and UIMessage protocols. No parallel local tool protocol.

Run `just test backend/agent-runtime-ts`, both host tests and builds, and root lint.
