-- v1.6.0: 生产级 agent 运行时持久化。语义消息留在 messages;运行轨迹、工具调用与长期
-- 记忆单独持久化,避免未来上下文被运行日志污染。

CREATE TABLE IF NOT EXISTS agent_runs (
  id varchar(32) NOT NULL,
  conversation_id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  provider_id varchar(32) NOT NULL DEFAULT '',
  model varchar(120) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL,
  error text NULL,
  input_message_id varchar(32) NULL,
  output_message_id varchar(32) NULL,
  total_tokens integer NULL,
  created_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_agent_runs_conversation_id
    FOREIGN KEY (conversation_id) REFERENCES conversations (id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_agent_runs_conversation_id ON agent_runs (conversation_id);
CREATE INDEX IF NOT EXISTS ix_agent_runs_user_id ON agent_runs (user_id);

CREATE TABLE IF NOT EXISTS agent_steps (
  id varchar(32) NOT NULL,
  run_id varchar(32) NOT NULL,
  step_index integer NOT NULL,
  kind varchar(32) NOT NULL,
  status varchar(20) NOT NULL,
  summary text NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_agent_steps_run_id
    FOREIGN KEY (run_id) REFERENCES agent_runs (id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_agent_steps_run_id ON agent_steps (run_id);
CREATE INDEX IF NOT EXISTS ix_agent_steps_run_step ON agent_steps (run_id, step_index);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id varchar(64) NOT NULL,
  run_id varchar(32) NOT NULL,
  step_index integer NULL,
  tool_name varchar(80) NOT NULL,
  status varchar(20) NOT NULL,
  input_json jsonb NULL,
  output_json jsonb NULL,
  error text NULL,
  duration_ms integer NULL,
  created_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_agent_tool_calls_run_id
    FOREIGN KEY (run_id) REFERENCES agent_runs (id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_agent_tool_calls_run_id ON agent_tool_calls (run_id);
CREATE INDEX IF NOT EXISTS ix_agent_tool_calls_tool_name ON agent_tool_calls (tool_name);

CREATE TABLE IF NOT EXISTS user_memories (
  id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  category varchar(40) NOT NULL,
  content text NOT NULL,
  source varchar(80) NOT NULL DEFAULT 'agent',
  confidence integer NOT NULL DEFAULT 80,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_user_memories_user_id ON user_memories (user_id);
CREATE INDEX IF NOT EXISTS ix_user_memories_user_status ON user_memories (user_id, status);

UPDATE migration SET version = 'v1.6.0', update_time = NOW() WHERE id = 1;
