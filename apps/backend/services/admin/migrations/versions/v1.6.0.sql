-- v1.6.0: add model_providers.supports_image_input (chat model vision flag).

SET @has_supports_image_input := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'model_providers'
    AND COLUMN_NAME = 'supports_image_input'
);
SET @ddl := IF(
  @has_supports_image_input = 0,
  'ALTER TABLE `model_providers`
     ADD COLUMN `supports_image_input` tinyint(1) NOT NULL DEFAULT 0 AFTER `max_output_tokens`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.6.0', `update_time` = NOW() WHERE `id` = 1;
