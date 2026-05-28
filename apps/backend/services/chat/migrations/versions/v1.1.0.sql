-- v1.1.0: pin each conversation to a specific model provider.
-- Stored as an opaque FK string into admin's `model_providers.id`;
-- chat MUST NOT join admin tables — the field is opaque to this service.
--
-- Defensive ALTER: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, but
-- mysql-init.sh (single-vps) replays all SQL files on every container
-- start. The information_schema guard makes the column add idempotent so
-- repeated init cycles don't fail with "Duplicate column".

UPDATE `migration` SET `version` = 'v1.1.0', `update_time` = NOW() WHERE `id` = 1;

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversations'
    AND COLUMN_NAME = 'provider_id'
);

SET @stmt := IF(@col_exists = 0,
  "ALTER TABLE `conversations` ADD COLUMN `provider_id` varchar(32) NOT NULL DEFAULT '' AFTER `model`",
  "DO 0"
);

PREPARE _add_provider_id FROM @stmt;
EXECUTE _add_provider_id;
DEALLOCATE PREPARE _add_provider_id;
