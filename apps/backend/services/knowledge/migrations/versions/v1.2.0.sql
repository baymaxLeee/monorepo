ALTER TABLE `artifact_generations`
  DROP INDEX `ux_artifact_generations_workflow_run_id`,
  DROP COLUMN `workflow_run_id`;
