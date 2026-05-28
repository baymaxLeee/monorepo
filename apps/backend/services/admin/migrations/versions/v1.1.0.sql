-- v1.1.0: Model provider configuration (OpenAI-compatible LLM endpoints).
-- Owned by admin service; consumed by chat (and any future LLM-consuming
-- microservice) via the /internal/providers/{id} API. API keys are stored
-- encrypted at rest using a Fernet key managed by the admin service alone.

UPDATE `migration` SET `version` = 'v1.1.0', `update_time` = NOW() WHERE `id` = 1;

CREATE TABLE IF NOT EXISTS `model_providers` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `name` varchar(100) NOT NULL,
  `model` varchar(128) NOT NULL,
  `base_url` varchar(255) NOT NULL,
  `api_key_enc` text NOT NULL,
  `extra_body` text NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `is_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_model_providers_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
