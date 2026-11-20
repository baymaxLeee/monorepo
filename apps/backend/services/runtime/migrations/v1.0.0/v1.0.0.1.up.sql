ALTER TABLE threads
    ADD COLUMN approval_policy varchar(24) NOT NULL DEFAULT 'on-request',
    ADD COLUMN permission_profile varchar(32) NOT NULL DEFAULT ':workspace';
