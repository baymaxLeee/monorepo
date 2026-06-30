SET @has_provider_kind := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'model_providers'
    AND COLUMN_NAME = 'provider_kind'
);
SET @ddl := IF(
  @has_provider_kind = 0,
  'ALTER TABLE `model_providers`
     ADD COLUMN `provider_kind` varchar(16) NOT NULL DEFAULT ''chat'' AFTER `model`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.4.0', `update_time` = NOW() WHERE `id` = 1;
