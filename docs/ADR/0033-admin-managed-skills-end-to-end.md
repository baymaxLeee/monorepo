# ADR 0033: Admin-managed Skills, end-to-end (config → chat consume → `/` invoke)

## Status

Accepted. Extends ADR-0028 (system Skill / progressive disclosure) and ADR-0032
(code-governed prompt layering + structured Bot profile). MCP is reserved, not
implemented (see "MCP reservation").

## Context

ADR-0028 delivered a code-versioned **system** Skill (`field-support`) with the
single `load_skill` tool and `<available_skills>` L1/L2 progressive disclosure.
ADR-0032 made the Bot the aggregate root for agent configuration and replaced
free-text `system_prompt` with a structured profile, explicitly deferring "the
full RCA workflow" to "a code-versioned skill later".

What was missing: skills authored and bound by an **operator** (not code). The
oncall bot lost its RCA playbook when `system_prompt` was dropped, and there was
no way for a team to add a skill without shipping a `SKILL.md`. The user also
wants a chat affordance to invoke a skill directly via `/`.

## Decision

1. **Admin owns Skills as a first-class managed resource.** New `skills` table
   (team/org-scoped, like scenes/intentions/providers) with the Agent Skills
   spec shape: `name` (kebab-case, unique per org, doubles as the model-facing
   invocation name), `description` (L1 "when to use"), `body` (L2 SKILL.md),
   plus our `status`/`is_enabled` management fields. `bot_skills` binds skills to
   a Bot (the aggregate root). Public CRUD under `/skills`; bot attach/detach
   under `/bot/{id}/skills`.
2. **Storage is the source of truth; the body never sits in the prompt.**
   `ResolvedAgent.skills` carries only L1 (`id`/`name`/`description`). The L2
   body is pulled on demand from `/internal/skills/{id}` (decrypted trust
   boundary = internal token), mirroring provider resolution.
3. **Chat merges system + admin skills behind ONE `load_skill` tool.**
   `resolveSkills(mode, adminSource)` unions filesystem system skills and the
   bot's admin skills by name (admin wins on collision) and advertises them in
   `<available_skills>`. `load_skill` refuses any name not advertised, so a bot
   can only load skills it actually offers. Only `active` + `is_enabled` skills
   are advertised.
4. **`/` explicit activation is deterministic.** When the user picks a skill via
   the composer `/` menu, chat sends `skill_name`; the run injects that skill's
   full body as a trusted `<activated_skill>` context block for that turn, so the
   model consumes it without depending on it choosing to call `load_skill`. The
   model-driven `load_skill` path remains for autonomous matching.
5. **Trust classification.** An activated skill body is operator-authored
   configuration and is rendered as a directive (like the bot profile), NOT as
   untrusted `referenced_documents`.
6. **Bot pinning stays per-request.** The active bot is threaded via the existing
   `agent_id` on each run request; no `conversations.bot_id` column was added
   (client already persists `selectedAgentId`). Keeps the migration structural.

## Consequences

- A team can author a skill in admin, bind it to a bot, and the chat user can
  invoke it via `/` — no code deploy. The oncall bot's RCA playbook is expressed
  as an admin `oncall-rca` skill an operator authors and binds; nothing is seeded
  by default (the demo oncall bot/skill seed was removed so tenant-authored data
  is never confused with built-in data).
- One migration (`admin v1.10.0`), purely structural, and never carries demo
  data. `seed_demo_bots` only seeds apps/scenes/intentions (non-production only).
- `load_skill` is still a single general tool; adding skills is data, not new
  tools. The system-skill mechanism (ADR-0028) is unchanged and coexists.
- The dead `AgentExtensionContribution.instructions` field stayed removed;
  skills are threaded directly through `ToolCatalog.resolve`, and the
  `AgentExtension` seam is reserved for MCP.

## MCP reservation (not implemented)

MCP remains deferred. The seams are in place and unchanged: `AgentExtension` /
`AgentExtensionContribution { tools?, dispose? }`, the `mcp__server__tool`
namespacing in `ToolCatalog`, and the `mcp__*` user-approval policy. A full MCP
end-to-end (admin `mcp_servers` table + credentials + `@ai-sdk/mcp` client) is a
separate follow-up plan.

## References

- ADR-0028: field support as a progressively disclosed system Skill
- ADR-0032: code-governed prompt layering + structured Bot profile
- Agent Skills spec: name/description/body progressive disclosure
- `docs/plans/skill-mcp-assembly-plan.md`
