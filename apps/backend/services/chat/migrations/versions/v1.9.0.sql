-- 清理由旧 durable-chat-agent 尝试写入的列。新库没有这些列；IF EXISTS 仅用于
-- 清理曾应用 v1.7.0 的现有 demo 数据库。

DROP INDEX IF EXISTS ux_agent_runs_workflow_run_id;

ALTER TABLE agent_runs
  DROP COLUMN IF EXISTS workflow_run_id,
  DROP COLUMN IF EXISTS workflow_name,
  DROP COLUMN IF EXISTS workflow_version;

UPDATE migration SET version = 'v1.9.0', update_time = NOW() WHERE id = 1;
