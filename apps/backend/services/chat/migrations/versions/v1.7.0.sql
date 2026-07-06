-- v1.7.0: 将业务 agent 运行绑定到持久化 Workflow 运行。

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS workflow_run_id varchar(128) NULL,
  ADD COLUMN IF NOT EXISTS workflow_name varchar(80) NULL,
  ADD COLUMN IF NOT EXISTS workflow_version varchar(80) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_runs_workflow_run_id ON agent_runs (workflow_run_id);

UPDATE migration SET version = 'v1.7.0', update_time = NOW() WHERE id = 1;
