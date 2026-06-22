-- v1.2.0: conversation-scoped Markdown documents.
--
-- Stores both user-uploaded source files converted by MarkItDown and agent
-- artifacts. Documents are isolated by conversation and rendered in the chat
-- stream as lightweight cards.

CREATE TABLE IF NOT EXISTS `conversation_documents` (
  `id` varchar(32) NOT NULL,
  `conversation_id` varchar(32) NOT NULL,
  `kind` varchar(20) NOT NULL,
  `title` varchar(255) NOT NULL,
  `filename` varchar(255) NOT NULL,
  `mime_type` varchar(120) NOT NULL DEFAULT 'text/markdown',
  `content_md` mediumtext NOT NULL,
  `source_size` int NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_conversation_documents_conversation_id` (`conversation_id`),
  CONSTRAINT `fk_conversation_documents_conversation_id`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE `migration` SET `version` = 'v1.2.0', `update_time` = NOW() WHERE `id` = 1;

