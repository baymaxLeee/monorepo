-- v1.7.0: bind business agent runs to durable Workflow runs.
--
-- Defensive guards: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, and
-- mysql-init.sh (single-vps) replays all SQL files on every container start.
-- The information_schema guards make each column/index add idempotent so
-- repeated init cycles don't fail with "Duplicate column" / "Duplicate key".

SET @has_workflow_run_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_runs'
    AND COLUMN_NAME = 'workflow_run_id'
);
SET @ddl := IF(
  @has_workflow_run_id = 0,
  'ALTER TABLE `agent_runs` ADD COLUMN `workflow_run_id` varchar(128) NULL AFTER `output_message_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_workflow_name := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_runs'
    AND COLUMN_NAME = 'workflow_name'
);
SET @ddl := IF(
  @has_workflow_name = 0,
  'ALTER TABLE `agent_runs` ADD COLUMN `workflow_name` varchar(80) NULL AFTER `workflow_run_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_workflow_version := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_runs'
    AND COLUMN_NAME = 'workflow_version'
);
SET @ddl := IF(
  @has_workflow_version = 0,
  'ALTER TABLE `agent_runs` ADD COLUMN `workflow_version` varchar(80) NULL AFTER `workflow_name`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_workflow_run_id_key := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_runs'
    AND INDEX_NAME = 'ux_agent_runs_workflow_run_id'
);
SET @ddl := IF(
  @has_workflow_run_id_key = 0,
  'ALTER TABLE `agent_runs` ADD UNIQUE KEY `ux_agent_runs_workflow_run_id` (`workflow_run_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.7.0', `update_time` = NOW() WHERE `id` = 1;
