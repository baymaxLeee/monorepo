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
SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scenes' AND COLUMN_NAME = 'org_id'
);
SET @ddl := IF(@has = 0,
  'ALTER TABLE `scenes` ADD COLUMN `org_id` varchar(26) NULL AFTER `user_id`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scenes' AND INDEX_NAME = 'ix_scenes_org_id'
);
SET @ddl := IF(@has_idx = 0, 'CREATE INDEX `ix_scenes_org_id` ON `scenes` (`org_id`)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `scenes` SET `org_id` = 'guest-org' WHERE `org_id` IS NULL;
ALTER TABLE `scenes` MODIFY COLUMN `org_id` varchar(26) NOT NULL;

-- ── intentions.org_id ──────────────────────────────────────────────────────
SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'intentions' AND COLUMN_NAME = 'org_id'
);
SET @ddl := IF(@has = 0,
  'ALTER TABLE `intentions` ADD COLUMN `org_id` varchar(26) NULL AFTER `user_id`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'intentions' AND INDEX_NAME = 'ix_intentions_org_id'
);
SET @ddl := IF(@has_idx = 0, 'CREATE INDEX `ix_intentions_org_id` ON `intentions` (`org_id`)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `intentions` SET `org_id` = 'guest-org' WHERE `org_id` IS NULL;
ALTER TABLE `intentions` MODIFY COLUMN `org_id` varchar(26) NOT NULL;

-- ── model_providers.org_id ─────────────────────────────────────────────────
-- Providers become team-shared: a team configures its model endpoints once and
-- every member (and the team's bots) resolves against them. is_default is now
-- the team's default chat model.
SET @has := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_providers' AND COLUMN_NAME = 'org_id'
);
SET @ddl := IF(@has = 0,
  'ALTER TABLE `model_providers` ADD COLUMN `org_id` varchar(26) NULL AFTER `user_id`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_providers' AND INDEX_NAME = 'ix_model_providers_org_id'
);
SET @ddl := IF(@has_idx = 0,
  'CREATE INDEX `ix_model_providers_org_id` ON `model_providers` (`org_id`)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `model_providers` SET `org_id` = 'guest-org' WHERE `org_id` IS NULL;
ALTER TABLE `model_providers` MODIFY COLUMN `org_id` varchar(26) NOT NULL;

-- ── bots.org_id → NOT NULL (added nullable in v1.7.0) ──────────────────────
UPDATE `bots` SET `org_id` = 'guest-org' WHERE `org_id` IS NULL;
ALTER TABLE `bots` MODIFY COLUMN `org_id` varchar(26) NOT NULL;

UPDATE `migration` SET `version` = 'v1.8.0', `update_time` = NOW() WHERE `id` = 1;
