-- v1.7.0: bots become team-owned + gain a persona.
--   org_id        the team that owns the bot (members can see/use it).
--   system_prompt the agent persona/instructions (e.g. the oncall RCA playbook),
--                 injected by chat as an <agent_persona> section.

SET @has_org := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'org_id'
);
SET @ddl := IF(
  @has_org = 0,
  'ALTER TABLE `bots` ADD COLUMN `org_id` varchar(26) NULL AFTER `user_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_prompt := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'system_prompt'
);
SET @ddl := IF(
  @has_prompt = 0,
  'ALTER TABLE `bots` ADD COLUMN `system_prompt` text NULL AFTER `name`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_org_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bots' AND INDEX_NAME = 'ix_bots_org_id'
);
SET @ddl := IF(
  @has_org_idx = 0,
  'CREATE INDEX `ix_bots_org_id` ON `bots` (`org_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill existing bots into the seeded demo org (matches iam DEMO_ORG_ID
-- default 'demo-org') so current bots stay visible to the team.
UPDATE `bots` SET `org_id` = 'demo-org' WHERE `org_id` IS NULL;

UPDATE `migration` SET `version` = 'v1.7.0', `update_time` = NOW() WHERE `id` = 1;
