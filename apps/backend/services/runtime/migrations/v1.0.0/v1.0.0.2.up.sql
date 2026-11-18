ALTER TABLE sessions
    DROP COLUMN active_plan_file_id;

ALTER TABLE session_files
    DROP COLUMN kind;
