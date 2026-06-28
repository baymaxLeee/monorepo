-- v1.8.0: long-term memory candidate queue + supersede tracking.
--
-- Adds three nullable columns to `user_memories` so background extraction can
-- stage candidates (status=pending) with an extraction reason, trace them back
-- to the originating agent run, and link a change candidate to the memory it
-- supersedes.
--
-- Defensive guards: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, and
-- mysql-init.sh (single-vps) replays all SQL files on every container start.
-- The information_schema guards make each column add idempotent so repeated
-- init cycles don't fail with "Duplicate column".

SET @has_reason := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_memories'
    AND COLUMN_NAME = 'reason'
);
SET @ddl := IF(
  @has_reason = 0,
  'ALTER TABLE `user_memories` ADD COLUMN `reason` text NULL AFTER `status`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_origin_run_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_memories'
    AND COLUMN_NAME = 'origin_run_id'
);
SET @ddl := IF(
  @has_origin_run_id = 0,
  'ALTER TABLE `user_memories` ADD COLUMN `origin_run_id` varchar(32) NULL AFTER `reason`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_supersedes_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_memories'
    AND COLUMN_NAME = 'supersedes_id'
);
SET @ddl := IF(
  @has_supersedes_id = 0,
  'ALTER TABLE `user_memories` ADD COLUMN `supersedes_id` varchar(32) NULL AFTER `origin_run_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.8.0', `update_time` = NOW() WHERE `id` = 1;
