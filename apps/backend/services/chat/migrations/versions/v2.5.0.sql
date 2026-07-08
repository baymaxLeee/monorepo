-- v2.5.0: 长期记忆语义召回。给 user_memories 增加向量嵌入列 + 检索索引,使
-- 记忆召回可走稠密向量(HNSW)与 trigram 双路。列可空:未回填 embedding 的历史
-- 记忆仍可用,仅不参与向量召回。
--
-- 幂等重建说明:此迁移的原始文件在一次 stash/隔离操作中丢失,而 schema 早已 apply
-- 到部分开发库,因此全部对象都用 IF NOT EXISTS 重写,重放到已含这些对象的库不会报错。
-- embedding 维度须与 chat 侧记忆嵌入 provider 的输出维度一致(2048)。

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS embedding vector(2048);

CREATE INDEX IF NOT EXISTS ix_user_memories_content_trgm
  ON user_memories USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_user_memories_embedding_hnsw
  ON user_memories USING hnsw ((embedding::halfvec(2048)) halfvec_cosine_ops)
  WITH (m = '16', ef_construction = '64');

UPDATE migration SET version = 'v2.5.0', update_time = NOW() WHERE id = 1;
