# Shared Runtime Agent harness

Follow the current [Agent Runtime decision](../../docs/ADR/agent-runtime.md). This
portable package is consumed by Runtime server and the Electron utility process.

- Own one `RuntimeTurn`, AI SDK loop adapter, input queue, context/instruction
  projection, tool manifest/outcome, execution authority, approval policy and
  portable tool registry. Do not add Agent factories/profiles or a second loop,
  permission model, prompt assembler or tool protocol.
- Hosts inject model, sandbox, persistence, process and observation capabilities
  plus only their real domain manifests. Duplicate tool names fail closed; hosts
  do not enumerate shared manifests independently.
- Keep host concerns out: no service source, database, Electron API, credentials,
  cloud Storage or host filesystem implementation.
- Preserve AI SDK native message, stream, approval and cancellation protocols.
  Codex/Pi references in the ADR guide semantics and exposure, not package layout
  or a replacement runtime.
- Export one public root API. Hosts never import implementation paths.

Run `just test shared/agent-runtime`, both host tests/builds and root lint for
public lifecycle, manifest or protocol changes.
