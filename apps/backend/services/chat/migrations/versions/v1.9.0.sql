-- ToolLoopAgent runs are identified directly by agent_runs.id. Workflow DevKit
-- replay metadata is obsolete after removing the durable main-agent host.
-- Re-deploy safe: only drop when v1.7.0 columns/index still exist.

SET @has_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_runs'
    AND INDEX_NAME = 'ux_agent_runs_workflow_run_id'
);
SET @ddl := IF(
  @has_idx > 0,
  'ALTER TABLE `agent_runs` DROP INDEX `ux_agent_runs_workflow_run_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_workflow_run_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_runs'
    AND COLUMN_NAME = 'workflow_run_id'
);
SET @ddl := IF(
  @has_workflow_run_id > 0,
  'ALTER TABLE `agent_runs` DROP COLUMN `workflow_run_id`',
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
  @has_workflow_name > 0,
  'ALTER TABLE `agent_runs` DROP COLUMN `workflow_name`',
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
  @has_workflow_version > 0,
  'ALTER TABLE `agent_runs` DROP COLUMN `workflow_version`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.9.0', `update_time` = NOW() WHERE `id` = 1;
