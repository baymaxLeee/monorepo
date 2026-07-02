-- Agent (智能体/bot) model configuration: each agent references the model
-- providers it uses for text / image / video generation. Nullable — an agent
-- may leave a capability unconfigured. `updated_at` tracks edits.

SET @has_text := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'text_provider_id'
);
SET @ddl := IF(
  @has_text = 0,
  'ALTER TABLE `bots` ADD COLUMN `text_provider_id` varchar(32) NULL AFTER `status`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_image := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'image_provider_id'
);
SET @ddl := IF(
  @has_image = 0,
  'ALTER TABLE `bots` ADD COLUMN `image_provider_id` varchar(32) NULL AFTER `text_provider_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_video := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'video_provider_id'
);
SET @ddl := IF(
  @has_video = 0,
  'ALTER TABLE `bots` ADD COLUMN `video_provider_id` varchar(32) NULL AFTER `image_provider_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_updated := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'updated_at'
);
SET @ddl := IF(
  @has_updated = 0,
  'ALTER TABLE `bots` ADD COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) AFTER `created_at`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.5.0', `update_time` = NOW() WHERE `id` = 1;
