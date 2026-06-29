SET @has_context_window := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'model_providers'
    AND COLUMN_NAME = 'context_window'
);
SET @ddl := IF(
  @has_context_window = 0,
  'ALTER TABLE `model_providers`
     ADD COLUMN `context_window` int NOT NULL DEFAULT 128000 AFTER `extra_body`,
     ADD COLUMN `max_output_tokens` int NOT NULL DEFAULT 8192 AFTER `context_window`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.3.0', `update_time` = NOW() WHERE `id` = 1;
