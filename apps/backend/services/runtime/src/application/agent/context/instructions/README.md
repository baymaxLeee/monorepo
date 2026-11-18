# Instruction assembly

The chat agent's system instructions are assembled here from **code-owned layers** into one fixed-order XML document. There is no free-text prompt slot: `assembler.ts` is the only place that produces `ToolLoopAgent.instructions`.

## Fixed layers (order is code-owned, callers cannot reorder)

```xml
<agent_instructions>
  <core_policy>...</core_policy>                 <!-- core-policy.ts   — safety/trust/completion; code constant -->
  <runtime_contract>...</runtime_contract>       <!-- runtime.ts       — execution contract; code constant -->
  <execution_protocol>...</execution_protocol>   <!-- execution.ts     — per-step context/skill/tool loop -->
  <capability_contract>...</capability_contract> <!-- assembler.ts     — from resolved tool manifests -->
  <available_skills>...</available_skills>       <!-- assembler.ts     — from structured SkillListing[] contributions -->
  <activated_skill>...</activated_skill>         <!-- assembler.ts     — active logical-turn Skill -->
  <user_memory_data>...</user_memory_data>       <!-- context-data.ts  — bounded, low-authority approved memory -->
  <environment>...</environment>                 <!-- assembler.ts     — server-owned date -->
</agent_instructions>
```

Files: `assembler.ts` (composition + capability/skills/environment rendering), `core-policy.ts`, `runtime.ts`, `context-data.ts`, `xml.ts`, `types.ts`. IO (memory/doc loading) lives one level up in `context/instruction-loader.ts` so this directory stays a pure rendering layer.

Trust decreases top→bottom. Capabilities, approval and safety are enforced in code (`activeTools` / `toolApproval` / tool implementations), **not** by prompt text. Concrete tool routing and invocation policy belongs to tool schemas, workspace Skills, or the runtime contract; `core_policy` intentionally names no tools. Automatic Skill loading is a true data dependency: `load_skill` runs alone in its step, and clarification or workflow calls are chosen only after its output has been observed. A successful load removes `load_skill` from later steps in that ToolLoopAgent execution, and the tool implementation rejects same-step duplicate loads. A client-tool continuation starts another HTTP execution but extends the same assistant message and logical turn. Its persisted successful `load_skill` output is restored as `activated_skill`, `load_skill` stays disabled, and `read_skill_file` remains available. The model projection replaces every historical tool output's full body with a short marker, so only the current logical turn receives the body through `activated_skill`; persisted UI parts are unchanged. A later real user message starts a new logical turn and must load a matching Skill again before reading its files. Skills are not session state.

## The thin router (extension seam for skills / MCP)

Everything that tool / skill / MCP resolution contributes to the prompt flows through one typed shape — `InstructionContributions` in `types.ts`:

```ts
interface InstructionContributions {
  capabilities?: string | null; // → <capability_contract> (code-generated)
  skills?: SkillListing[]; // → <available_skills>    (structured {name, description})
}
```

`tools/catalog.ts#resolve()` populates it. Every published, enabled workspace Skill feeds `<available_skills>` for every conversation model. MCP and other workspace capabilities use the same catalog boundary rather than model- or Agent-specific bindings. The assembler owns the markup and escapes every value, so there is deliberately **no free-text instruction channel**: a contributor can never append a raw `string` to the assembled prompt.

## Boundaries

- Admin configuration is structured data. Every Admin/user string rendered into instructions is XML-escaped (`xml.ts`). Escaping stops tag breakout, not semantic injection — the hard guarantee is the code policy layer above.
- The projector performs protocol conversion, pruning, and session-history compaction only. It never injects Todo state or proactively discovered business context. The first Bash call imports read-only saved snapshots; `refresh_session_sources` is reserved for sources another tool adds after that initial import.
- Mutable authoritative references are re-resolved on every run. Activated Skills are loaded from Admin's latest published snapshot, including client-tool continuations. Search outputs remain historical evidence and are not repeated unless the user explicitly requests refreshed/current evidence.
- `environment` stays last so the static prefix (`core_policy`) can be cached.
