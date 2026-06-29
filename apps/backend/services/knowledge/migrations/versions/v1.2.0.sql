-- Re-deploy safe: only drop when the v1.1.0 index/column still exist.
SET @has_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'artifact_generations'
    AND INDEX_NAME = 'ux_artifact_generations_workflow_run_id'
);
SET @ddl := IF(
  @has_idx > 0,
  'ALTER TABLE `artifact_generations` DROP INDEX `ux_artifact_generations_workflow_run_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'artifact_generations'
    AND COLUMN_NAME = 'workflow_run_id'
);
SET @ddl := IF(
  @has_col > 0,
  'ALTER TABLE `artifact_generations` DROP COLUMN `workflow_run_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.2.0', `update_time` = NOW() WHERE `id` = 1;
