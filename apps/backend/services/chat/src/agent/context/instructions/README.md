# Instruction assembly

The chat agent's system instructions are assembled here from **code-owned
layers** into one fixed-order XML document. There is no free-text prompt slot:
`assembler.ts` is the only place that produces `ToolLoopAgent.instructions`.

## Fixed layers (order is code-owned, callers cannot reorder)

```xml
<agent_instructions version="2">
  <core_policy>...</core_policy>                 <!-- core-policy.ts   — safety/trust/completion; code constant -->
  <runtime_contract mode="...">...</runtime>     <!-- runtime.ts       — normal/plan protocol; code constant -->
  <execution_protocol>...</execution_protocol>   <!-- execution.ts     — per-step context/skill/tool loop -->
  <capability_contract>...</capability_contract> <!-- assembler.ts     — from resolved tool manifests (plan mode only today) -->
  <available_skills>...</available_skills>       <!-- assembler.ts     — from structured SkillListing[] contributions -->
  <activated_skill>...</activated_skill>         <!-- assembler.ts     — active logical-turn Skill -->
  <bot_profile>...</bot_profile>                 <!-- bot-profile.ts   — configured identity, XML-escaped -->
  <user_memory_data>...</user_memory_data>       <!-- context-data.ts  — bounded, low-authority approved memory -->
  <environment>...</environment>                 <!-- assembler.ts     — server-owned date -->
</agent_instructions>
```

Files: `assembler.ts` (composition + capability/skills/environment rendering),
`core-policy.ts`, `runtime.ts`, `bot-profile.ts`, `context-data.ts`, `xml.ts`,
`types.ts`. IO (memory/doc loading) lives one level up in
`context/instruction-loader.ts` so this directory stays a pure rendering layer.

Trust decreases top→bottom. `core_policy` states that Bot profile and memory are
configuration/data rather than capability authority:
capabilities, approval, mode and safety are enforced in code
(`activeTools` / `toolApproval` / tool implementations), **not** by this text.
Concrete tool routing and invocation policy belongs to tool schemas, Skills, or
the mode-specific runtime contract; `core_policy` intentionally names no tools.
Automatic Skill loading is a true data dependency: `load_skill` runs alone in
its step, and clarification or workflow calls are chosen only after its output
has been observed. A successful load removes `load_skill` from later steps in
that ToolLoopAgent execution, and the tool implementation rejects same-step
duplicate loads. A client-tool continuation starts another HTTP execution but
extends the same assistant message and logical turn. Its persisted successful
`load_skill` output is restored as `activated_skill`, `load_skill` stays disabled,
and `read_skill_file` remains available. The model projection replaces every
historical tool output's full body with a short marker, so only the current
logical turn receives the body through `activated_skill`; persisted UI parts are
unchanged. A later real user message starts a new logical turn and must load a
matching Skill again before reading its files. Skills are not
conversation-session state.

## The thin router (extension seam for skills / MCP)

Everything that tool / skill / MCP resolution contributes to the prompt flows
through one typed shape — `InstructionContributions` in `types.ts`:

```ts
interface InstructionContributions {
  capabilities?: string | null;  // → <capability_contract> (code-generated)
  skills?: SkillListing[];        // → <available_skills>    (structured {name, description})
}
```

`tools/catalog.ts#resolve()` populates it. Published, enabled Admin Skills bound
to the current Bot feed `<available_skills>`; the plan-mode capability projection
feeds `capabilities`. **Future MCP assembly plugs in here** by contributing structured `skills` /
`capabilities` — the assembler owns the markup and escapes every value, so there
is deliberately **no free-text instruction channel**: a contributor can never
append a raw `string` to the assembled prompt.

## Boundaries

- Admin config is data. `bot_profile` renders only structured fields; every
  admin/user string is XML-escaped (`xml.ts`). Escaping stops tag breakout, not
  semantic injection — the hard guarantee is the code policy layer above.
- Conversation summaries, Todo snapshots, active-plan references, and document
  references are projected into `messages`, not `instructions`. This keeps the
  system prefix stable and preserves their historical/data semantics. Plan and
  document bodies are read on demand with `read_file`.
- `bot_profile` renders schema-bound `BotProfileSnapshot` fields only (name,
  role, domain, audience, tone) resolved per run from admin — there is no
  free-text path. The admin `system_prompt` column has been dropped; when a bot
  has no structured identity yet, `bot_profile` is simply omitted.
- `environment` stays last so the static prefix (`core_policy`) can be cached.
