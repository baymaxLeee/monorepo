-- v2.0.0: 会话 agent 模式 + 上下文快照 + 单飞运行租约 + agent 步骤 token 计量。

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS agent_mode varchar(16) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS active_plan_document_id varchar(32) NULL;

CREATE TABLE IF NOT EXISTS conversation_contexts (
  conversation_id varchar(32) NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  covered_through_message_id varchar(32) NULL,
  summary text NOT NULL,
  state_json jsonb NOT NULL,
  estimated_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id),
  CONSTRAINT fk_conversation_contexts_conversation_id
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversation_run_leases (
  conversation_id varchar(32) NOT NULL,
  run_id varchar(32) NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id),
  CONSTRAINT ux_conversation_run_leases_run_id UNIQUE (run_id),
  CONSTRAINT fk_conversation_run_leases_conversation_id
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_run_leases_run_id
    FOREIGN KEY (run_id) REFERENCES agent_runs (id) ON DELETE CASCADE
);

ALTER TABLE agent_steps
  ADD COLUMN IF NOT EXISTS input_tokens integer NULL,
  ADD COLUMN IF NOT EXISTS output_tokens integer NULL,
  ADD COLUMN IF NOT EXISTS total_tokens integer NULL;

UPDATE migration SET version = 'v2.0.0', update_time = NOW() WHERE id = 1;
