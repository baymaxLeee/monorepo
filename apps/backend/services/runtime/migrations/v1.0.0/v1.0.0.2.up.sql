CREATE TABLE public.sandbox_workspace_checkout (
    turn_id varchar(32) NOT NULL,
    attempt_epoch bigint NOT NULL,
    workspace_path text NOT NULL,
    file_id varchar(32) NOT NULL,
    path_generation bigint NOT NULL,
    etag text NOT NULL,
    sha256 text NOT NULL,
    size_bytes bigint NOT NULL,
    PRIMARY KEY (turn_id, attempt_epoch, workspace_path),
    FOREIGN KEY (turn_id, attempt_epoch) REFERENCES public.turn_sandbox_executions (turn_id, attempt_epoch) ON DELETE CASCADE
);
