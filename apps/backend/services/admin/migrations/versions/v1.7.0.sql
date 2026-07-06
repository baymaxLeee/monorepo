-- v1.7.0: bots become team-owned + gain a persona.
--   org_id        the team that owns the bot (members can see/use it).
--   system_prompt the agent persona/instructions (e.g. the oncall RCA playbook),
--                 injected by chat as an <agent_persona> section.

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS org_id varchar(26),
  ADD COLUMN IF NOT EXISTS system_prompt text;

CREATE INDEX IF NOT EXISTS ix_bots_org_id ON bots (org_id);

-- Backfill existing bots into the seeded guest org (matches iam GUEST_ORG_ID
-- default 'guest-org') so current bots stay visible to the team.
UPDATE bots SET org_id = 'guest-org' WHERE org_id IS NULL;

UPDATE migration SET version = 'v1.7.0', update_time = NOW() WHERE id = 1;
