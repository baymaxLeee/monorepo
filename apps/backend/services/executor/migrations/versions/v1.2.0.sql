CREATE TABLE video_productions (
  id varchar(32) PRIMARY KEY,
  task_id varchar(32) NOT NULL UNIQUE REFERENCES tasks(id),
  org_id varchar(32) NOT NULL,
  user_id varchar(32) NOT NULL,
  conversation_id varchar(32),
  status varchar(32) NOT NULL,
  stage varchar(48) NOT NULL,
  version integer NOT NULL,
  projection jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz
);
CREATE INDEX ix_video_productions_conversation_id ON video_productions(conversation_id);

CREATE TABLE video_production_artifacts (
  id varchar(32) PRIMARY KEY,
  production_id varchar(32) NOT NULL REFERENCES video_productions(id),
  artifact_type varchar(40) NOT NULL,
  version integer NOT NULL,
  input_sha256 varchar(64) NOT NULL,
  payload jsonb NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ux_video_production_artifact_version UNIQUE(production_id, artifact_type, version)
);
CREATE INDEX ix_video_production_artifacts_production_id ON video_production_artifacts(production_id);

CREATE TABLE video_production_events (
  id serial PRIMARY KEY,
  production_id varchar(32) NOT NULL REFERENCES video_productions(id),
  sequence integer NOT NULL,
  kind varchar(64) NOT NULL,
  stage varchar(48) NOT NULL,
  actor_id varchar(32),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ux_video_production_event_sequence UNIQUE(production_id, sequence)
);
CREATE INDEX ix_video_production_events_production_id ON video_production_events(production_id);

CREATE TABLE video_production_decisions (
  id varchar(32) PRIMARY KEY,
  production_id varchar(32) NOT NULL REFERENCES video_productions(id),
  action_id varchar(80) NOT NULL,
  action varchar(40) NOT NULL,
  expected_version integer NOT NULL,
  actor_id varchar(32) NOT NULL,
  reason text,
  status varchar(24) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  CONSTRAINT ux_video_production_decision_action UNIQUE(production_id, action_id)
);
CREATE INDEX ix_video_production_decisions_production_id ON video_production_decisions(production_id);

CREATE TABLE video_cost_entries (
  id varchar(32) PRIMARY KEY,
  production_id varchar(32) NOT NULL REFERENCES video_productions(id),
  idempotency_key varchar(120) NOT NULL,
  kind varchar(24) NOT NULL,
  amount_micros bigint NOT NULL,
  currency varchar(3) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ux_video_cost_entry_idempotency UNIQUE(production_id, idempotency_key)
);
CREATE INDEX ix_video_cost_entries_production_id ON video_cost_entries(production_id);
