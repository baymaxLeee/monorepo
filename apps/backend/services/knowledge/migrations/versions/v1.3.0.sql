-- Re-deploy safe: add columns/index only when missing.

SET @has_attempt := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'artifact_generations'
    AND COLUMN_NAME = 'attempt'
);
SET @ddl := IF(
  @has_attempt = 0,
  'ALTER TABLE `artifact_generations`
     ADD COLUMN `attempt` int NOT NULL DEFAULT 1 AFTER `base_revision_id`,
     ADD COLUMN `run_id` varchar(32) NULL AFTER `attempt`,
     ADD COLUMN `tool_call_id` varchar(64) NULL AFTER `run_id`,
     ADD COLUMN `lease_owner` varchar(128) NULL AFTER `error`,
     ADD COLUMN `lease_expires_at` datetime(6) NULL AFTER `lease_owner`,
     ADD COLUMN `started_at` datetime(6) NULL AFTER `lease_expires_at`,
     ADD COLUMN `cancel_requested_at` datetime(6) NULL AFTER `started_at`,
     ADD KEY `ix_artifact_generations_run_id` (`run_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_block_attempt := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'artifact_block_versions'
    AND COLUMN_NAME = 'attempt'
);
SET @ddl := IF(
  @has_block_attempt = 0,
  'ALTER TABLE `artifact_block_versions` ADD COLUMN `attempt` int NOT NULL DEFAULT 0 AFTER `error`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.3.0', `update_time` = NOW() WHERE `id` = 1;
