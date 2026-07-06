-- v1.8.0: 长期记忆候选队列 + supersede 追踪。后台抽取可将候选暂存(status=pending)、
-- 记录抽取原因、回溯到发起的 agent 运行,并把变更候选链接到它所取代的记忆。

ALTER TABLE user_memories
  ADD COLUMN IF NOT EXISTS reason text NULL,
  ADD COLUMN IF NOT EXISTS origin_run_id varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS supersedes_id varchar(32) NULL;

UPDATE migration SET version = 'v1.8.0', update_time = NOW() WHERE id = 1;
