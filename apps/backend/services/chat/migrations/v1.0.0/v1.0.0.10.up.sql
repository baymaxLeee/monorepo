CREATE TABLE agent_steering_inputs (
    run_id varchar(32) NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    client_message_id varchar(64) NOT NULL,
    conversation_id varchar(32) NOT NULL,
    delivery varchar(20) NOT NULL CHECK (delivery IN ('steer', 'queue')),
    text text NOT NULL,
    state varchar(20) NOT NULL CHECK (state IN ('accepted', 'dispatching', 'delivered', 'not_delivered', 'unconfirmed')),
    step_number integer,
    reason text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (run_id, client_message_id)
);
CREATE INDEX ix_agent_steering_inputs_pending ON agent_steering_inputs (run_id,state,created_at);
