-- v1.9.0: ToolLoopAgent 运行直接以 agent_runs.id 标识;移除持久化 main-agent host 后,
-- Workflow DevKit replay 元数据已废弃。DROP COLUMN 会自动移除依赖索引,先 DROP INDEX
-- 仅为忠实保留原始版本演进(IF EXISTS 保证重放幂等)。

DROP INDEX IF EXISTS ux_agent_runs_workflow_run_id;

ALTER TABLE agent_runs
  DROP COLUMN IF EXISTS workflow_run_id,
  DROP COLUMN IF EXISTS workflow_name,
  DROP COLUMN IF EXISTS workflow_version;

UPDATE migration SET version = 'v1.9.0', update_time = NOW() WHERE id = 1;
