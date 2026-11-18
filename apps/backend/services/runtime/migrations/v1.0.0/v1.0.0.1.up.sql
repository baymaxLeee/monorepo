UPDATE session_files
SET kind = 'artifact'
WHERE kind = 'plan';

ALTER TABLE sessions
    ADD COLUMN reasoning_effort character varying(16) DEFAULT 'medium' NOT NULL;
