-- Canvas checkpoints and ordered patches commit with the business mutation.
CREATE TABLE public.canvas_event_heads (
    canvas_id character(36) PRIMARY KEY,
    sequence bigint NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE TABLE public.canvas_events (
    canvas_id character(36) NOT NULL,
    sequence bigint NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (canvas_id, sequence)
);
CREATE INDEX idx_canvas_events_retention ON public.canvas_events (created_at);
