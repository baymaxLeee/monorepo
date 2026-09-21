ALTER TABLE benefit_package_review_reservations
    ADD COLUMN operation_id varchar(36);
UPDATE benefit_package_review_reservations SET operation_id = id WHERE operation_id IS NULL;
ALTER TABLE benefit_package_review_reservations
    ALTER COLUMN operation_id SET NOT NULL;
ALTER TABLE benefit_package_review_reservations
    ADD CONSTRAINT benefit_package_review_reservations_operation UNIQUE (operation_id);

ALTER TABLE benefit_package_review_reservations
    DROP CONSTRAINT benefit_package_review_reservations_status_check;
ALTER TABLE benefit_package_review_reservations
    ADD CONSTRAINT benefit_package_review_reservations_status_check
    CHECK (status IN ('reserved', 'committed', 'releasing', 'reacquiring', 'released'));
DROP INDEX benefit_package_review_reservations_active;
CREATE UNIQUE INDEX benefit_package_review_reservations_active
    ON benefit_package_review_reservations (benefit_package_id, project_id, asset_id)
    WHERE status IN ('reserved', 'committed', 'releasing', 'reacquiring');

CREATE TABLE benefit_package_review_cleanup_claims (
    cleanup_id varchar(32) PRIMARY KEY,
    reservation_id varchar(36) NOT NULL REFERENCES benefit_package_review_reservations(id),
    status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    created_at timestamptz NOT NULL,
    completed_at timestamptz
);
CREATE INDEX benefit_package_review_cleanup_claims_reservation
    ON benefit_package_review_cleanup_claims (reservation_id, status);

UPDATE migration SET version = 'v1.19.0', update_time = now() WHERE id = 1;
