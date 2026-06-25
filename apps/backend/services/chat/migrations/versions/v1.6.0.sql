-- v1.6.0: production agent runtime persistence.
--
-- Semantic chat messages stay in `messages`; runtime traces, tool calls, and
-- long-term memory are persisted separately so future context is not polluted
-- by operational logs.

CREATE TABLE IF NOT EXISTS `agent_runs` (
  `id` varchar(32) NOT NULL,
  `conversation_id` varchar(32) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `provider_id` varchar(32) NOT NULL DEFAULT '',
  `model` varchar(120) NOT NULL DEFAULT '',
  `status` varchar(20) NOT NULL,
  `error` text NULL,
  `input_message_id` varchar(32) NULL,
  `output_message_id` varchar(32) NULL,
  `total_tokens` int NULL,
  `created_at` datetime(6) NOT NULL,
  `started_at` datetime(6) NOT NULL,
  `finished_at` datetime(6) NULL,
  PRIMARY KEY (`id`),
  KEY `ix_agent_runs_conversation_id` (`conversation_id`),
  KEY `ix_agent_runs_user_id` (`user_id`),
  CONSTRAINT `fk_agent_runs_conversation_id`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `agent_steps` (
  `id` varchar(32) NOT NULL,
  `run_id` varchar(32) NOT NULL,
  `step_index` int NOT NULL,
  `kind` varchar(32) NOT NULL,
  `status` varchar(20) NOT NULL,
  `summary` text NULL,
  `metadata` json NULL,
  `created_at` datetime(6) NOT NULL,
  `finished_at` datetime(6) NULL,
  PRIMARY KEY (`id`),
  KEY `ix_agent_steps_run_id` (`run_id`),
  KEY `ix_agent_steps_run_step` (`run_id`, `step_index`),
  CONSTRAINT `fk_agent_steps_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `agent_runs` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `agent_tool_calls` (
  `id` varchar(64) NOT NULL,
  `run_id` varchar(32) NOT NULL,
  `step_index` int NULL,
  `tool_name` varchar(80) NOT NULL,
  `status` varchar(20) NOT NULL,
  `input_json` json NULL,
  `output_json` json NULL,
  `error` text NULL,
  `duration_ms` int NULL,
  `created_at` datetime(6) NOT NULL,
  `finished_at` datetime(6) NULL,
  PRIMARY KEY (`id`),
  KEY `ix_agent_tool_calls_run_id` (`run_id`),
  KEY `ix_agent_tool_calls_tool_name` (`tool_name`),
  CONSTRAINT `fk_agent_tool_calls_run_id`
    FOREIGN KEY (`run_id`) REFERENCES `agent_runs` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_memories` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `category` varchar(40) NOT NULL,
  `content` text NOT NULL,
  `source` varchar(80) NOT NULL DEFAULT 'agent',
  `confidence` int NOT NULL DEFAULT 80,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_user_memories_user_id` (`user_id`),
  KEY `ix_user_memories_user_status` (`user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE `migration` SET `version` = 'v1.6.0', `update_time` = NOW() WHERE `id` = 1;
