-- v1.10.0: admin-managed Skills + Bot↔Skill bindings.
--
--   A Skill is a reusable workflow/code-of-conduct a Bot advertises to the
--   model. Storage owns the L1 discovery fields (name/description) and the L2
--   body (SKILL.md content); progressive disclosure means only name/description
--   enter the prompt at start and chat pulls `body` on demand via `load_skill`.
--
--   `name` is kebab-case and doubles as the model-facing invocation name (Agent
--   Skills spec); it is unique per team (org). Team-shared like other admin
--   resources: org owns it, members consume it, org_admin writes.
--
--   Purely structural: the demo `oncall-rca` skill (the RCA workflow the v1.9.0
--   bot-profile migration deferred here) is seeded by `seed_demo_bots` on
--   non-production startup, not here — production DBs get the tables only.

CREATE TABLE IF NOT EXISTS skills (
  id          varchar(32)  PRIMARY KEY,
  user_id     varchar(26)  NOT NULL,
  org_id      varchar(26)  NOT NULL,
  username    varchar(120) NOT NULL,
  name        varchar(64)  NOT NULL,
  description varchar(1024) NOT NULL DEFAULT '',
  body        text         NOT NULL DEFAULT '',
  status      varchar(20)  NOT NULL DEFAULT 'draft',
  is_enabled  boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL,
  updated_at  timestamptz  NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_skills_user_id ON skills (user_id);
CREATE INDEX IF NOT EXISTS ix_skills_org_id ON skills (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_skills_org_name ON skills (org_id, name);

CREATE TABLE IF NOT EXISTS bot_skills (
  bot_id   varchar(32) NOT NULL,
  skill_id varchar(32) NOT NULL,
  sort     integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, skill_id)
);
CREATE INDEX IF NOT EXISTS ix_bot_skills_skill_id ON bot_skills (skill_id);

UPDATE migration SET version = 'v1.10.0', update_time = NOW() WHERE id = 1;
