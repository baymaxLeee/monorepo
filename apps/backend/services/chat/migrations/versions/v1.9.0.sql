-- ToolLoopAgent runs are identified directly by agent_runs.id. Workflow DevKit
-- replay metadata is obsolete after removing the durable main-agent host.
ALTER TABLE `agent_runs`
  DROP INDEX `ux_agent_runs_workflow_run_id`,
  DROP COLUMN `workflow_run_id`,
  DROP COLUMN `workflow_name`,
  DROP COLUMN `workflow_version`;
