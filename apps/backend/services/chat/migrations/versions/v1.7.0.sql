-- v1.7.0: bind business agent runs to durable Workflow runs.

ALTER TABLE `agent_runs`
  ADD COLUMN `workflow_run_id` varchar(128) NULL AFTER `output_message_id`,
  ADD COLUMN `workflow_name` varchar(80) NULL AFTER `workflow_run_id`,
  ADD COLUMN `workflow_version` varchar(80) NULL AFTER `workflow_name`,
  ADD UNIQUE KEY `ux_agent_runs_workflow_run_id` (`workflow_run_id`);

UPDATE `migration` SET `version` = 'v1.7.0', `update_time` = NOW() WHERE `id` = 1;
