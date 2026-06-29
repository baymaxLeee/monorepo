-- Re-deploy safe: add columns/tables only when missing.

SET @has_agent_mode := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversations'
    AND COLUMN_NAME = 'agent_mode'
);
SET @ddl := IF(
  @has_agent_mode = 0,
  'ALTER TABLE `conversations`
     ADD COLUMN `agent_mode` varchar(16) NOT NULL DEFAULT ''normal'' AFTER `provider_id`,
     ADD COLUMN `active_plan_document_id` varchar(32) NULL AFTER `agent_mode`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `conversation_contexts` (
  `conversation_id` varchar(32) NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `covered_through_message_id` varchar(32) NULL,
  `summary` text NOT NULL,
  `state_json` json NOT NULL,
  `estimated_tokens` int NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`conversation_id`),
  CONSTRAINT `fk_conversation_contexts_conversation_id`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `conversation_run_leases` (
  `conversation_id` varchar(32) NOT NULL,
  `run_id` varchar(32) NOT NULL,
  `heartbeat_at` datetime(6) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  PRIMARY KEY (`conversation_id`),
  UNIQUE KEY `ux_conversation_run_leases_run_id` (`run_id`),
  CONSTRAINT `fk_conversation_run_leases_conversation_id`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_conversation_run_leases_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `agent_runs` (`id`) ON DELETE CASCADE
);

SET @has_input_tokens := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_steps'
    AND COLUMN_NAME = 'input_tokens'
);
SET @ddl := IF(
  @has_input_tokens = 0,
  'ALTER TABLE `agent_steps`
     ADD COLUMN `input_tokens` int NULL AFTER `metadata`,
     ADD COLUMN `output_tokens` int NULL AFTER `input_tokens`,
     ADD COLUMN `total_tokens` int NULL AFTER `output_tokens`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v2.0.0', `update_time` = NOW() WHERE `id` = 1;
