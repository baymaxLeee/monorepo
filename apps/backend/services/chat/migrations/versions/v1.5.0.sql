-- v1.5.0: 文档能力迁移到 knowledge 服务,删除历史 conversation_documents。

DROP TABLE IF EXISTS conversation_documents;

UPDATE migration SET version = 'v1.5.0', update_time = NOW() WHERE id = 1;
