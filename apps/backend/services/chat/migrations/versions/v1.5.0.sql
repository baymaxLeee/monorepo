-- v1.5.0: documents moved to knowledge service; drop legacy conversation_documents.

DROP TABLE IF EXISTS `conversation_documents`;

UPDATE `migration` SET `version` = 'v1.5.0', `update_time` = NOW() WHERE `id` = 1;
