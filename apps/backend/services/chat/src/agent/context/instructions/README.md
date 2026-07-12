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
  <bot_profile>...</bot_profile>                 <!-- bot-profile.ts   — configured identity, XML-escaped -->
  <context_data>...</context_data>               <!-- context-data.ts  — memory + docs + projected todo/plan (DATA) -->
  <environment>...</environment>                 <!-- assembler.ts     — server-owned date -->
</agent_instructions>
```

Files: `assembler.ts` (composition + capability/skills/environment rendering),
`core-policy.ts`, `runtime.ts`, `bot-profile.ts`, `context-data.ts`, `xml.ts`,
`types.ts`. IO (memory/doc loading) lives one level up in
`context/instruction-loader.ts` so this directory stays a pure rendering layer.

Trust decreases top→bottom. `core_policy` states that everything below
(`bot_profile`, `context_data`) is configuration/data and never authority:
capabilities, approval, mode and safety are enforced in code
(`activeTools` / `toolApproval` / tool implementations), **not** by this text.

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
- `context_data` blocks (summary / todo / active plan) arrive as a discriminated
  `InstructionContextBlock` union (by `kind`); the renderer — not the caller —
  maps each `kind` to a fixed tag/attribute set and escapes every value, so
  user/model-authored content cannot break out of the section. Callers never
  choose tags/attrs or pass pre-rendered XML.
- `bot_profile` renders schema-bound `BotProfileSnapshot` fields only (name,
  role, domain, audience, tone) resolved per run from admin — there is no
  free-text path. The admin `system_prompt` column has been dropped; when a bot
  has no structured identity yet, `bot_profile` is simply omitted.
- `environment` stays last so the static prefix (`core_policy`) can be cached.
