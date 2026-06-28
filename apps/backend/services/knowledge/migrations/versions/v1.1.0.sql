CREATE TABLE IF NOT EXISTS `artifact_generations` (
  `id` varchar(32) NOT NULL, `document_id` varchar(32) NOT NULL,
  `user_id` varchar(26) NOT NULL, `conversation_id` varchar(32) NULL,
  `kind` varchar(20) NOT NULL, `title` varchar(255) NOT NULL,
  `filename` varchar(255) NOT NULL, `brief` text NOT NULL,
  `idempotency_key` varchar(128) NOT NULL, `workflow_run_id` varchar(128) NULL,
  `base_revision_id` varchar(32) NULL, `status` varchar(24) NOT NULL,
  `phase` varchar(32) NOT NULL, `manifest_json` json NULL,
  `total_blocks` int NOT NULL DEFAULT 0, `completed_blocks` int NOT NULL DEFAULT 0,
  `failed_blocks` int NOT NULL DEFAULT 0, `error` text NULL,
  `created_at` datetime(6) NOT NULL, `updated_at` datetime(6) NOT NULL,
  `finished_at` datetime(6) NULL, PRIMARY KEY (`id`),
  UNIQUE KEY `ux_artifact_generations_idempotency` (`idempotency_key`),
  UNIQUE KEY `ux_artifact_generations_workflow_run_id` (`workflow_run_id`),
  KEY `ix_artifact_generations_document_id` (`document_id`),
  KEY `ix_artifact_generations_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `artifact_block_versions` (
  `id` varchar(32) NOT NULL, `document_id` varchar(32) NOT NULL,
  `generation_id` varchar(32) NOT NULL, `block_id` varchar(80) NOT NULL,
  `block_type` varchar(40) NOT NULL, `position` int NOT NULL,
  `brief` text NOT NULL, `status` varchar(24) NOT NULL,
  `object_bucket` varchar(64) NULL, `object_key` varchar(512) NULL,
  `object_sha256` varchar(64) NULL, `content_size` bigint NOT NULL DEFAULT 0,
  `error` text NULL, `created_at` datetime(6) NOT NULL, `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `ux_artifact_block_generation_id` (`generation_id`, `block_id`),
  KEY `ix_artifact_blocks_document_id` (`document_id`),
  KEY `ix_artifact_blocks_generation_id` (`generation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `artifact_revisions` (
  `id` varchar(32) NOT NULL, `document_id` varchar(32) NOT NULL,
  `parent_revision_id` varchar(32) NULL, `generation_id` varchar(32) NOT NULL,
  `manifest_json` json NOT NULL, `object_bucket` varchar(64) NOT NULL,
  `object_key` varchar(512) NOT NULL, `object_sha256` varchar(64) NOT NULL,
  `content_size` bigint NOT NULL, `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `ux_artifact_revisions_generation_id` (`generation_id`),
  KEY `ix_artifact_revisions_document_id` (`document_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE `migration` SET `version` = 'v1.1.0', `update_time` = NOW() WHERE `id` = 1;
