-- v1.2.0: 会话级 Markdown 文档，存放用户上传经 MarkItDown 转换的源文件与 agent 产物，
-- 按会话隔离，在对话流中以轻量卡片渲染。

CREATE TABLE IF NOT EXISTS conversation_documents (
  id varchar(32) NOT NULL,
  conversation_id varchar(32) NOT NULL,
  kind varchar(20) NOT NULL,
  title varchar(255) NOT NULL,
  filename varchar(255) NOT NULL,
  mime_type varchar(120) NOT NULL DEFAULT 'text/markdown',
  content_md text NOT NULL,
  source_size integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_conversation_documents_conversation_id
    FOREIGN KEY (conversation_id) REFERENCES conversations (id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_conversation_documents_conversation_id ON conversation_documents (conversation_id);

UPDATE migration SET version = 'v1.2.0', update_time = NOW() WHERE id = 1;
