-- v1.8.0: org tenancy for ALL admin-managed resource tables.
--   scenes / intentions / model_providers gain org_id (team ownership), and
--   bots.org_id is tightened to NOT NULL. Every managed resource is now owned
--   by a team (org), so a team shares its scenes, intentions, model providers,
--   and bots. `apps` stays global (platform registry, no owner) and is untouched.
--   user_id is retained on each row purely as "who authored it".
--
-- Pattern per column: guarded ADD (nullable) -> backfill guest-org -> enforce
-- NOT NULL. Existing rows are reassigned to the seeded guest org (matches iam
-- GUEST_ORG_ID default 'guest-org') rather than dropped. Column type is
-- varchar(26) to match SQLAlchemy String(26) (fresh create_all) and v1.7.0.

-- ── scenes.org_id ──────────────────────────────────────────────────────────
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS org_id varchar(26);
CREATE INDEX IF NOT EXISTS ix_scenes_org_id ON scenes (org_id);
UPDATE scenes SET org_id = 'guest-org' WHERE org_id IS NULL;
ALTER TABLE scenes ALTER COLUMN org_id SET NOT NULL;

-- ── intentions.org_id ──────────────────────────────────────────────────────
ALTER TABLE intentions ADD COLUMN IF NOT EXISTS org_id varchar(26);
CREATE INDEX IF NOT EXISTS ix_intentions_org_id ON intentions (org_id);
UPDATE intentions SET org_id = 'guest-org' WHERE org_id IS NULL;
ALTER TABLE intentions ALTER COLUMN org_id SET NOT NULL;

-- ── model_providers.org_id ─────────────────────────────────────────────────
-- Providers become team-shared: a team configures its model endpoints once and
-- every member (and the team's bots) resolves against them. is_default is now
-- the team's default chat model.
ALTER TABLE model_providers ADD COLUMN IF NOT EXISTS org_id varchar(26);
CREATE INDEX IF NOT EXISTS ix_model_providers_org_id ON model_providers (org_id);
UPDATE model_providers SET org_id = 'guest-org' WHERE org_id IS NULL;
ALTER TABLE model_providers ALTER COLUMN org_id SET NOT NULL;

-- ── bots.org_id → NOT NULL (added nullable in v1.7.0) ──────────────────────
UPDATE bots SET org_id = 'guest-org' WHERE org_id IS NULL;
ALTER TABLE bots ALTER COLUMN org_id SET NOT NULL;

UPDATE migration SET version = 'v1.8.0', update_time = NOW() WHERE id = 1;
