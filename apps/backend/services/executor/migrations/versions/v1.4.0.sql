ALTER TABLE tasks ADD COLUMN cleanup_pending boolean NOT NULL DEFAULT false;
UPDATE tasks SET cleanup_pending = true WHERE status = 'cancelled';
CREATE INDEX ix_tasks_pending_cleanup ON tasks(cleanup_pending) WHERE cleanup_pending = true;
