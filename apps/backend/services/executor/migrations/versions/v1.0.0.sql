CREATE TABLE IF NOT EXISTS migration (
  id smallint NOT NULL,
  version varchar(32) NOT NULL,
  update_time timestamptz NOT NULL,
  PRIMARY KEY (id)
);

INSERT INTO migration (id, version, update_time)
VALUES (1, 'v0.0.0', NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS tasks (
  id varchar(32) NOT NULL,
  type varchar(64) NOT NULL,
  status varchar(20) NOT NULL,
  owner_service varchar(40) NOT NULL,
  owner_ref varchar(80) NOT NULL,
  workflow_run_id varchar(64),
  payload jsonb NOT NULL,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT ux_tasks_owner UNIQUE (owner_service, owner_ref)
);
CREATE INDEX IF NOT EXISTS ix_tasks_workflow_run_id ON tasks (workflow_run_id);
